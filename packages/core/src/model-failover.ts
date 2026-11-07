/** Conservative failover decisions. No string-search of user or event content. */
import { AIError, HttpContext, QuotaExceededError, RateLimitError, type LLMRequest } from "@opencode/ai/effect"
import type { Model } from "./model.js"
import { ModelSelectionPolicy } from "./model-selection-policy.js"

export const DEFAULT_COOLDOWN_MS = 5 * 60_000
export const MAX_COOLDOWN_MS = 15 * 60_000
export const MAX_FAILOVERS_PER_STEP = 2

export function rateLimitCooldown(
  error: AIError,
  model?: { readonly providerID: string; readonly id: string },
): number | undefined {
  const reason = error.reason
  if (reason._tag !== "RateLimit" && reason._tag !== "QuotaExceeded" && reason.http?.status !== 429)
    return undefined
  // The Antigravity plugin manages per-account quota resets independently.
  // Only the OnethyCode model-routing cooldown is five minutes.
  if (model && /antigravity/i.test(model.providerID + "/" + model.id))
    return DEFAULT_COOLDOWN_MS
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
  rankBy: "cost" | "context" | "newest" = "cost",
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
      rankBy,
      requireHealthy: true,
    }
    if (crossProvider.length) {
      try { return ModelSelectionPolicy.select(crossProvider, policy).selected } catch { /* same provider fallback */ }
    }
    return ModelSelectionPolicy.select(safe, policy).selected
  } catch {
    // No connected eligible candidate or a malformed allowlist: fail closed.
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
export function canFailover(
  hasPinnedModel: boolean,
  env: NodeJS.ProcessEnv = process.env,
  explicitAuto?: boolean,
): boolean {
  return env.OMNICODE_ACTIVE === "1" && env.ONETHY_AUTO_FAILOVER !== "off" &&
    (explicitAuto === false ? false : explicitAuto === true ? true :
      !hasPinnedModel || env.OMNICODE_AUTO_MODEL === "1")
}

/**
 * A prompt carries its own immutable Omni Auto selection. The TUI is often a
 * separate process from the session runner: mutating process.env in the TUI
 * cannot authorize a failover inside the server.
 */
export const AUTO_FAILOVER_KEY = "onethy.autoFailover"
export interface AutoFailoverIntent {
  readonly enabled: boolean
  readonly allowedModels?: readonly string[]
}
type UserMessage = { readonly type: string; readonly metadata?: Readonly<Record<string, unknown>> }

export function readAutoFailoverIntent(messages: ReadonlyArray<UserMessage>): AutoFailoverIntent | undefined {
  const latest = messages.findLast((item) => item.type === "user")
  if (!latest || !latest.metadata || !(AUTO_FAILOVER_KEY in latest.metadata)) return
  const value = latest.metadata[AUTO_FAILOVER_KEY]
  if (!value || typeof value !== "object" || Array.isArray(value)) return { enabled: false }
  const item = value as Record<string, unknown>
  if (item.version !== 1 || typeof item.enabled !== "boolean") return { enabled: false }
  if (!item.enabled) return { enabled: false }
  if (item.allowedModels === null || item.allowedModels === undefined) return { enabled: true }
  if (!Array.isArray(item.allowedModels) || item.allowedModels.length > 100 ||
    !item.allowedModels.every((x) => typeof x === "string" && /^[^\s/]+\/[^\s/]+$/.test(x)))
    return { enabled: false }
  return { enabled: true, allowedModels: [...new Set(item.allowedModels)] }
}

/**
 * The native Antigravity extension may throw its Google 429 as a plain Error
 * or emit a provider-error event instead of an AIError. Recognize only the
 * provider's precise diagnostic envelope, never transcript or arbitrary text.
 */
export function antigravity429(error: unknown, model: { providerID: string; id: string }): AIError | undefined {
  if (!/antigravity/i.test(model.providerID + "/" + model.id)) return
  if (error instanceof AIError &&
    (error.reason._tag === "RateLimit" || error.reason._tag === "QuotaExceeded")) return error
  const text = typeof error === "string" ? error :
    error instanceof AIError ? error.reason.message :
    error instanceof Error ? error.message : undefined
  if (!text || text.length > 32_768) return
  // The current Antigravity OAuth adapter may omit HTTP status from SSE
  // failures. Only a precise provider-owned account-limit refusal is enough
  // to mark this model temporarily unhealthy; never parse user prompt text.
  if (/^(?:Error:\s*)?(?:The\s+)?usage limit (?:has been )?(?:reached|exceeded)\.?$/i.test(text.trim())) {
    return new AIError({ reason: new QuotaExceededError({
      message: "Antigravity account usage limit reached. Choose a different authorized model.",
    }) })
  }
  const individualQuota = /\bIndividual quota reached\b/i.test(text)
  const resourceExhausted = /\bResource has been exhausted\b/i.test(text)
  if ((!individualQuota && !resourceExhausted) ||
    !/\[Debug Info\]/i.test(text) ||
    !/^\s*Endpoint:\s*https:\/\/(?:daily-)?cloudcode-pa\.googleapis\.com\/v1internal(?::|\/)/mi.test(text) ||
    !/^\s*Status:\s*429\s*$/mi.test(text)) return
  // Strip project identifiers, credentials and any untrusted provider detail.
  return new AIError({ reason: new RateLimitError({
    message: individualQuota
      ? "Antigravity individual quota reached; switching to another allowed model."
      : "Antigravity Google endpoint exhausted its quota (HTTP 429); switching to another allowed model.",
    http: new HttpContext({
      url: "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent",
      status: 429,
      headers: {},
    }),
  }) })
}
