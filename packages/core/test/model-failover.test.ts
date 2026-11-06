import { describe, expect, it } from "bun:test"
import { AIError, RateLimitError, InvalidProviderOutputError } from "@opencode/ai/effect"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { allowedAutoModels, canFailover, rateLimitCooldown, selectFailoverModel } from "../src/model-failover"

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
})
