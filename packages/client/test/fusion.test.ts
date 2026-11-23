import { describe, expect, test } from "bun:test"
import {
  classifyModelBucket,
  computeRecommendedFusionPreset,
  evaluatePromptComplexity,
  routeFusionPrompt,
  type FusionCandidate,
} from "../src/fusion.js"

const MODELS: readonly FusionCandidate[] = [
  { providerID: "google", id: "gemini-3.8-flash", name: "Gemini Flash", variants: ["low", "medium", "high"] },
  { providerID: "anthropic", id: "claude-sonnet-3.7", name: "Claude Sonnet", variants: ["low", "medium", "max"] },
  { providerID: "anthropic", id: "claude-opus-4", name: "Claude Opus", variants: ["low", "medium", "max"] },
]

describe("Onethy Fusion shared routing", () => {
  test("classifies models into efficiency, balanced, and intelligence buckets", () => {
    expect(classifyModelBucket("gemini-3.8-flash", "Gemini Flash")).toBe("efficiency")
    expect(classifyModelBucket("claude-sonnet-3.7", "Claude Sonnet")).toBe("balanced")
    expect(classifyModelBucket("claude-opus-4", "Claude Opus")).toBe("intelligence")
  })

  test("evaluates prompt complexity accurately", () => {
    expect(evaluatePromptComplexity("ola tudo bem?")).toBe("low")
    expect(evaluatePromptComplexity("corrija esse bug no botão de login")).toBe("medium")
    expect(evaluatePromptComplexity("refatore a arquitetura de concorrência com segurança")).toBe("high")
  })

  test("routes prompts according to complexity and thinking routing", () => {
    const low = routeFusionPrompt({
      promptText: "oi",
      candidates: MODELS,
      tier: "default",
      thinkingRouting: true,
    })
    expect(low?.modelID).toBe("gemini-3.8-flash")
    expect(low?.thinking).toBe("low")

    const high = routeFusionPrompt({
      promptText: "analise a arquitetura de segurança e concorrência do projeto",
      candidates: MODELS,
      tier: "default",
      thinkingRouting: true,
    })
    expect(high?.modelID).toBe("claude-opus-4")
    expect(high?.thinking).toBe("max")
  })

  test("respects explicit tier override and allowed model pool", () => {
    const forced = routeFusionPrompt({
      promptText: "oi",
      candidates: MODELS,
      tier: "intelligence",
      thinkingRouting: false,
    })
    expect(forced?.modelID).toBe("claude-opus-4")
    expect(forced?.thinking).toBeUndefined()

    const filtered = routeFusionPrompt({
      promptText: "analise a arquitetura de segurança",
      candidates: MODELS,
      selectedKeys: ["google/gemini-3.8-flash"],
      tier: "intelligence",
      thinkingRouting: true,
    })
    expect(filtered?.modelID).toBe("gemini-3.8-flash")
    expect(filtered?.thinking).toBe("high")
  })

  test("computes recommended fusion preset across buckets", () => {
    const preset = computeRecommendedFusionPreset(MODELS)
    expect(preset).toContain("google/gemini-3.8-flash")
    expect(preset).toContain("anthropic/claude-opus-4")
  })
})
