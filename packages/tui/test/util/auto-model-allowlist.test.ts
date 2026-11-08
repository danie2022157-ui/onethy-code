import { describe, expect, test } from "bun:test"
import { effectiveAllowedModels } from "../../src/util/auto-model-allowlist"

const catalog = [
  { providerID: "google", id: "antigravity-gemini-3.8-flash" },
  { providerID: "openai", id: "gpt-6" },
]

describe("Omni Auto effective model allowlist", () => {
  test("falls back to the connected catalog when every saved ID belongs to the old plugin", () => {
    expect(effectiveAllowedModels(["antigravity/antigravity-gemini-3.8-flash"], catalog)).toBeUndefined()
  })
  test("preserves explicit active selections while dropping stale IDs", () => {
    expect(effectiveAllowedModels([
      "antigravity/antigravity-gemini-3.8-flash",
      "openai/gpt-6",
      "openai/gpt-6",
    ], catalog)).toEqual(["openai/gpt-6"])
  })
  test("does not impose any restriction on an unrestricted picker", () => {
    expect(effectiveAllowedModels(undefined, catalog)).toBeUndefined()
    expect(effectiveAllowedModels([], catalog)).toBeUndefined()
  })
})
