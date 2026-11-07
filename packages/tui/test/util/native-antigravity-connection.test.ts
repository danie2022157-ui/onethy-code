import { describe, expect, it } from "bun:test"
import { nativeAntigravityMissing } from "../../src/util/native-antigravity-connection"

const active = { ONETHY_ACTIVE: "1" }

describe("Google /connect native Antigravity method", () => {
  it("shows a diagnostic for a missing native method instead of fake auth", () => {
    expect(nativeAntigravityMissing({ id: "google", methods: [{ type: "key" }] }, active)).toBe(true)
    expect(nativeAntigravityMissing({ id: "google", methods: [] }, active)).toBe(true)
  })
  it("recognizes a real OAuth method registered by the JoshRob297 plugin", () => {
    expect(nativeAntigravityMissing({ id: "google", methods: [
      { type: "key" }, { type: "oauth", id: "antigravity-oauth" },
    ] }, active)).toBe(false)
  })
  it("does not invent an integration for other providers or deliberate opt-outs", () => {
    expect(nativeAntigravityMissing({ id: "openai", methods: [] }, active)).toBe(false)
    expect(nativeAntigravityMissing({ id: "google", methods: [] }, {})).toBe(false)
    expect(nativeAntigravityMissing({ id: "google", methods: [] },
      { ONETHY_ACTIVE: "1", ONETHY_ANTIGRAVITY_AUTH: "0" })).toBe(false)
  })
})
