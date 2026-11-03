export * as SessionRunnerModel from "./model.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LanguageModel } from "@opencode/ai/effect"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Context, Effect, Layer, Schema } from "effect"
import { Agent } from "../../agent.js"
import { ModelResolver } from "../../model-resolver.js"
import { ModelSelectionPolicy } from "../../model-selection-policy.js"
import { OmniOrchestrator } from "../../omni-orchestrator.js"
import { SessionSchema } from "../schema.js"

export class ModelNotSelectedError extends Schema.TaggedError<ModelNotSelectedError>()(
  "SessionRunnerModel.ModelNotSelectedError",
  { sessionID: SessionSchema.ID },
) {
  override get message() {
    return `No model is available for session ${this.sessionID}`
  }
}

export class ModelUnavailableError extends Schema.TaggedError<ModelUnavailableError>()(
  "SessionRunnerModel.ModelUnavailableError",
  { providerID: Provider.ID, modelID: Model.ID },
) {
  override get message() {
    if (this.providerID === "azure-cognitive-services")
      return `Model unavailable: ${this.providerID}/${this.modelID}. This provider has been deprecated; use azure/${this.modelID} instead.`
    if (this.providerID === "google-vertex-anthropic")
      return `Model unavailable: ${this.providerID}/${this.modelID}. This provider has been deprecated; use google-vertex/${this.modelID} instead.`
    return `Model unavailable: ${this.providerID}/${this.modelID}`
  }
}
export class CooldownServiceUnavailableError extends Schema.TaggedError<CooldownServiceUnavailableError>()(
  "SessionRunnerModel.CooldownServiceUnavailableError",
  { sessionID: SessionSchema.ID },
) {
  override get message() {
    return `Model cooldown service is unavailable for session ${this.sessionID}`
  }
}
export type Error = ModelNotSelectedError | ModelUnavailableError | CooldownServiceUnavailableError | ModelResolver.Error
export type Resolved = ModelResolver.Resolved

export interface Interface {
  /** Availability is sampled lazily for each explicitly selected model resolution. */
  readonly resolve: (
    session: SessionSchema.Info,
    available: () => Effect.Effect<ReadonlyArray<Model.Info>>,
  ) => Effect.Effect<Resolved, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunnerModel") {}

/** Builds a Resolved whose catalog identity mirrors the route model. Test or embedding seam. */
export const resolved = (
  model: LanguageModel,
  options: {
    readonly capabilities: Model.Capabilities
    readonly variant?: Model.VariantID
    readonly cost: Model.Info["cost"]
    readonly limit: Model.Info["limit"]
    readonly compaction?: Provider.Compaction
    readonly transport?: Provider.Transport
  },
): Resolved => ({
  model,
  ref: Model.Ref.make({
    id: Model.ID.make(model.id),
    providerID: Provider.ID.make(model.provider),
    ...(options.variant === undefined ? {} : { variant: options.variant }),
  }),
  capabilities: options.capabilities,
  cost: options.cost,
  limit: options.limit,
  compaction: options.compaction,
  transport: options.transport,
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const resolver = yield* ModelResolver.Service
    const agents = yield* Agent.Service
    return Service.of({
      resolve: Effect.fn("SessionRunnerModel.resolve")(function* (session, available) {
        // Location plugins populate and filter the catalog asynchronously during layer startup.
        const allowedModels = Effect.try({
          try: () => {
            if (process.env.OMNICODE_ALLOWED_MODELS === undefined) return undefined
            const parsed: unknown = JSON.parse(process.env.OMNICODE_ALLOWED_MODELS)
            if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((item) => typeof item === "string"))
              throw new Error("OMNICODE_ALLOWED_MODELS must be a non-empty JSON array of model refs")
            return parsed
          },
          catch: () => new ModelNotSelectedError({ sessionID: session.id }),
        })
        if (!session.model) {
          const agent = (yield* agents.select(session.agent)).info?.model
          const list = yield* available()
          // The Omni allowlist controls automatic routing, not an agent explicitly configured with a model.
          const configuredAllowlist = agent ? undefined : yield* allowedModels
          // The general runner graph does not install the Omni plugin graph. Active Omni automatic routing
          // therefore requires the caller's Location context to provide this service explicitly.
          const orchestrator = yield* Effect.serviceOption(OmniOrchestrator.Service)
          if (process.env.OMNICODE_ACTIVE === "1" && !agent && orchestrator._tag === "None")
            return yield* new CooldownServiceUnavailableError({ sessionID: session.id })
          const coolingDown = new Set<string>()
          if (process.env.OMNICODE_ACTIVE === "1" && !agent && orchestrator._tag === "Some") {
            for (const model of list) {
              if (yield* orchestrator.value.isModelInCooldown(model.providerID, model.id))
                coolingDown.add(`${model.providerID}/${model.id}`)
            }
          }
          const preferred = yield* Effect.try({
            try: () => ModelSelectionPolicy.select(list, {
              mode: agent ? "explicit" : "automatic",
              allowedModels: configuredAllowlist,
              requiredTypes: ["chat"],
              requiredCapabilities: { tools: true },
              isCoolingDown: (ref) => coolingDown.has(`${ref.providerID}/${ref.id}`),
            }, agent).selected,
            catch: () => new ModelNotSelectedError({ sessionID: session.id }),
          })
          const resolved = yield* resolver.resolveModel(preferred, agent?.variant)
          if (resolved) return resolved
          return yield* new ModelNotSelectedError({ sessionID: session.id })
        }

        const sessionModel = session.model
        const list = yield* available()
        // A user-selected session model takes precedence over Omni automatic routing preferences.
        // Availability is still checked against the enabled, connected catalog.
        const selected = yield* Effect.try({
          try: () => ModelSelectionPolicy.select(list, { mode: "explicit" }, sessionModel).selected,
          catch: () => new ModelUnavailableError({ providerID: sessionModel.providerID, modelID: sessionModel.id }),
        })
        return yield* resolver.resolveModel(selected, sessionModel.variant)
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [ModelResolver.node, Agent.node] })
