export * as OmniIntelligenceTool from "./omni-intelligence.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Location } from "../../location.js"
import { Tool } from "../../tool.js"
import { Skill } from "../../skill.js"
import { Mcp } from "../../mcp/index.js"
import { OmniBus } from "../../omni-bus.js"
import { OmniOrchestrator } from "../../omni-orchestrator.js"
import { rankCatalog, reviewDiff, searchProjectHistory, searchWorkspace, type CatalogEntry } from "../../omni-intelligence.js"

export const name = "omni_intelligence"

export const Input = Schema.Struct({
  action: Schema.Literals(["code", "tools", "history", "review", "metrics"]).annotate({
    description: "code: relevance-ranked source search; tools: discover tools/skills/MCP; history: previous project sessions and memory; review: read-only git diff; metrics: agent event counts.",
  }),
  query: Schema.optionalKey(Schema.String).annotate({
    description: "Search intent. Required for code and history; optional for tools.",
  }),
  limit: Schema.optionalKey(Schema.Number).annotate({ description: "Maximum results (integer 1 to 20; default 10)." }),
  missionID: Schema.optionalKey(Schema.String).annotate({ description: "Optional mission to include in metrics." }),
})

export const Output = Schema.Struct({
  action: Schema.String,
  summary: Schema.String,
})

export const description = [
  "OnethyCode local intelligence hub for terminal agents; no VS Code dependency.",
  "code: bounded and intent-aware lexical source retrieval, with paths and line numbers (not vector embeddings).",
  "tools: rank registered tool, skill and connected MCP capabilities by meaning.",
  "history: search persisted project missions, plans, sessions and memory notes.",
  "review: inspect staged and unstaged Git changes without editing or approving.",
  "metrics: inspect recent agent events and mission task states; tokens/costs remain in native usage telemetry.",
  "Read-only. Does not execute discovered tools, run commands or grant permissions.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.omni_intelligence",
  effect: Effect.fn("OmniIntelligenceTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service
    const tool = yield* Tool.Service
    const skill = yield* Skill.Service
    const mcp = yield* Mcp.Service
    const bus = yield* OmniBus.Service
    const orchestrator = yield* OmniOrchestrator.Service

    yield* ctx.tool.transform((editor) => {
      if (process.env.OMNICODE_ACTIVE !== "1") return
      editor.add({
        name,
        options: { codemode: false },
        description,
        input: Input,
        output: Output,
        execute: (input) => Effect.gen(function* () {
          const action = input.action
          const query = input.query?.trim() ?? ""
          const limit = input.limit ?? 10
          if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
            return yield* new ToolFailure({ message: "limit must be an integer between 1 and 20." })
          }
          if ((action === "code" || action === "history") && !query) {
            return yield* new ToolFailure({ message: "A query is required for code and history search." })
          }
          const root = location.project.directory
          let summary = ""
          if (action === "code") {
            const results = yield* Effect.tryPromise({
              try: () => searchWorkspace(root, query, limit),
              catch: (error) => new ToolFailure({ message: "Source search failed.", error }),
            })
            summary = results.length
              ? results.map((item) => item.file + ":" + item.line + " [score " + item.score + "] " + item.excerpt).join("\n")
              : "No matching readable source files in the bounded project scan."
          } else if (action === "history") {
            const results = yield* Effect.tryPromise({
              try: () => searchProjectHistory(root, query, limit),
              catch: (error) => new ToolFailure({ message: "Project history search failed.", error }),
            })
            summary = results.length
              ? results.map((item) => item.name + "\n" + item.description).join("\n---\n")
              : "No saved project sessions, plans, missions or memory notes matched the query."
          } else if (action === "tools") {
            const [builtin, skills, mcpTools] = yield* Effect.all([tool.list(), skill.list(), mcp.tools()], {
              concurrency: 3,
            })
            const catalog: CatalogEntry[] = [
              ...builtin.map((item) => ({
                category: "tool", name: item.name, description: String(item.description ?? ""),
              })),
              ...skills.map((item) => ({
                category: "skill", name: String(item.id), description: String(item.description ?? ""),
              })),
              ...mcpTools.map((item) => ({
                category: "mcp:" + String(item.server), name: item.name, description: String(item.description ?? ""),
              })),
            ]
            const results = rankCatalog(catalog, query, limit)
            summary = results.length
              ? results.map((item) => "[" + item.category + "] " + item.name + " — " + item.description.slice(0, 300)).join("\n")
              : "No registered tools, skills or connected MCP tools matched the query."
          } else if (action === "review") {
            const result = yield* Effect.tryPromise({
              try: () => reviewDiff(root),
              catch: (error) => new ToolFailure({ message: "Git review unavailable; check repository status.", error }),
            })
            summary = [
              "Changed files (includes untracked; untracked contents are not in the patch):",
              ...result.changed,
              result.changed.length ? "" : "(none)",
              result.patch,
              result.truncated ? "\n[Output truncated; inspect smaller changes before approval.]" : "",
              "Review is read-only. Apply approval/rejection through the existing OnethyCode review UI.",
            ].join("\n")
          } else {
            const events = yield* bus.list()
            const last = events.slice(-200)
            const count = (type: string) => last.filter((event) => event.type === type).length
            const tasks = input.missionID
              ? yield* orchestrator.getActiveTasks(input.missionID)
              : []
            summary = [
              "Agent bus: " + events.length + " events total; last " + last.length + " sampled.",
              "Plans: " + count("plan"),
              "Hand-offs: " + count("handoff"),
              "Status updates: " + count("status"),
              "Reviews: " + count("review_verdict"),
              "Artifacts: " + count("artifact"),
              "Mission " + (input.missionID || "(not selected)") + ": " +
                tasks.map((task) => task.id + "=" + task.status).join(", "),
              "Token/cost counters are provided by the existing session usage telemetry, not this agent event view.",
            ].join("\n")
          }
          return { output: { action, summary }, content: summary, metadata: { action } }
        }),
      })
    }).pipe(Effect.asVoid)
  }),
}
