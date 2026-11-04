import { EOL } from "node:os"
import path from "node:path"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { applyEdits, modify } from "jsonc-parser"
import { Effect, Option } from "effect"
import { OpenCode, type McpServer } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { resolveConfigPath } from "./add"

// Read-only by default. --retry attempts only failed servers, never disabled servers or OAuth sign-ins.
export default Runtime.handler(
  Commands.commands.mcp.commands.doctor,
  Effect.fn("cli.mcp.doctor")(function* (input) {
    const { endpoint } = yield* ServerConnection.resolve()
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const location = { directory: process.cwd() }
    const read = () => client.mcp.list({ location }).then((response) => response.data)
    let servers = yield* Effect.promise(read)
    const enable = Option.getOrUndefined(input.enable)
    if (enable && !servers.some((server) => server.name === enable))
      return yield* Effect.fail(new Error(`MCP server not found: ${enable}. Configure or discover it first.`))
    if (enable) {
      const file = yield* Effect.promise(() => approveServer(process.cwd(), enable))
      process.stdout.write(`Explicitly approved MCP "${enable}" in ${file}. Recheck status after the config reload.` + EOL)
    }
    if (servers.length === 0) {
      process.stdout.write(
        [
          "No MCP servers were loaded for this workspace.",
          "Check onethy.json/onethy.jsonc or opencode.json/opencode.jsonc in the project or global config.",
          "Recognized formats: mcp.<name>, mcp.servers.<name>, .mcp.json, mcp.json and .cursor/.vscode MCP files.",
          "Auto-discovered servers stay disabled until explicitly approved: opencode mcp doctor --enable <name>.",
        ].join(EOL) + EOL,
      )
      return
    }

    if (input.retry) {
      const failed = servers.filter((server) => server.status.status === "failed")
      for (const server of failed) {
        process.stdout.write(`Retrying ${server.name} ...` + EOL)
        const error = yield* Effect.promise(async () => {
          try {
            await client.experimental.mcp.connect({ server: server.name, location })
            return undefined
          } catch (cause) {
            return cause instanceof Error ? cause.message : String(cause)
          }
        })
        if (error) process.stdout.write(`  Request failed: ${safeError(error)}` + EOL)
      }
      servers = yield* Effect.promise(read)
    }

    const counts = { connected: 0, failed: 0, needs_auth: 0, disabled: 0, pending: 0 }
    for (const server of servers.toSorted((a, b) => a.name.localeCompare(b.name))) {
      counts[server.status.status]++
      process.stdout.write(`[${server.status.status}] ${server.name} - ${advice(server)}` + EOL)
    }
    process.stdout.write(
      `Total: ${servers.length} | connected: ${counts.connected} | failed: ${counts.failed} | auth: ${counts.needs_auth} | disabled: ${counts.disabled} | pending: ${counts.pending}` + EOL,
    )
    if (counts.failed && !input.retry)
      process.stdout.write("Run 'opencode mcp doctor --retry' to retry failed connections." + EOL)
  }),
)

// Only invoked by an explicit --enable action. The normal read-only diagnostic never edits config.
export async function approveServer(directory: string, name: string) {
  const filepath = await resolveConfigPath(directory)
  const current = await readFile(filepath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}"
    throw error
  })
  const edits = modify(current, ["mcp", "overrides", name], true, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })
  await mkdir(path.dirname(filepath), { recursive: true })
  await writeFile(filepath, applyEdits(current, edits), "utf8")
  return filepath
}

export function safeError(message: string): string {
  return message
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/((?:token|api[_-]?key|secret|password)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 500)
}

export function advice(server: McpServer): string {
  switch (server.status.status) {
    case "connected":
      return "ready"
    case "pending":
      return "initializing; run doctor again if startup does not finish"
    case "needs_auth":
      return `sign in with 'opencode mcp auth ${server.name}' (${safeError(server.status.error)})`
    case "disabled":
      return "disabled by configuration or discovery; run opencode mcp doctor --enable <name> to approve"
    case "failed":
      return safeError(server.status.error) + " (check command, PATH, dependencies, URL and authentication)"
  }
}
