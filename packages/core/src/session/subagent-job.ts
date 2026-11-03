export * as SubagentJob from "./subagent-job.js"

import { Context, Effect, Layer, Scope } from "effect"
import { Node } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Job } from "../job.js"
import { Session } from "../session.js"
import { SubagentCompletion } from "./subagent-completion.js"

type Recovery = Extract<Job.Recovery, { kind: "subagent" }>

export interface Interface {
  start: (recovery: Recovery) => Effect.Effect<Job.Info>
  background: (recovery: Recovery) => Effect.Effect<void>
  notify: (recovery: Recovery, startedAt: number) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SubagentJob") {}

const make: Effect.Effect<Interface, never, Session.Service | Job.Service | Scope.Scope> = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const jobs = yield* Job.Service
  const scope = yield* Scope.Scope
  // Jobs and their completion observers outlive the plugin that launched them.
  // Fork with the global context too, rather than retaining the caller's location.
  const context = yield* Effect.context<never>()
  // One observer per job generation, including continuations of the same child.
  const notifications = new Set<string>()

  const notify = Effect.fn("SubagentJob.notify")(function* (recovery: Recovery, startedAt: number) {
    const key = `${recovery.childSessionID}:${startedAt}`
    if (notifications.has(key)) return
    notifications.add(key)
    yield* Effect.gen(function* () {
      const info = (yield* jobs.wait({ id: recovery.childSessionID })).info
      if (info) yield* SubagentCompletion.deliver(sessions, jobs, { ...info, recovery })
    }).pipe(
      Effect.ensuring(Effect.sync(() => notifications.delete(key))),
      Effect.forkIn(scope, { startImmediately: true }),
      Effect.setContext(context),
    )
  })

  return Service.of({
    start: (recovery: Recovery) =>
      jobs
        .start({
          id: recovery.childSessionID,
          type: "subagent",
          title: recovery.description,
          metadata: {},
          recovery,
          run: Effect.gen(function* () {
            yield* sessions.resume(recovery.childSessionID)
            const messages = yield* sessions.messages({ sessionID: recovery.childSessionID, order: "asc" })
            const assistant = messages.findLast(
              (message) =>
                message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
            )
            const response = messages.findLast(
              (message) =>
                message.type === "assistant" &&
                message.time.completed !== undefined &&
                message.error === undefined &&
                message.content.some((part) => part.type === "text"),
            )
            // These totals describe the entire persisted child session, including prior work if it was resumed.
            const usage = messages.reduce(
              (total, message) => {
                if (message.type !== "assistant" || !message.tokens) return total
                total.input += message.tokens.input
                total.output += message.tokens.output
                total.reasoning += message.tokens.reasoning
                total.cacheRead += message.tokens.cache.read
                total.cacheWrite += message.tokens.cache.write
                return total
              },
              { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
            )
            const toolCalls = messages.reduce(
              (total, message) => {
                if (message.type !== "assistant") return total
                for (const part of message.content) {
                  if (part.type !== "tool") continue
                  if (part.state.status === "completed") total.completed++
                  if (part.state.status === "error") total.errors++
                }
                return total
              },
              { completed: 0, errors: 0 },
            )
            const summary = [
              `Child usage: tokens input ${usage.input}, output ${usage.output}, reasoning ${usage.reasoning}, cache read ${usage.cacheRead}, cache write ${usage.cacheWrite}.`,
              `Tool calls: ${toolCalls.completed} completed, ${toolCalls.errors} errors.`,
            ].join("\n")
            return `${SubagentCompletion.text(response ?? assistant)}\n\n${summary}`
          }),
        })
        .pipe(Effect.setContext(context)),
    background: Effect.fn("SubagentJob.background")(function* (recovery: Recovery) {
      const info = yield* jobs.background(recovery.childSessionID)
      if (info) yield* notify(recovery, info.started_at)
    }),
    notify,
  })
})

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Session.node, Job.node],
})
