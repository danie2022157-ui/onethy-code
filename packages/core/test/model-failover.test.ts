import { describe, expect, it } from "bun:test"
import { AIError, RateLimitError, InvalidProviderOutputError } from "@opencode/ai/effect"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { allowedAutoModels, canFailover, rateLimitCooldown, selectFailoverModel, antigravity429, readAutoFailoverIntent, AUTO_FAILOVER_KEY } from "../src/model-failover"

const info = (provider: string, id: string, options: Partial<Model.Info> = {}): Model.Info => ({
  ...Model.Info.default(Provider.ID.make(provider), Model.ID.make(id)),
  enabled: true, status: "active",
  capabilities: { ...Model.Capabilities.default(), tools: true, input: ["text"], output: ["text"] },
  limit: { context: 128_000, output: 8_192 },
  ...options,
})
const primary = info("openai", "gpt-6-luna")
const options = [
  primary,
  info("openai", "gpt-6-sol"),
  info("antigravity", "gemini-4-argon"),
]

describe("provider failover decision", () => {
  it("recognizes structured rate limits and respects the provider retry-after", () => {
    expect(rateLimitCooldown(new AIError({ reason: new RateLimitError({ message: "wait", retryAfterMs: 610_000 }) }))).toBe(610_000)
    expect(rateLimitCooldown(new AIError({ reason: new RateLimitError({ message: "rate limited" }) }))).toBe(300_000)
    expect(rateLimitCooldown(new AIError({ reason: new InvalidProviderOutputError({ message: "This text mentions HTTP 429", classification: "incomplete-stream" }) }))).toBeUndefined()
  })
  it("prefers another connected provider with compatible capabilities", () => {
    const selected = selectFailoverModel(options, { ...primary, capabilities: primary.capabilities },
      new Set(["openai/gpt-6-luna"]), undefined, 120_000)
    expect(selected?.providerID).toBe("antigravity")
  })
  it("honors strict allowed models and excludes cooled or incompatible models", () => {
    expect(selectFailoverModel(options, primary, new Set(["openai/gpt-6-luna"]), ["openai/gpt-6-sol"], 50_000)?.id).toBe("gpt-6-sol")
    expect(selectFailoverModel(options, primary,
      new Set(["openai/gpt-6-luna", "openai/gpt-6-sol", "antigravity/gemini-4-argon"]), undefined, 50_000)).toBeUndefined()
    expect(selectFailoverModel(options, primary, new Set(["openai/gpt-6-luna"]), ["unavailable/missing"], 50_000)).toBeUndefined()
    expect(selectFailoverModel(options, primary, new Set(["openai/gpt-6-luna"]), undefined, 999_000)).toBeUndefined()
    expect(selectFailoverModel([primary, info("p", "no-tools", {
      capabilities: { ...primary.capabilities, tools: false },
    })], primary, new Set(["openai/gpt-6-luna"]), undefined, 30_000)).toBeUndefined()
  })
  it("does not reroute a pinned user selection unless Omni Auto explicitly enabled", () => {
    expect(canFailover(true, { OMNICODE_ACTIVE: "1" })).toBe(false)
    expect(canFailover(true, { OMNICODE_ACTIVE: "1", OMNICODE_AUTO_MODEL: "1" })).toBe(true)
    expect(canFailover(false, { OMNICODE_ACTIVE: "1" })).toBe(true)
    expect(canFailover(false, { OMNICODE_ACTIVE: "1", ONETHY_AUTO_FAILOVER: "off" })).toBe(false)
    expect(allowedAutoModels('["openai/gpt-6-luna","antigravity/gemini-4-argon"]')).toHaveLength(2)
    expect(allowedAutoModels('["bad-model"]')).toEqual([])
  })
  const antigravityDebug = [
    "Error: Resource has been exhausted (e.g. check quota).",
    "",
    "[Debug Info]",
    "Requested Model: antigravity-gemini-3.8-flash",
    "Effective Model: gemini-3.8-flash-low",
    "Project: aico****mers",
    "Endpoint: https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
    "Status: 429",
    "Request ID: N/A",
  ].join("\n")
  it("converts precisely identified Antigravity Google 429 envelopes without leaking project data", () => {
    const failure = antigravity429(new Error(antigravityDebug), {
      providerID: "antigravity", id: "antigravity-gemini-3.8-flash",
    })
    expect(failure?.reason._tag).toBe("RateLimit")
    expect(failure?.reason.http?.status).toBe(429)
    expect(rateLimitCooldown(failure!)).toBe(5 * 60_000)
    expect(failure?.message).not.toContain("aico****mers")
    expect(antigravity429(antigravityDebug, {
      providerID: "google", id: "antigravity-gemini-3.8-flash",
    })?.reason._tag).toBe("RateLimit")
  })
  it("detects daily Antigravity individual quota and honors its reset window", () => {
    const message = [
      "Error: Individual quota reached. Please upgrade your subscription to increase your limits. quota resets in 132h 30m 27s.",
      "",
      "[Debug Info]",
      "Requested Model: antigravity-claude-sonnet-5-5",
      "Effective Model: claude-sonnet-5-5-low",
      "Project: aico****mers",
      "Endpoint: https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
      "Status: 429",
      "Request ID: N/A",
    ].join("\\n").replaceAll("\\n", "\n")
    const failure = antigravity429(new Error(message), {
      providerID: "antigravity", id: "antigravity-claude-sonnet-5-5",
    })
    expect(failure?.reason._tag).toBe("RateLimit")
    expect(failure?.reason.http?.status).toBe(429)
    expect(rateLimitCooldown(failure!)).toBe(((132 * 60 + 30) * 60 + 27) * 1_000)
    expect(failure?.message).not.toContain("aico****mers")
    expect(antigravity429(message.replace("Status: 429", "Status: 403"), {
      providerID: "antigravity", id: "claude-sonnet-5-5",
    })).toBeUndefined()
  })
  it("does not classify messages or non-Antigravity responses as 429s", () => {
    const model = { providerID: "antigravity", id: "gemini" }
    expect(antigravity429(antigravityDebug, { providerID: "google", id: "gemini" })).toBeUndefined()
    expect(antigravity429(antigravityDebug.replace("Status: 429", "Status: 400"), model)).toBeUndefined()
    expect(antigravity429(antigravityDebug.replace("cloudcode-pa.googleapis.com", "malicious.example.com"), model)).toBeUndefined()
    expect(antigravity429("User typed: HTTP 429, resource has been exhausted", model)).toBeUndefined()
  })
  it("authorizes the specific prompt's Omni Auto intent, never an older prompt's choice", () => {
    const auto = {
      type: "user", metadata: { [AUTO_FAILOVER_KEY]: {
        version: 1, enabled: true, allowedModels: ["openai/gpt-6-luna", "antigravity/gemini-3.8-flash"],
      } },
    }
    expect(readAutoFailoverIntent([auto])).toEqual({
      enabled: true, allowedModels: ["openai/gpt-6-luna", "antigravity/gemini-3.8-flash"],
    })
    expect(canFailover(true, { OMNICODE_ACTIVE: "1", OMNICODE_AUTO_MODEL: "0" }, true)).toBe(true)
    expect(canFailover(true, { OMNICODE_ACTIVE: "1", OMNICODE_AUTO_MODEL: "1" }, false)).toBe(false)
    expect(canFailover(true, { OMNICODE_ACTIVE: "1", ONETHY_AUTO_FAILOVER: "off" }, true)).toBe(false)
    expect(readAutoFailoverIntent([auto, { type: "assistant" }, { type: "user" }])).toBeUndefined()
    expect(readAutoFailoverIntent([{ ...auto, metadata: { [AUTO_FAILOVER_KEY]: {
      version: 1, enabled: true, allowedModels: ["not-a-model"],
    } } }])).toEqual({ enabled: false })
  })

})
