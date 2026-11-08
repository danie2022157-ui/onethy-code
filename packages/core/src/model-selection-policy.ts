export * as ModelSelectionPolicy from "./model-selection-policy.js"

import { Model } from "./model.js"

export interface Policy {
  readonly mode: "explicit" | "automatic"
  readonly allowedModels?: ReadonlyArray<string>
  readonly requiredTypes?: ReadonlyArray<Model.Type>
  readonly requiredCapabilities?: {
    readonly tools?: boolean
    readonly input?: ReadonlyArray<string>
    readonly output?: ReadonlyArray<string>
  }
  readonly allowDeprecated?: boolean
  /** Ranking only uses live catalog metadata; no speculative model or provider IDs. */
  readonly rankBy?: "id" | "cost" | "context" | "newest"
  readonly minimumContext?: number
  readonly isCoolingDown?: (ref: Model.Ref) => boolean
  /** Automatic routing must not reuse a known cooled-down model when all are blocked. */
  readonly requireHealthy?: boolean
}

export interface Decision {
  readonly requested?: Model.Ref
  readonly selected: Model.Info
  readonly reason: "explicit" | "capability" | "cooldown-avoidance"
  readonly candidateCount: number
  readonly cooldownAffected: boolean
}

export class ModelUnavailableError extends Error {
  readonly _tag = "ModelUnavailableError"
  constructor(readonly requested: Model.Ref) {
    super(`Requested model ${requested.providerID}/${requested.id} is unavailable`)
  }
}

export class NoHealthyModelCandidateError extends Error {
  readonly _tag = "NoHealthyModelCandidateError"
  constructor() {
    super("All eligible models are in local router cooldown")
  }
}

export class NoModelCandidateError extends Error {
  readonly _tag = "NoModelCandidateError"
  constructor() {
    super("No connected model satisfies the selection policy")
  }
}

export function select(catalog: ReadonlyArray<Model.Info>, policy: Policy, requested?: Model.Ref): Decision {
  const allowed = policy.allowedModels?.map((ref) => {
    try {
      const parsed = Model.Ref.parse(ref)
      return `${parsed.providerID}/${parsed.id}`
    } catch {
      throw new NoModelCandidateError()
    }
  })
  if (allowed?.length === 0) throw new NoModelCandidateError()
  const key = (model: Pick<Model.Info, "providerID" | "id">) => `${model.providerID}/${model.id}`
  const eligible = catalog.filter((model) => {
    if (!model.enabled || (!policy.allowDeprecated && model.status === "deprecated")) return false
    if (policy.requiredTypes?.length && !policy.requiredTypes.includes(model.type ?? "chat")) return false
    if (policy.minimumContext !== undefined && model.limit.context < policy.minimumContext) return false
    if (allowed && !allowed.includes(key(model))) return false
    if (policy.requiredCapabilities?.tools !== undefined && model.capabilities.tools !== policy.requiredCapabilities.tools)
      return false
    if (policy.requiredCapabilities?.input?.some((type) => !model.capabilities.input.includes(type))) return false
    if (policy.requiredCapabilities?.output?.some((type) => !model.capabilities.output.includes(type))) return false
    return true
  })

  if (requested) {
    const found = catalog.find((model) => key(model) === key(requested))
    if (!found || !eligible.includes(found)) throw new ModelUnavailableError(requested)
    return { requested, selected: found, reason: "explicit", candidateCount: eligible.length, cooldownAffected: false }
  }
  if (policy.mode === "explicit") throw new NoModelCandidateError()
  if (!eligible.length) throw new NoModelCandidateError()

  const price = (model: Model.Info) => {
    // Compare a representative coding workload rather than adding input and
    // output prices equally. Include cache reads/writes when the catalog has rates.
    const tier = model.cost.find((item) => item.tier === undefined) ?? model.cost[0]
    if (!tier) return Number.POSITIVE_INFINITY
    const estimate = 0.65 * tier.input + 0.25 * tier.output +
      0.08 * tier.cache.read + 0.02 * tier.cache.write
    return Number.isFinite(estimate) && estimate >= 0 ? estimate : Number.POSITIVE_INFINITY
  }
  const rank = (model: Model.Info) => {
    if (policy.rankBy === "cost") return price(model)
    if (policy.rankBy === "context") return -model.limit.context
    if (policy.rankBy === "newest") return -model.time.released
    return 0
  }
  const sorted = [...eligible].sort((left, right) => rank(left) - rank(right) || key(left).localeCompare(key(right)))
  const healthy = sorted.filter((model) => !policy.isCoolingDown?.(Model.Ref.make({ providerID: model.providerID, id: model.id })))
  if (policy.requireHealthy && healthy.length === 0) throw new NoHealthyModelCandidateError()
  const selected = healthy[0] ?? sorted[0]
  return {
    selected,
    reason: healthy.length < sorted.length ? "cooldown-avoidance" : "capability",
    candidateCount: sorted.length,
    cooldownAffected: healthy.length < sorted.length,
  }
}
