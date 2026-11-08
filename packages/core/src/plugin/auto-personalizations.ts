export * as AutoPersonalizationsPlugin from "./auto-personalizations.js"

import { Message } from "@opencode/ai/effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../agent.js"
import { Command } from "../command.js"
import { Mcp } from "../mcp/index.js"
import { Permission } from "../permission.js"
import { Session } from "../session.js"
import { Skill } from "../skill.js"
import {
  selectAllowedSkillAttachments,
  selectAutoPersonalizations,
  renderAutoPersonalizationHints,
  type AutoPersonalizationSelection,
} from "../auto-personalizations.js"

const METADATA = "onethy.personalizations"
const enabled = () => process.env.OMNICODE_ACTIVE === "1" &&
  process.env.ONETHY_CUSTOMIZATION_AUTONOMY !== "off"

type Saved = { version: 1; selection: AutoPersonalizationSelection; attached: string[] }

function asIDs(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string =>
      typeof item === "string" && item.length < 160 && /^[a-zA-Z0-9._:@/-]+$/.test(item))
    .slice(0, limit)
}
function saved(value: unknown): Saved | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const record = value as Record<string, unknown>
  if (record.version !== 1 || !record.selection ||
      typeof record.selection !== "object" || Array.isArray(record.selection)) return
  const selection = record.selection as Record<string, unknown>
  return {
    version: 1,
    attached: asIDs(record.attached, 2),
    selection: {
      skills: asIDs(selection.skills, 4),
      agents: asIDs(selection.agents, 2),
      commands: asIDs(selection.commands, 2),
      mcpTools: asIDs(selection.mcpTools, 3),
    },
  }
}

/**
 * Auto discovery occurs at the prompt boundary, not only in an LLM system hint.
 * Only allow-approved, bounded skills get attached. Other resources remain
 * recommendations and never gain executable privileges by being discovered.
 */
export const Plugin = define({
  id: "opencode.onethy.auto-personalizations",
  effect: Effect.fn("OnethyAutoPersonalizations")(function* (ctx) {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const skills = yield* Skill.Service
    const commands = yield* Command.Service
    const mcp = yield* Mcp.Service

    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        if (!enabled() || !event.prompt.text.trim()) return
        // Only examine user task text; avoid indexing attachments or tool outputs.
        const session = yield* sessions.get(event.sessionID).pipe(Effect.orElseSucceed(() => undefined))
        if (!session) return
        const active = yield* agents.select(session.agent)
        if (!active.info || active.info.hidden) return
        const permissions = Permission.merge(active.info.permissions, session.permissions ?? [])
        const available = yield* Effect.all({
          skills: skills.list(),
          agents: agents.list(),
          commands: commands.list(),
          tools: mcp.tools(),
          servers: mcp.servers(),
        }, { concurrency: 5 })
        const connected = new Set(available.servers
          .filter((item) => item.status.status === "connected").map((item) => item.name))
        const catalogSkills = available.skills.map((skill) => ({
          id: skill.id, description: skill.description, autoinvoke: skill.autoinvoke,
          path: skill.path, content: skill.content,
        }))
        const selection = selectAutoPersonalizations(event.prompt.text, {
          skills: catalogSkills,
          agents: available.agents.map((item) => ({
            id: item.id, description: item.description, mode: item.mode, hidden: item.hidden,
          })),
          commands: available.commands.map((item) => ({ id: item.name, description: item.description })),
          mcpTools: available.tools
            .filter((item) => connected.has(item.server))
            .map((item) => ({
              id: item.server + "/" + item.name,
              description: item.description,
            })),
        })
        const existing = (event.prompt.skills ?? []).map((item) => item.id)
        const attached = selectAllowedSkillAttachments(
          selection.skills,
          catalogSkills,
          (id) => Permission.evaluate("skill", id, permissions).effect === "allow",
          existing,
        )
        if (attached.length) {
          event.prompt.skills = [
            ...(event.prompt.skills ?? []),
            ...attached.map((id) => ({ id: Skill.ID.make(id) })),
          ]
        }
        const report: Saved = { version: 1, selection, attached }
        event.metadata = { ...(event.metadata ?? {}), [METADATA]: report }
        if (selection.skills.length || selection.agents.length || selection.commands.length ||
            selection.mcpTools.length)
          yield* Effect.logInfo("onethy.personalizations.selected", {
            sessionID: event.sessionID,
            attachedSkills: attached,
            recommendedSkills: selection.skills,
            suggestedAgents: selection.agents,
            suggestedCommands: selection.commands,
            connectedMcpTools: selection.mcpTools,
          })
      }).pipe(Effect.catchCause((cause) =>
        Effect.logWarning("onethy personalization discovery unavailable", { sessionID: event.sessionID, cause }),
      )),
    )

    // Provide task-scoped, validated resource names to the model. The original
    // user prompt remains last. Never inject untrusted skill bodies as system text.
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if (!enabled()) return
        const last = (yield* sessions.messages({
          sessionID: event.sessionID, type: "user", limit: 1,
        }))[0]
        const report = saved(last?.type === "user" ? last.metadata?.[METADATA] : undefined)
        if (!report) return
        const advisory = renderAutoPersonalizationHints(report.selection, report.attached)
        if (!advisory) return
        const beforeUser = event.messages.at(-1)?.role === "user"
          ? event.messages.length - 1 : event.messages.length
        event.messages.splice(beforeUser, 0, Message.user(advisory))
      }).pipe(Effect.catchCause((cause) =>
        Effect.logWarning("onethy personalization context unavailable", { sessionID: event.sessionID, cause }),
      )),
    )
  }),
})
