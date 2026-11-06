export * as OmniIntelligenceTool from "./omni-intelligence.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Location } from "../../location.js"
import { Tool } from "../../tool.js"
import { Skill } from "../../skill.js"
import { Agent } from "../../agent.js"
import { Command } from "../../command.js"
import { Mcp } from "../../mcp/index.js"
import { OmniBus } from "../../omni-bus.js"
import { OmniOrchestrator } from "../../omni-orchestrator.js"
import { Session } from "../../session.js"
import { rankCatalog, reviewDiff, searchProjectHistory, searchWorkspace, type CatalogEntry } from "../../omni-intelligence.js"
import { OmniEmbeddings } from "../../omni-embeddings.js"
import { SessionStats } from "../../session/stats.js"
import { efficiencyProfile } from "../../efficiency-profile.js"
import { readOutcomes, rankVerifiedModels } from "../../model-outcomes.js"

export const name = "omni_intelligence"

export const Input = Schema.Struct({
  action: Schema.Literals(["code", "semantic", "tools", "history", "review", "metrics", "efficiency", "quality", "customizations"]).annotate({
    description: "code: lexical source search; semantic: on-device Ollama vector search; tools: discover tools/skills/MCP; history: project sessions and memory; review: read-only git diff; metrics: agent usage and events.",
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
  "code: bounded intent-aware lexical retrieval; semantic: local Ollama embeddings (requires Ollama and nomic-embed-text).",
  "tools: rank registered tool, skill and connected MCP capabilities by meaning.",
  "history: search persisted project missions, plans, sessions and memory notes.",
  "review: inspect staged and unstaged Git changes without editing or approving.",
  "metrics: inspect recent agent events and mission task states.",
  "efficiency: report local seven-day token, cache, cost, and subagent statistics and active resource budgets.",
  "quality: inspect evidence counts, pass rates and cost-per-correct-task for eligible learned model rankings.",
  "customizations: report registered agents, skills, commands and MCP status; optional query ranks matching specialists/resources.",
  "Read-only. Does not execute discovered tools, run commands or grant permissions.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.omni_intelligence",
  effect: Effect.fn("OmniIntelligenceTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service
    const tool = yield* Tool.Service
    const skill = yield* Skill.Service
    const agents = yield* Agent.Service
    const commands = yield* Command.Service
    const mcp = yield* Mcp.Service
    const bus = yield* OmniBus.Service
    const orchestrator = yield* OmniOrchestrator.Service
    const sessions = yield* Session.Service


    /** Bounded and project-scoped: do not index tool results or system instructions. */
    const sampledSessionTexts = Effect.fn("OmniIntelligence.sessions")(function* (limit: number) {
      const page = yield* sessions.list({ project: location.project.id, limit: 30 })
      const selected = page.data.slice(0, 30)
      const rows = yield* Effect.forEach(selected, (session) =>
        sessions.messages({ sessionID: session.id, limit, order: "desc" }).pipe(
          Effect.map((messages) => ({ session, messages })),
          Effect.catchAll(() => Effect.succeed({ session, messages: [] })),
        ), { concurrency: 4 })
      return rows
    })

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
          if ((action === "code" || action === "semantic" || action === "history") && !query) {
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
          } else if (action === "semantic") {
            const results = yield* Effect.tryPromise({
              try: () => OmniEmbeddings.semanticSearch(root, query, limit),
              catch: (error) => new ToolFailure({
                message: "Local semantic search unavailable. Start Ollama, install nomic-embed-text, and use a Git project. No remote service is used.",
                error,
              }),
            })
            summary = results.length
              ? results.map((item) =>
                item.file + ":" + item.line + " [cosine " + item.score.toFixed(3) + "] " + item.excerpt,
              ).join("\n")
              : "No eligible source files found in the bounded local embedding index."
          } else if (action === "customizations") {
            const [loadedAgents, loadedSkills, loadedCommands, servers] = yield* Effect.all([
              agents.list(), skill.list(), commands.list(), mcp.servers(),
            ], { concurrency: 4 })
            const imported = loadedAgents.filter((agent) =>
              agent.description?.startsWith("AITmpl specialist ("))
            // The inventory and actual use are different. Count persisted, real
            // tool calls rather than claiming that a loaded skill was invoked.
            const now = Date.now()
            const activity = yield* SessionStats.get({
              projectID: location.project.id, from: now - 7 * 86_400_000,
              to: now, tools: "detail",
            })
            const recorded = activity.tools.mode === "detail" ? activity.tools.usage : []
            const usage = (name: string) => recorded.find((entry) => entry.name === name)?.calls ?? 0
            const activeExperts = loadedAgents.filter((agent) =>
              agent.mode !== "primary" && !agent.hidden)
            const categories = [
              { label: "hooks", prefix: "hook-" },
              { label: "mods", prefix: "mod-" },
              { label: "settings", prefix: "setting-" },
            ]
            const refs = categories.map((type) =>
              type.label + ": " + loadedSkills.filter((skill) => String(skill.id).startsWith(type.prefix)).length)
            const catalog: CatalogEntry[] = [
              ...activeExperts.map((agent) => ({
                category: "agent", name: String(agent.id),
                description: String(agent.description ?? ""),
              })),
              ...loadedSkills.map((skill) => ({
                category: "skill", name: String(skill.id),
                description: String(skill.description ?? ""),
              })),
              ...loadedCommands.map((command) => ({
                category: "command", name: command.name,
                description: String(command.description ?? ""),
              })),
              ...servers.filter((server) => server.status.status === "connected").map((server) => ({
                category: "mcp", name: server.name, description: "connected MCP server",
              })),
            ]
            const matches = query ? rankCatalog(catalog, query, limit) : []
            const statuses = servers.reduce<Record<string, number>>((acc, server) => {
              const state = server.status.status
              acc[state] = (acc[state] ?? 0) + 1
              return acc
            }, {})
            summary = [
              "OnethyCode personalizations — registered inventory, not execution counts.",
              "Agents: " + loadedAgents.length + " total; " + activeExperts.length +
                " available for delegation; " + imported.length + " legacy AITmpl specialists normalized.",
              "Skills: " + loadedSkills.length + "; commands: " + loadedCommands.length + ".",
              "Descriptor references — " + refs.join(", ") + ". Descriptors are not executable plugins.",
              "MCP servers: " + servers.length + "; states: " +
                Object.entries(statuses).map(([state, count]) => state + "=" + count).join(", ") + ".",
              "Actual tool calls, last 7 days (this project): skill=" + usage("skill") +
                ", subagent=" + usage("subagent") + ", omni_mcp=" + usage("omni_mcp") +
                ". Counted from saved session tool invocations.",
              "Disabled MCPs are not started automatically; use explicit approval to enable one.",
              ...(matches.length ? ["Matching available resources:",
                ...matches.map((item) =>
                  "[" + item.category + "] " + item.name + " — " + item.description.slice(0, 180))] :
                query ? ["No registered resources match that request."] : [
                  'Use query="React testing" or query="Python" to rank matching agents and skills.',
                ]),
              "Availability does not prove invocation; review individual session tool-call logs for actual usage.",
            ].join("\n")
          } else if (action === "quality") {
            const outcomes = yield* Effect.promise(() => readOutcomes(root))
            const categories = [
              "fast_explore", "external_research", "deep_architecture",
              "code_implementation", "security_review", "orchestration",
            ]
            const reports = categories.flatMap((category) => {
              const scores = rankVerifiedModels(outcomes, category)
              return scores.length ? [
                "[" + category + "]",
                ...scores.slice(0, 8).map((item) =>
                  item.model + ": " + item.attempts + " cases, " +
                  Math.round(item.passRate * 100) + "% verified, USD " +
                  item.usdPerVerified.toFixed(4) + "/verified"),
              ] : []
            })
            summary = [
              "OnethyCode Model Quality — trusted offline benchmark results.",
              "Workspace outcome records: " + outcomes.length + " (rolling 90 days).",
              ...reports,
              "Learned routing activates only with at least two qualified, connected and allowed models per category.",
              "To import independently checked results, run the local quality-ingest.ts script; restart afterward.",
              "The model does not label its own outcomes; direct user model choices take precedence.",
            ].join("\n")
          } else if (action === "efficiency") {
            const profile = efficiencyProfile()
            const now = Date.now()
            const stats = yield* SessionStats.get({
              projectID: location.project.id,
              from: now - 7 * 86_400_000,
              to: now,
              tools: "summary",
            })
            const tokens = stats.tokens
            const totalInput = tokens.input + tokens.cache.read + tokens.cache.write
            const cacheShare = totalInput > 0 ? Math.round(100 * tokens.cache.read / totalInput) : 0
            const totalTokens = totalInput + tokens.output + tokens.reasoning
            const recommendations: string[] = []
            if (totalInput > 0 && cacheShare < 20)
              recommendations.push("Check stable system prefixes and prompt caching on the active provider.")
            if (stats.subagents > stats.sessions * 3)
              recommendations.push("Review multi-agent delegation; independent subagents increase total context usage.")
            if (stats.steps > stats.prompts * 12 && stats.prompts > 0)
              recommendations.push("Review long execution loops and redundant reads before increasing step limits.")
            summary = [
              "OnethyCode Efficiency — past 7 days, this project only.",
              "Profile: " + profile.mode + " · mission rounds " + profile.missionRounds +
                " · max parallel by default " + profile.parallel +
                " · goal rounds " + profile.goalRounds + ".",
              "Sessions: " + stats.sessions + " · Subagents: " + stats.subagents +
                " · User prompts: " + stats.prompts + " · Assistant steps: " + stats.steps + ".",
              "Recorded tokens: " + totalTokens.toLocaleString("en-US") +
                " (noncached input " + tokens.input + "; cache read " + tokens.cache.read +
                "; cache write " + tokens.cache.write + "; output " + tokens.output +
                "; reasoning " + tokens.reasoning + ").",
              "Cached input share: " + cacheShare + "% · Estimated/recorded cost: USD " +
                Number(stats.cost).toFixed(4) + ".",
              "Usage totals include auxiliary title, compaction and generation events when reported by the provider.",
              "Provider bills, subscriptions, failed attempts and missing provider usage may differ from these estimates.",
              ...recommendations,
            ].join("\n")
          } else if (action === "history") {
            const results = yield* Effect.tryPromise({
              try: () => searchProjectHistory(root, query, limit),
              catch: (error) => new ToolFailure({ message: "Project history search failed.", error }),
            })
            const stored = yield* sampledSessionTexts(30)
            const chats: CatalogEntry[] = stored.flatMap(({ session, messages }) =>
              messages.flatMap((message) => {
                const text = message.type === "user" ? message.text
                  : message.type === "assistant"
                    ? message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
                    : ""
                return text && text.length <= 12000
                  ? [{ category: "conversation", name: "Session " + session.id + " (" + session.title + ")", description: text.slice(0, 2500) }]
                  : []
              }))
            const combined = rankCatalog([...results, ...chats], query, limit)
            summary = combined.length
              ? combined.map((item) => item.name + "\n" + item.description.slice(0, 900)).join("\n---\n")
              : "No project sessions, conversations, plans, missions or memory notes matched the query."
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
              ...(yield* agents.list()).filter((item) => item.mode !== "primary" && !item.hidden).map((item) => ({
                category: "agent", name: String(item.id), description: String(item.description ?? ""),
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
            const stored = yield* sampledSessionTexts(50)
            const assistants = stored.flatMap(({ messages }) => messages.filter((message) => message.type === "assistant"))
            const costs = assistants.reduce((total, message) => total + (message.cost ?? 0), 0)
            const tokens = assistants.reduce((total, message) =>
              total + (message.tokens
                ? message.tokens.input + message.tokens.output + message.tokens.reasoning +
                  message.tokens.cache.read + message.tokens.cache.write
                : 0), 0)
            summary = [
              "Agent bus: " + events.length + " events total; last " + last.length + " sampled.",
              "Plans: " + count("plan"),
              "Hand-offs: " + count("handoff"),
              "Status updates: " + count("status"),
              "Reviews: " + count("review_verdict"),
              "Artifacts: " + count("artifact"),
              "Mission " + (input.missionID || "(not selected)") + ": " +
                tasks.map((task) => task.id + "=" + task.status).join(", "),
              "Session sample: " + stored.length + " latest project sessions, up to 50 recent messages each.",
              "Recorded usage in sample: " + tokens + " tokens, USD " + costs.toFixed(4) + " (provider-reported, not live billing).",
            ].join("\n")
          }
          return { output: { action, summary }, content: summary, metadata: { action } }
        }),
      })
    }).pipe(Effect.asVoid)
  }),
}
