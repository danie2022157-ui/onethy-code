/** Conservative failover decisions. No string-search of user or event content. */
import type { AIError } from "@opencode/ai/effect"
import type { Model } from "./model.js"
import { ModelSelectionPolicy } from "./model-selection-policy.js"

export const DEFAULT_COOLDOWN_MS = 5 * 60_000
export const MAX_COOLDOWN_MS = 15 * 60_000
export const MAX_FAILOVERS_PER_STEP = 2

export function rateLimitCooldown(error: AIError): number | undefined {
  const reason = error.reason
  if (reason._tag !== "RateLimit" && reason._tag !== "QuotaExceeded" && reason.http?.status !== 429)
    return undefined
  const after = "retryAfterMs" in reason ? reason.retryAfterMs : undefined
  return typeof after === "number" && Number.isFinite(after) && after >= 0
    ? Math.min(MAX_COOLDOWN_MS, Math.max(1_000, Math.ceil(after)))
    : DEFAULT_COOLDOWN_MS
}

type Candidate = Pick<Model.Info,
  "id" | "providerID" | "type" | "enabled" | "status" | "capabilities" | "limit">
type Identity = Pick<Model.Ref, "providerID" | "id">

export function selectFailoverModel(
  catalog: ReadonlyArray<Model.Info>,
  current: Identity & { readonly capabilities: Model.Capabilities },
  excluded: ReadonlySet<string>,
  allowedModels: ReadonlyArray<string> | undefined,
  minimumContext: number,
): Model.Info | undefined {
  const key = (item: Identity) => String(item.providerID) + "/" + String(item.id)
  const safe = catalog.filter((candidate: Candidate) =>
    key(candidate) !== key(current) &&
    !excluded.has(key(candidate)) &&
    candidate.enabled && candidate.status !== "deprecated" &&
    (candidate.type ?? "chat") === "chat" &&
    candidate.capabilities.tools === current.capabilities.tools &&
    current.capabilities.input.every((type) => candidate.capabilities.input.includes(type)) &&
    current.capabilities.output.every((type) => candidate.capabilities.output.includes(type)) &&
    candidate.limit.context >= minimumContext)
  if (!safe.length) return
  // A healthy alternative provider is preferred when a provider's shared quota is exhausted.
  const crossProvider = safe.filter((candidate) => candidate.providerID !== current.providerID)
  try {
    const policy = {
      mode: "automatic" as const,
      allowedModels,
      requiredTypes: ["chat" as const],
      requiredCapabilities: {
        tools: current.capabilities.tools,
        input: current.capabilities.input,
        output: current.capabilities.output,
      },
      minimumContext,
      rankBy: "cost" as const,
    }
    if (crossProvider.length) {
      try { return ModelSelectionPolicy.select(crossProvider, policy).selected } catch { /* same provider fallback */ }
    }
    return ModelSelectionPolicy.select(safe, policy).selected
  } catch (error) {
    // Test-only diagnostic, removed before production merge.
    if (process.env.ONETHY_DEBUG_FAILOVER === "1") throw error
    return
  }
}

export function allowedAutoModels(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  try {
    const result: unknown = JSON.parse(raw)
    if (!Array.isArray(result) || result.length === 0 ||
      !result.every((model) => typeof model === "string" && /^[^\s/]+\/[^\s/]+$/.test(model)))
      return []
    return result
  } catch {
    return []
  }
}

/** Sessions with a manually pinned model must not be rerouted unless their TUI
 * explicitly enabled Omni's automatic model-selection mode for this process. */
export function canFailover(hasPinnedModel: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OMNICODE_ACTIVE === "1" && env.ONETHY_AUTO_FAILOVER !== "off" &&
    (!hasPinnedModel || env.OMNICODE_AUTO_MODEL === "1")
}
