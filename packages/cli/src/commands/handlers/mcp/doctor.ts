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
    // A comma-separated list is an explicit opt-in for each server; never approve
    // everything discovered on disk (those entries may be untrusted).
    const requested = enable ? [...new Set(enable.split(",").map((name) => name.trim()).filter(Boolean))] : []
    if (enable && requested.length === 0)
      return yield* Effect.fail(new Error("Specify one or more MCP names with --enable name1,name2"))
    const unknown = requested.filter((name) => !servers.some((server) => server.name === name))
    if (unknown.length)
      return yield* Effect.fail(new Error(`MCP servers not found: ${unknown.join(", ")}. Configure or discover them first.`))
    if (requested.length) {
      const file = yield* Effect.promise(() => approveServers(process.cwd(), requested))
      process.stdout.write(`Approved MCP servers: ${requested.join(", ")} in ${file}.` + EOL)
      process.stdout.write("Restart the Onethy service, then run 'onethy mcp doctor --retry' to reconnect and check status." + EOL)
    }
    if (servers.length === 0) {
      process.stdout.write(
        [
          "No MCP servers were loaded for this workspace.",
          "Check onethy.json/onethy.jsonc or opencode.json/opencode.jsonc in the project or global config.",
          "Recognized formats: mcp.<name>, mcp.servers.<name>, .mcp.json, mcp.json and .cursor/.vscode MCP files.",
          "Auto-discovered servers stay disabled until explicitly approved: onethy mcp doctor --enable <name>.",
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
      process.stdout.write("Run 'onethy mcp doctor --retry' to retry failed connections." + EOL)
  }),
)

// Only invoked by an explicit --enable action. The normal read-only diagnostic never edits config.
export async function approveServer(directory: string, name: string) {
  return approveServers(directory, [name])
}

export async function approveServers(directory: string, names: readonly string[]) {
  if (!names.length || names.some((name) => !name.trim()))
    throw new Error("At least one nonempty MCP server name is required")
  const filepath = await resolveConfigPath(directory)
  let current = await readFile(filepath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}"
    throw error
  })
  // jsonc-parser offsets refer to the current text: apply each edit before
  // creating the next to preserve comments and unrelated configuration.
  for (const name of new Set(names)) {
    const edits = modify(current, ["mcp", "overrides", name], true, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
    current = applyEdits(current, edits)
  }
  await mkdir(path.dirname(filepath), { recursive: true })
  await writeFile(filepath, current, "utf8")
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
      return `sign in with 'onethy mcp auth ${server.name}' (${safeError(server.status.error)})`
    case "disabled":
      return "disabled by configuration or discovery; run onethy mcp doctor --enable <name> to approve"
    case "failed":
      return safeError(server.status.error) + " (check command, PATH, dependencies, URL and authentication)"
  }
}
