import { EOL } from "node:os"
import { Cause, Effect, Exit } from "effect"
import { OpenCode, type McpServer } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"

/** Reconnect explicitly selected MCPs without touching tokens or launching unwanted disabled servers. */
export function shouldRetry(status: McpServer["status"]["status"], includeDisabled: boolean): boolean {
  return status === "failed" || (includeDisabled && status === "disabled")
}

export default Runtime.handler(
  Commands.commands.mcp.commands.repair,
  Effect.fn("cli.mcp.repair")(function* (input) {
    const { endpoint } = yield* ServerConnection.resolve()
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const location = { directory: process.cwd() }
    const initial = (yield* Effect.promise(() => client.mcp.list({ location }))).data
    if (initial.length === 0) {
      process.stdout.write(
        "No MCP servers found. Add one with 'onethy mcp add', or check your onethy.json/.onethy config." + EOL,
      )
      return
    }

    let recovered = 0
    let failed = 0
    for (const server of initial) {
      if (server.status.status === "connected") {
        process.stdout.write(`✓ ${server.name}: connected${EOL}`)
        continue
      }
      if (server.status.status === "needs_auth") {
        process.stdout.write(`⚠ ${server.name}: login required; run 'onethy mcp auth ${server.name}'${EOL}`)
        continue
      }
      if (!shouldRetry(server.status.status, input.all)) {
        process.stdout.write(`○ ${server.name}: disabled (use --all to connect explicitly)${EOL}`)
        continue
      }
      // Run sequentially to avoid a burst of package installs and OAuth requests.
      const connected = yield* Effect.tryPromise({
        try: () => client.experimental.mcp.connect({ server: server.name, location }),
        catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
      }).pipe(Effect.exit)
      if (Exit.isFailure(connected)) {
        failed += 1
        process.stdout.write(`✗ ${server.name}: ${String(Cause.squash(connected.cause))}${EOL}`)
        continue
      }
      const checked = yield* Effect.tryPromise({
        try: () => client.mcp.list({ location }),
        catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
      }).pipe(Effect.exit)
      if (Exit.isFailure(checked)) {
        failed += 1
        process.stdout.write(`✗ ${server.name}: couldn't verify status: ${String(Cause.squash(checked.cause))}${EOL}`)
        continue
      }
      const fresh = checked.value.data.find((entry) => entry.name === server.name)
        if (fresh?.status.status === "connected") {
          recovered += 1
          process.stdout.write(`✓ ${server.name}: reconnected${EOL}`)
        } else {
          failed += 1
          const status = fresh?.status
          const details = status?.status === "failed" || status?.status === "needs_auth"
            ? status.error : status?.status ?? "unknown"
          process.stdout.write(`✗ ${server.name}: ${details}${EOL}`)
        }
    }
    process.stdout.write(`MCP repair complete: ${recovered} reconnected, ${failed} failed.${EOL}`)
    if (failed > 0) process.exitCode = 1
  }),
)
