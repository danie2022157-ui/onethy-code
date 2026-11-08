/** Conservative failover decisions. No string-search of user or event content. */
import { AIError, AuthenticationError, HttpContext, QuotaExceededError, RateLimitError, type LLMRequest } from "@opencode/ai/effect"
import type { Model } from "./model.js"
import { ModelSelectionPolicy } from "./model-selection-policy.js"

export const DEFAULT_COOLDOWN_MS = 5 * 60_000
export const MAX_COOLDOWN_MS = 15 * 60_000
export const MAX_FAILOVERS_PER_STEP = 2

/** Google exposes the Antigravity Argon alias without "antigravity" in its model ID. */
export function isAntigravityModel(model: { readonly providerID: string; readonly id: string }): boolean {
  return /antigravity/i.test(model.providerID + "/" + model.id) ||
    (model.providerID === "google" && /^gemini-4-argon(?:$|-)/i.test(model.id))
}

const ANTIGRAVITY_ENDPOINT =
  /^\s*Endpoint:\s*https:\/\/(?:daily-)?cloudcode-pa(?:\.sandbox)?\.googleapis\.com\/v1internal(?::|\/)/mi

function hasAntigravityDebugStatus(message: string, status: number): boolean {
  return /\[Debug Info\]/i.test(message) && ANTIGRAVITY_ENDPOINT.test(message) &&
    new RegExp("^\\s*Status:\\s*" + status + "\\s*$", "mi").test(message)
}

/**
 * Account-level usage or billing exhaustion on a standard provider applies to
 * every model sharing that provider credential. Antigravity buckets quota per
 * model family (Flash, Argon, Claude) and rotates across pooled accounts.
 */
export function isAccountQuotaError(
  error: AIError | { readonly type: string },
  model: { readonly providerID: string; readonly id: string },
): boolean {
  if (isAntigravityModel(model)) return false
  if (error instanceof AIError) return error.reason._tag === "QuotaExceeded"
  return (
    error.type === "provider.quota" ||
    error.type === "provider.chatgpt-limit" ||
    error.type === "provider.free-limit"
  )
}

export function rateLimitCooldown(
  error: AIError,
  model?: { readonly providerID: string; readonly id: string },
): number | undefined {
  const reason = error.reason
  if (reason._tag !== "RateLimit" && reason._tag !== "QuotaExceeded" && reason.http?.status !== 429)
    return undefined
  // The Antigravity plugin manages per-account quota resets independently.
  // Only the OnethyCode model-routing cooldown is five minutes.
  if (model && isAntigravityModel(model))
    return DEFAULT_COOLDOWN_MS
  const after = "retryAfterMs" in reason ? reason.retryAfterMs : undefined
  return typeof after === "number" && Number.isFinite(after) && after >= 0
    ? Math.min(MAX_COOLDOWN_MS, Math.max(1_000, Math.ceil(after)))
    : DEFAULT_COOLDOWN_MS
}

/** An invalid credential may fail over to a different authorized provider, not retry the same key. */
export function authenticationFailoverCooldown(error: AIError): number | undefined {
  return error.reason._tag === "Authentication" ? DEFAULT_COOLDOWN_MS : undefined
}

/**
 * A DNS/connect failure is local to the attempted endpoint, not an account
 * quota. Switch away only when the transport definitively failed before the
 * request was accepted. Never replay an accepted/ambiguous write on this basis.
 */
export function transportFailoverCooldown(error: AIError): number | undefined {
  const reason = error.reason
  if (reason._tag !== "Transport" || (reason.delivery !== undefined && reason.delivery !== "not-sent"))
    return
  if (reason.operation !== "request" && reason.operation !== "write") return
  if (!["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"].includes(reason.code ?? "") &&
      !/\bgetaddrinfo (?:ENOTFOUND|EAI_AGAIN)\b/i.test(reason.message)) return
  return DEFAULT_COOLDOWN_MS
}

/**
 * A fallback only needs input modalities actually present in this request.
 * Catalog features (e.g. PDF on the original model) are not requirements for
 * a text-only conversation. Unknown media and rich tool payloads fail closed.
 */
export function requestInputModalities(
  request: Pick<LLMRequest, "messages">,
  supported: ReadonlyArray<string>,
): string[] {
  const required = new Set<string>(["text"])
  for (const message of request.messages) {
    for (const part of message.content) {
      if (part.type === "tool-result" && part.result.type === "content") return [...supported]
      if (part.type !== "media") continue
      const mime = part.media.mediaType.toLowerCase()
      if (mime.startsWith("image/")) required.add("image")
      else if (mime.startsWith("audio/")) required.add("audio")
      else if (mime.startsWith("video/")) required.add("video")
      else if (mime === "application/pdf") required.add("pdf")
      else return [...supported]
    }
  }
  return [...required]
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
  if (!isAntigravityModel(model)) return
  if (error instanceof AIError &&
    (error.reason._tag === "RateLimit" || error.reason._tag === "QuotaExceeded")) return error
  const text = typeof error === "string" ? error :
    error instanceof AIError ? error.reason.message :
    error instanceof Error ? error.message : undefined
  if (!text || text.length > 32_768) return
  // The plugin can reject its entire Gemini account pool before a Google request begins.
  // Only the distinctive provider diagnostic, never conversational text, is accepted.
  if (/^(?:Error:\s*)?\[Antigravity\]\s+Todas (?:tus|las) cuentas \(\d+\) tienen la cuota agotada o bloqueada para gemini\b/i.test(text.trim())) {
    return new AIError({ reason: new QuotaExceededError({
      message: "Antigravity Gemini account pool is temporarily unavailable. Try another authorized model.",
    }) })
  }
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
  if ((!individualQuota && !resourceExhausted) || !hasAntigravityDebugStatus(text, 429)) return
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

/** Confirmed HTTP 400 invalid-key diagnostic: an authentication failure, not exhausted quota. */
export function antigravityAuthentication(
  error: unknown,
  model: { readonly providerID: string; readonly id: string },
): AIError | undefined {
  if (!isAntigravityModel(model)) return
  const message = typeof error === "string" ? error :
    error instanceof AIError ? error.reason.message :
    error instanceof Error ? error.message : undefined
  if (!message || message.length > 32_768 ||
    !/^(?:Error:\s*)?API key not valid\. Please pass a valid API key\./i.test(message.trim()) ||
    !hasAntigravityDebugStatus(message, 400)) return
  return new AIError({ reason: new AuthenticationError({
    message: "Antigravity Google credentials were rejected (HTTP 400). Reconnect the provider; trying another authorized provider if auto mode permits.",
    http: new HttpContext({
      url: "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent",
      status: 400,
      headers: {},
    }),
  }) })
}
