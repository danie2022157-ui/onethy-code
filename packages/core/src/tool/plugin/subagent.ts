export * as SubagentTool from "./subagent.js"

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect, Option, Predicate, Schema } from "effect"
import { Agent } from "../../agent.js"
import { Config } from "../../config.js"
import { Job } from "../../job.js"
import { Model } from "../../model.js"
import { OmniBus } from "../../omni-bus.js"
import { OmniOrchestrator } from "../../omni-orchestrator.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { SubagentCompletion } from "../../session/subagent-completion.js"
import { SubagentJob } from "../../session/subagent-job.js"

export const name = "subagent"

const backgroundResult = (sessionID: SessionSchema.ID) => ({
  sessionID,
  status: "running" as const,
  output: [
    `The subagent is working in the background (sessionID: ${sessionID}). You will be notified automatically when it finishes.`,
    "DO NOT sleep, poll for progress, ask the subagent for status, or duplicate this subagent's work; avoid working with the same files or topics it is using.",
    "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
    "To send it follow-ups or change its instructions while it runs, call subagent again with this sessionID.",
  ].join("\n"),
})

function resolveOmniAllowedModels(): Set<string> | undefined {
  if (process.env.OMNICODE_ALLOWED_MODELS) {
    try {
      const parsed = JSON.parse(process.env.OMNICODE_ALLOWED_MODELS)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return new Set(parsed.filter((item): item is string => typeof item === "string"))
      }
    } catch {
      // ignore
    }
  }

  try {
    const stateDir =
      process.env.OMNICODE_STATE_DIR ||
      (process.platform === "win32"
        ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "omnicode", "state")
        : path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "omnicode"))
    const autoFile = path.join(stateDir, "auto-model.json")
    if (fs.existsSync(autoFile)) {
      const content = JSON.parse(fs.readFileSync(autoFile, "utf8"))
      if (Array.isArray(content.selectedModels) && content.selectedModels.length > 0) {
        return new Set(content.selectedModels.filter((item: unknown): item is string => typeof item === "string"))
      }
    }
  } catch {
    // ignore
  }

  return undefined
}

let cachedThinkingEnabled: { value: boolean; timestamp: number } | undefined

function isThinkingRoutingEnabled(): boolean {
  if (process.env.OMNICODE_THINKING_ROUTING === "0") return false
  if (process.env.OMNICODE_THINKING_ROUTING === "1") return true

  const now = Date.now()
  if (cachedThinkingEnabled && now - cachedThinkingEnabled.timestamp < 3000) {
    return cachedThinkingEnabled.value
  }

  try {
    const stateDir =
      process.env.OMNICODE_STATE_DIR ||
      (process.platform === "win32"
        ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "omnicode", "state")
        : path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "omnicode"))
    const autoFile = path.join(stateDir, "auto-model.json")
    if (fs.existsSync(autoFile)) {
      const content = JSON.parse(fs.readFileSync(autoFile, "utf8"))
      if (typeof content.thinkingRouting === "boolean") {
        cachedThinkingEnabled = { value: content.thinkingRouting, timestamp: now }
        return content.thinkingRouting
      }
    }
  } catch {
    // ignore
  }

  cachedThinkingEnabled = { value: true, timestamp: now }
  return true
}

function resolveAgentThinkingLevel(agentId: string): "off" | "low" | "medium" | "high" | "max" {
  if (agentId === "explore" || agentId === "librarian") return "low"
  if (agentId === "architect" || agentId === "reviewer") return "max"
  return "medium"
}

function getManualThinkingLevel(): "off" | "low" | "medium" | "high" | "max" {
  if (process.env.OMNICODE_MANUAL_THINKING) {
    const val = process.env.OMNICODE_MANUAL_THINKING.toLowerCase()
    if (val === "off" || val === "low" || val === "medium" || val === "high" || val === "max") {
      return val as any
    }
  }

  try {
    const stateDir =
      process.env.OMNICODE_STATE_DIR ||
      (process.platform === "win32"
        ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "omnicode", "state")
        : path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "omnicode"))
    const autoFile = path.join(stateDir, "auto-model.json")
    if (fs.existsSync(autoFile)) {
      const content = JSON.parse(fs.readFileSync(autoFile, "utf8"))
      if (typeof content.manualThinking === "string") {
        return content.manualThinking as any
      }
    }
  } catch {
    // ignore
  }

  return "medium"
}

function safeVariantForModel(
  modelInfo: Model.Info | undefined,
  level: "off" | "low" | "medium" | "high" | "max" | undefined,
): Model.VariantID | undefined {
  if (!level || !modelInfo || !modelInfo.variants || modelInfo.variants.length === 0) {
    return undefined
  }

  if (level === "off") {
    const offMatch = modelInfo.variants.find((v) => /^(none|off|disabled|0)$/i.test(v.id))
    return offMatch?.id ?? undefined
  }

  if (level === "low") {
    const lowMatch = modelInfo.variants.find((v) => /^(low|1k|fast|min)/i.test(v.id))
    return lowMatch?.id ?? modelInfo.variants[0]?.id
  }

  if (level === "max" || level === "high") {
    const maxMatch = modelInfo.variants.find((v) => /^(max|high|xhigh|32k|thinking)/i.test(v.id))
    return maxMatch?.id ?? modelInfo.variants[modelInfo.variants.length - 1]?.id
  }

  const medMatch = modelInfo.variants.find((v) => /^(medium|mid|8k|thinking)/i.test(v.id))
  return medMatch?.id ?? modelInfo.variants[Math.floor(modelInfo.variants.length / 2)]?.id
}

export const Input = Schema.Struct({
  agent: Schema.String.annotate({
    description:
      "The type of specialized agent to use for this task. If the user asks for a subagent by a name that is not one of the available subagents, they most likely mean a model: pick a suitable agent and pass the name through the model parameter instead.",
  }),
  description: Schema.String.annotate({ description: "A short 3-5 word label for the task, displayed to the user" }),
  prompt: Schema.String.annotate({ description: "The task for the subagent to perform" }),
  model: Schema.optionalKey(Schema.String).annotate({
    description:
      'NEVER set this unless the user explicitly asks for a particular model or variant. It must be a chat model; image and decision models can\'t run subagents. The value is written as "providerID/modelID", or "providerID/modelID#variant" to include a variant. Do not guess the ID: look the model up with the models tool, filtering to your own provider first.',
  }),
  sessionID: Schema.optionalKey(SessionSchema.ID).annotate({
    description: "Send a follow-up to an existing subagent, running or finished. Omit to start a new one.",
  }),
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Run the subagent in the background and return immediately. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress.",
  }),
})

export const Output = Schema.Struct({
  sessionID: SessionSchema.ID,
  status: Schema.Literals(["completed", "running"]),
  output: Schema.String,
})
export const description = [
  "Spawns an agent in a child session to work on the specified task.",
  "The output includes a sessionID you can pass back later to continue that specific conversation with the subagent.",
  "New child sessions start with fresh context, so include all relevant context and instructions when you don't pass a sessionID.",
  "Foreground (default) runs the subagent to completion and returns its final response.",
  "Background mode (background=true) launches it asynchronously and returns immediately; you are notified when it finishes.",
  "Use background only for independent work that can run while you continue elsewhere.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.subagent",
  effect: Effect.fn("SubagentTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const models = yield* Model.Service
    const subagents = yield* SubagentJob.Service
    const orchestratorOpt = yield* Effect.serviceOption(OmniOrchestrator.Service)
    const omniBusOpt = yield* Effect.serviceOption(OmniBus.Service)

    const resolveModel = Effect.fn("SubagentTool.resolveModel")(function* (input: string) {
      const ref = yield* Effect.try({
        try: () => Model.Ref.parse(input),
        catch: () =>
          new ToolFailure({
            message: `Invalid model "${input}". Use "providerID/modelID" or "providerID/modelID#variant".`,
          }),
      })
      const model = (yield* models.available()).find(
        (model) => model.providerID === ref.providerID && model.id === ref.id,
      )
      if (model === undefined) {
        const other = (yield* models.available(["image", "decision"])).find(
          (model) => model.providerID === ref.providerID && model.id === ref.id,
        )
        return yield* new ToolFailure({
          message: other
            ? `Model "${ref.providerID}/${ref.id}" is ${other.type === "image" ? "an image" : "a decision"} model; subagents need a chat model. Use the models tool to find one.`
            : `Model "${ref.providerID}/${ref.id}" is not available. Use the models tool to see what is available.`,
        })
      }
      if (ref.variant !== undefined && !model.variants.some((variant) => variant.id === ref.variant))
        return yield* new ToolFailure({
          message:
            model.variants.length === 0
              ? `Model "${ref.providerID}/${ref.id}" has no variants. Omit the variant.`
              : `Variant "${ref.variant}" is not available for "${ref.providerID}/${ref.id}". Available: ${model.variants.map((variant) => variant.id).join(", ")}.`,
        })
      return ref
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const parent = yield* sessions
                .get(context.sessionID)
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                  ),
                )
              let current = parent
              let depth = 0
              while (current.parentID) {
                depth++
                current = yield* sessions
                  .get(current.parentID)
                  .pipe(
                    Effect.mapError(
                      (error) => new ToolFailure({ message: `Parent session not found: ${current.parentID}`, error }),
                    ),
                  )
              }
              const limit = Config.latest(yield* config.entries(), "experimental")?.subagent_depth ?? 1
              if (depth >= limit)
                return yield* new ToolFailure({
                  message: `Subagent depth limit reached (${limit}). Increase "experimental.subagent_depth" to allow nested subagents.`,
                })
              const agent = yield* agents.resolve(input.agent)
              if (agent === undefined) return yield* new ToolFailure({ message: `Unknown agent: ${input.agent}` })
              if (agent.mode === "primary")
                return yield* new ToolFailure({ message: `Agent ${input.agent} cannot run as a subagent` })
              yield* permission
                .assert({
                  action: name,
                  resources: [agent.id],
                  save: [agent.id],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: {
                    type: "tool",
                    messageID: context.messageID,
                    id: context.id,
                  },
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: `Subagent denied: ${agent.id}`, error })))

              const existing =
                input.sessionID === undefined
                  ? undefined
                  : yield* sessions
                      .get(input.sessionID)
                      .pipe(
                        Effect.mapError(
                          (error) =>
                            new ToolFailure({ message: `Subagent session not found: ${input.sessionID}`, error }),
                        ),
                      )
              if (existing !== undefined && existing.parentID !== context.sessionID)
                return yield* new ToolFailure({
                  message: `Session ${existing.id} is not a child of the current session`,
                })
              const override = input.model === undefined ? undefined : yield* resolveModel(input.model)

              const allowedSet = process.env.OMNICODE_ACTIVE === "1" ? resolveOmniAllowedModels() : undefined
              const hasAllowedConstraint = allowedSet !== undefined && allowedSet.size > 0
              const isAllowed = (m: typeof parent.model) =>
                m !== undefined && (!hasAllowedConstraint || allowedSet.has(`${m.providerID}/${m.id}`))

              let routedModel: typeof parent.model = undefined
              if (
                process.env.OMNICODE_ACTIVE === "1" &&
                Option.isSome(orchestratorOpt) &&
                override === undefined
              ) {
                const availableList = yield* models.available()
                const candidatePool = hasAllowedConstraint
                  ? availableList.filter((m) => allowedSet.has(`${m.providerID}/${m.id}`))
                  : availableList
                const pool = candidatePool.length > 0 ? candidatePool : availableList

                const agentModelAllowed =
                  agent.model !== undefined &&
                  isAllowed(agent.model) &&
                  pool.some((m) => m.providerID === agent.model?.providerID && m.id === agent.model?.id)

                if (!agentModelAllowed) {
                  const selection = yield* orchestratorOpt.value.selectModelForAgent(
                    agent.id,
                    `${input.description} ${input.prompt}`,
                    pool,
                  )
                  const matched = selection.primary
                    ? pool.find(
                        (m) => m.providerID === selection.primary?.providerID && m.id === selection.primary?.id,
                      )
                    : undefined
                  routedModel = matched
                    ? {
                        providerID: matched.providerID,
                        id: matched.id,
                        variant: isThinkingRoutingEnabled()
                          ? safeVariantForModel(matched, selection.thinkingLevel)
                          : safeVariantForModel(matched, getManualThinkingLevel()),
                      }
                    : undefined
                }
              }

              // Continuing with a different agent switches the child, mirroring create semantics
              // where an explicit model wins over the agent's configured model, which wins over the inherited one.
              if (existing !== undefined) {
                const switched = existing.agent !== agent.id
                const model =
                  override ?? (switched ? ((isAllowed(agent.model) ? agent.model : undefined) ?? routedModel) : undefined)
                yield* Effect.all([
                  switched ? sessions.switchAgent({ sessionID: existing.id, agent: agent.id }) : Effect.void,
                  model === undefined ? Effect.void : sessions.switchModel({ sessionID: existing.id, model }),
                ]).pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Failed to switch subagent session: ${existing.id}`, error }),
                  ),
                )
              }

              const configuredModelInfo =
                agent.model ? pool.find((m) => m.providerID === agent.model?.providerID && m.id === agent.model?.id) : undefined

              const configuredWithThinking =
                isAllowed(agent.model) && agent.model
                  ? {
                      ...agent.model,
                      variant:
                        agent.model.variant ??
                        (isThinkingRoutingEnabled()
                          ? safeVariantForModel(configuredModelInfo, resolveAgentThinkingLevel(agent.id))
                          : safeVariantForModel(configuredModelInfo, getManualThinkingLevel())),
                    }
                  : undefined

              const model =
                override ??
                routedModel ??
                configuredWithThinking ??
                (isAllowed(parent.model) ? parent.model : undefined) ??
                routedModel ??
                parent.model
              const child =
                existing ??
                (yield* sessions
                  .create({
                    parentID: context.sessionID,
                    title: input.description,
                    agent: agent.id,
                    model,
                  })
                  .pipe(
                    Effect.mapError(
                      (error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                    ),
                  ))

              const background = input.background === true
              yield* context.progress({ sessionID: child.id, status: "running" })

              const boomerangSuffix =
                process.env.OMNICODE_ACTIVE === "1" && Option.isSome(orchestratorOpt) && existing === undefined
                  ? `\n\n${orchestratorOpt.value.formatBoomerangContract(agent.id)}`
                  : ""

              const sharedBusDigest =
                process.env.OMNICODE_ACTIVE === "1" && Option.isSome(omniBusOpt)
                  ? yield* omniBusOpt.value.formatContextDigest(context.sessionID, 6)
                  : ""
              const busContextBlock = sharedBusDigest ? `\n\n${sharedBusDigest}` : ""

              // Standard prompt admission outside the job: Job.start joining a running child skips
              // its run effect, and the default wake starts an idle child or steers a running one.
              yield* sessions
                .prompt({
                  sessionID: child.id,
                  text:
                    existing === undefined
                      ? [
                          "You are a subagent spawned by another session.",
                          `${input.prompt}${busContextBlock}${boomerangSuffix}`,
                        ].join("\n")
                      : `${input.prompt}${busContextBlock}`,
                  ...(background && existing === undefined ? { resume: false } : {}),
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Failed to prompt subagent: ${child.id}`, error }),
                  ),
                )

              const recovery = {
                kind: "subagent" as const,
                parentSessionID: context.sessionID,
                childSessionID: child.id,
                agent: agent.name,
                description: input.description,
              }
              yield* subagents.start(recovery)

              if (background) {
                yield* subagents.background(recovery)
                return backgroundResult(child.id)
              }

              const result = yield* jobs.block({ id: child.id, sessionID: context.sessionID }).pipe(
                Effect.onInterrupt(() =>
                  Effect.all([sessions.interrupt(child.id), jobs.cancel(child.id)], {
                    discard: true,
                  }),
                ),
              )
              if (result?.type === "backgrounded") {
                yield* subagents.notify(recovery, result.info.started_at)
                return backgroundResult(child.id)
              }
              // Failure surfaces keep the sessionID visible so the model can continue the child.
              if (result?.info.status === "error")
                return yield* new ToolFailure({
                  message: `Subagent failed (sessionID: ${child.id}): ${result.info.error ?? "unknown error"}`,
                })
              if (result?.info.status === "cancelled")
                return yield* new ToolFailure({ message: `Subagent cancelled (sessionID: ${child.id})` })
              const finalOutput = result?.info.output ?? SubagentCompletion.NO_TEXT
              if (process.env.OMNICODE_ACTIVE === "1" && Option.isSome(omniBusOpt)) {
                yield* omniBusOpt.value.publish({
                  sender: `@${agent.id} (${child.id})`,
                  target: "*",
                  taskId: input.description,
                  sessionID: child.id,
                  parentSessionID: context.sessionID,
                  type: "artifact",
                  payload: finalOutput.slice(0, 800),
                })
              }
              return {
                sessionID: child.id,
                status: "completed" as const,
                output: finalOutput,
              }
            }).pipe(
              Effect.map((output) => ({
                output,
                content:
                  output.status === "completed"
                    ? `<subagent sessionID="${output.sessionID}" state="completed">\n${output.output}\n</subagent>`
                    : output.output,
                metadata: { sessionID: output.sessionID, status: output.status },
              })),
            ),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.sync(() => {
        if (event.tool !== name || !Predicate.isObject(event.input)) return
        if (event.input.model !== "" && event.input.sessionID !== "") return
        const input = { ...event.input }
        if (input.model === "") delete input.model
        if (input.sessionID === "") delete input.sessionID
        event.input = input
      }),
    )

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        const selected = yield* agents.resolve(event.agent)
        if (!selected) return
        const available = (yield* agents.list())
          .filter(
            (agent) =>
              agent.mode !== "primary" &&
              !agent.hidden &&
              Permission.evaluate(name, agent.id, selected.permissions).effect !== "deny",
          )
          .toSorted((a, b) => a.id.localeCompare(b.id))
        if (available.length === 0) return
        tool.description = [
          tool.description,
          "",
          "Available subagents:",
          ...available.map(
            (agent) =>
              `- ${agent.id}: ${agent.description ?? "This subagent should only be called when explicitly requested."}`,
          ),
        ].join("\n")
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
