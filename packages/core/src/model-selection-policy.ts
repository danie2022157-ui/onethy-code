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
  readonly isCoolingDown?: (ref: Model.Ref) => boolean
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

  const sorted = [...eligible].sort((left, right) => key(left).localeCompare(key(right)))
  const healthy = sorted.filter((model) => !policy.isCoolingDown?.(Model.Ref.make({ providerID: model.providerID, id: model.id })))
  const selected = healthy[0] ?? sorted[0]
  return {
    selected,
    reason: healthy.length < sorted.length ? "cooldown-avoidance" : "capability",
    candidateCount: sorted.length,
    cooldownAffected: healthy.length < sorted.length,
  }
}
