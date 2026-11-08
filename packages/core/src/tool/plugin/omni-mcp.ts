export * as OmniMcpTool from "./omni-mcp.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Mcp } from "../../mcp/index.js"
import { openMcpUsage } from "../../mcp/usage.js"
import { Location } from "../../location.js"
import { canRetryMcp, diagnoseMcp, redactMcpError } from "../../mcp/autonomy.js"
import { rankCatalog } from "../../omni-intelligence.js"

export const name = "omni_mcp"

export const Input = Schema.Struct({
  action: Schema.Literals(["list", "recover", "usage"]).annotate({
    description: "list: inspect MCP servers and tools; recover: reconnect one authorized server; usage: inspect private per-project usage statistics and learned startup priority.",
  }),
  server: Schema.optionalKey(Schema.String).annotate({ description: "Exact server name; required for recover." }),
  query: Schema.optionalKey(Schema.String).annotate({ description: "Optional keyword search for available MCP tools." }),
  limit: Schema.optionalKey(Schema.Number).annotate({ description: "Maximum tool entries in list (1-50, default 20)." }),
})

export const Output = Schema.Struct({
  action: Schema.String,
  summary: Schema.String,
  recovered: Schema.optionalKey(Schema.Boolean),
})

export const description = [
  "Autonomous, permission-preserving MCP discovery and connection recovery for OnethyCode.",
  "list: show every configured server's status, with searchable tools actually advertised by connected or standby servers.",
  "usage: show locally learned use frequency, connection priority and warm/standby preferences, including custom MCPs.",
  "recover: reconnect one failed or standby MCP, verify the new status and re-discover its tools.",
  "Never enables disabled servers, installs packages, changes config, modifies credentials or bypasses OAuth.",
  "A tool execution error may have occurred after external side effects: never replay that call automatically.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.omni_mcp",
  effect: Effect.fn("OmniMcpTool.Plugin")(function* (ctx: Context) {
    const mcp = yield* Mcp.Service
    const location = yield* Location.Service
    // Prevent a model from creating a busy retry loop. Background maintenance has its own backoff.
    const lastRecovery = new Map<string, number>()

    yield* ctx.tool.transform((editor) => {
      if (process.env.OMNICODE_ACTIVE !== "1" && process.env.ONETHY_ACTIVE !== "1") return
      editor.add({
        name,
        options: { codemode: false },
        description,
        input: Input,
        output: Output,
        execute: (input) => Effect.gen(function* () {
          const action = input.action
          const limit = input.limit ?? 20
          if (!Number.isInteger(limit) || limit < 1 || limit > 50)
            return yield* new ToolFailure({ message: "limit must be between 1 and 50." })

          if (action === "usage") {
            const [servers, learning] = yield* Effect.all([
              mcp.servers(),
              Effect.promise(() => openMcpUsage(location.directory)),
            ], { concurrency: 2 })
            const allowed = servers.filter((server) => server.status.status !== "disabled")
            const priority = learning.prioritize(allowed.map((server) => server.name))
            const summary = [
              "OnethyCode MCP Auto Learning (this project; local statistics only).",
              "Approved servers: " + allowed.length + "; warm startup slots: up to 3.",
              ...priority.map((item) =>
                "[" + item.tier + "] " + item.name + " · " + item.calls7d +
                " tool calls in 7 days · score " + item.score),
              "The ranking is based on actual tool calls, not whether a server came bundled with OnethyCode.",
              "Disable the adaptive startup entirely with ONETHY_MCP_AUTONOMY=off before launching the app.",
              "Credentials, tool parameters and results are never stored in the usage history.",
            ].join("\n").slice(0, 12000)
            return { output: { action, summary }, content: summary, metadata: { action, servers: allowed.length } }
          }

          if (action === "recover") {
            const server = input.server?.trim()
            if (!server) return yield* new ToolFailure({ message: "Specify the exact MCP server name." })
            const current = (yield* mcp.servers()).find((entry) => entry.name === server)
            if (!current) {
              const summary = "MCP server " + server + " is not configured. Ask the user to configure and approve it first."
              return { output: { action, summary, recovered: false }, content: summary, metadata: { action, recovered: false } }
            }
            const decision = diagnoseMcp(current.status)
            if (current.status.status === "connected") {
              const available = (yield* mcp.tools()).filter((tool) => tool.server === server)
              const summary = server + " already connected; " + available.length + " tools available."
              return { output: { action, summary, recovered: true }, content: summary, metadata: { action, recovered: true } }
            }
            if (!decision.recoverable) {
              const summary = "MCP " + server + " [" + current.status.status + "]: " + decision.advice +
                (current.status.status === "failed" ? " " + redactMcpError(current.status.error) : "")
              return { output: { action, summary, recovered: false }, content: summary, metadata: { action, recovered: false } }
            }
            const now = Date.now()
            if (!canRetryMcp(lastRecovery.get(server), now)) {
              const summary = "MCP " + server + ": recovery cooldown in effect. Avoid repeated reconnect attempts."
              return { output: { action, summary, recovered: false }, content: summary, metadata: { action, recovered: false } }
            }
            lastRecovery.set(server, now)
            const connectError = yield* mcp.connect(Mcp.ServerName.make(server)).pipe(
              Effect.map(() => ""),
              Effect.catch((error) => Effect.succeed(redactMcpError(String(error)))),
            )
            const after = (yield* mcp.servers()).find((entry) => entry.name === server)
            const recovered = after?.status.status === "connected"
            const available = recovered ? (yield* mcp.tools()).filter((tool) => tool.server === server) : []
            const summary = [
              "MCP " + server + " [" + (after?.status.status ?? "missing") + "]: " +
                (recovered ? "connection restored." : "reconnection did not succeed."),
              recovered ? available.length + " available tool(s): " + available.slice(0, 30).map((tool) => tool.name).join(", ") :
                after ? diagnoseMcp(after.status).advice : "Configuration changed; inspect the MCP registry.",
              !recovered && after?.status.status === "failed" ? redactMcpError(after.status.error) : "",
              connectError,
              "Use the original tool again only if its earlier invocation is known not to have executed; never automatically replay writes.",
            ].filter(Boolean).join("\n").slice(0, 7000)
            return { output: { action, summary, recovered }, content: summary, metadata: { action, recovered } }
          }

          const [servers, tools] = yield* Effect.all([mcp.servers(), mcp.tools()], { concurrency: 2 })
          const query = input.query?.trim() ?? ""
          const candidates = tools.map((tool) => ({
            category: "mcp:" + tool.server, name: tool.name, description: String(tool.description ?? ""),
          }))
          const found = rankCatalog(candidates, query, limit)
          const summary = [
            "Configured MCP servers: " + servers.length + "; connected: " +
              servers.filter((server) => server.status.status === "connected").length +
              "; advertised tools: " + tools.length + ".",
            ...servers.slice(0, 120).map((server) => {
              const decision = diagnoseMcp(server.status)
              const detail = server.status.status === "failed" ? " " + redactMcpError(server.status.error) : ""
              return "[" + server.status.status + "] " + server.name + " — " + decision.advice + detail
            }),
            servers.length > 120 ? "[Additional configured servers omitted from this view.]" : "",
            "Matching MCP tools (" + found.length + "):",
            ...found.map((tool) => "[" + tool.category + "] " + tool.name + " — " + tool.description.slice(0, 180)),
            "Disabled and missing MCPs require user approval. MCP recovery never installs servers or bypasses authentication.",
          ].filter(Boolean).join("\n").slice(0, 16000)
          return { output: { action, summary }, content: summary, metadata: { action, servers: servers.length, tools: tools.length } }
        }),
      })
    }).pipe(Effect.asVoid)
  }),
}
