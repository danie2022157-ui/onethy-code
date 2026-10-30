export * as OmniBusTool from "./omni-bus.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schema } from "effect"
import { OmniBus } from "../../omni-bus.js"
import { OmniSession } from "../../omni-session.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"

export const name = "omni_bus"

export const Input = Schema.Struct({
  action: Schema.Literals(["broadcast", "read", "list_sessions", "send_session_message"]).annotate({
    description:
      "Action to perform: 'broadcast' publishes a finding to all sessions/subagents; 'read' reads shared bus messages; 'list_sessions' lists active sessions; 'send_session_message' sends a direct prompt to another sessionID.",
  }),
  message: Schema.optionalKey(Schema.String).annotate({
    description: "Message or finding text for 'broadcast' or 'send_session_message'.",
  }),
  targetSessionID: Schema.optionalKey(Schema.String).annotate({
    description: "Target sessionID when action is 'send_session_message' or targeted 'broadcast'.",
  }),
  taskId: Schema.optionalKey(Schema.String).annotate({
    description: "Optional task identifier or topic tag.",
  }),
})

export const Output = Schema.Struct({
  action: Schema.String,
  summary: Schema.String,
})

export const description = [
  "Inter-session and inter-subagent communication bus (OmniBus).",
  "- Use 'broadcast' to share discoveries, architectural decisions, or warnings with sibling subagents and other open sessions.",
  "- Use 'read' to inspect what other subagents or sessions have published in this repository.",
  "- Use 'list_sessions' to see all active sessions (main sessions and child subagents) and their sessionIDs.",
  "- Use 'send_session_message' with 'targetSessionID' and 'message' to send a message directly into another session's inbox and wake it up.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.omni_bus",
  effect: Effect.fn("OmniBusTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const omniBusOpt = yield* Effect.serviceOption(OmniBus.Service)
    const omniSessionOpt = yield* Effect.serviceOption(OmniSession.Service)

    yield* ctx.tool
      .transform((editor) => {
        if (process.env.OMNICODE_ACTIVE !== "1") return
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              if (input.action === "list_sessions") {
                const active = yield* sessions
                  .list({ limit: 25 })
                  .pipe(Effect.mapError((error) => new ToolFailure({ message: "Failed to list sessions", error })))
                const stored = Option.isSome(omniSessionOpt) ? yield* omniSessionOpt.value.list() : []
                const activeLines = active.data.map(
                  (s) =>
                    `- ${s.id} | agent: @${s.agent} | model: ${s.model ? `${s.model.providerID}/${s.model.id}` : "auto"} | parent: ${s.parentID ?? "root"} | title: ${s.title ?? "(untitled)"}`,
                )
                const storedLines = stored
                  .slice(0, 10)
                  .map((s) => `- [Missão ${s.id}] modo: ${s.mode} | meta: ${s.goal}`)
                const summary = [
                  "=== Sessões Ativas (DB) ===",
                  ...(activeLines.length > 0 ? activeLines : ["(nenhuma sessão encontrada)"]),
                  ...(storedLines.length > 0 ? ["", "=== Missões Salvas (.omnicode/sessions) ===", ...storedLines] : []),
                ].join("\n")
                return {
                  output: { action: input.action, summary },
                  content: summary,
                  metadata: { action: input.action },
                }
              }

              if (input.action === "send_session_message") {
                if (!input.targetSessionID || !input.message) {
                  return yield* new ToolFailure({
                    message: "Both 'targetSessionID' and 'message' are required for 'send_session_message'.",
                  })
                }
                const targetID = SessionSchema.ID.make(input.targetSessionID)
                if (Option.isSome(omniBusOpt)) {
                  yield* omniBusOpt.value.publish({
                    sender: `@${context.agent} (${context.sessionID})`,
                    target: targetID,
                    taskId: input.taskId ?? "direct-message",
                    sessionID: context.sessionID,
                    type: "handoff",
                    payload: input.message,
                  })
                }
                yield* sessions
                  .prompt({
                    sessionID: targetID,
                    text: `[MENSAGEM DIRETA DA SESSÃO ${context.sessionID} (@${context.agent})]:\n${input.message}`,
                  })
                  .pipe(
                    Effect.mapError(
                      (error) => new ToolFailure({ message: `Failed to message session ${targetID}`, error }),
                    ),
                  )
                const summary = `Mensagem enviada e entregue na fila da sessão ${targetID}.`
                return {
                  output: { action: input.action, summary },
                  content: summary,
                  metadata: { action: input.action, targetSessionID: targetID },
                }
              }

              if (input.action === "broadcast") {
                if (!input.message) {
                  return yield* new ToolFailure({ message: "'message' is required for 'broadcast'." })
                }
                if (Option.isSome(omniBusOpt)) {
                  yield* omniBusOpt.value.publish({
                    sender: `@${context.agent} (${context.sessionID})`,
                    target: input.targetSessionID ?? "*",
                    taskId: input.taskId ?? "shared",
                    sessionID: context.sessionID,
                    type: "artifact",
                    payload: input.message,
                  })
                }
                const summary = `Mensagem publicada no OmniBus compartilhado (.omnicode/bus.json) por @${context.agent} (${context.sessionID}).`
                return {
                  output: { action: input.action, summary },
                  content: summary,
                  metadata: { action: input.action },
                }
              }

              const digest = Option.isSome(omniBusOpt)
                ? yield* omniBusOpt.value.formatContextDigest(undefined, 15)
                : ""
              const summary = digest || "Nenhuma mensagem registrada no OmniBus até o momento."
              return {
                output: { action: input.action, summary },
                content: summary,
                metadata: { action: input.action },
              }
            }),
        })
      })
      .pipe(Effect.orDie)
  }),
}
