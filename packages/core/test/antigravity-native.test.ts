import { describe, expect, test } from "bun:test"
import {
  ANTIGRAVITY_BASELINE,
  ANTIGRAVITY_PACKAGE,
  ANTIGRAVITY_SPEC,
  antigravityEnabled,
  isAntigravityTarget,
  withNativeAntigravity,
} from "../src/config/plugin/antigravity-native"

const onethy = { OMNICODE_ACTIVE: "1" }

describe("Onethy native Antigravity Auth", () => {
  test("is available without any manual plugin configuration on OnethyCode", () => {
    expect(antigravityEnabled(onethy)).toBe(true)
    expect(ANTIGRAVITY_PACKAGE).toBe("@cortexkit/opencode-antigravity-auth")
    expect(ANTIGRAVITY_BASELINE).toMatch(/^3\.\d+\.\d+$/)
    expect(ANTIGRAVITY_SPEC).toBe(ANTIGRAVITY_PACKAGE + "@^" + ANTIGRAVITY_BASELINE)
    expect(withNativeAntigravity([], onethy)).toEqual([{
      type: "add",
      target: ANTIGRAVITY_SPEC,
      options: {},
    }])
  })

  test("does not auto-enable on vanilla OpenCode or when the user disables it", () => {
    expect(antigravityEnabled({})).toBe(false)
    expect(antigravityEnabled({ ...onethy, ONETHY_ANTIGRAVITY_AUTH: "0" })).toBe(false)
    expect(withNativeAntigravity([], {})).toEqual([])
    expect(withNativeAntigravity([], { ...onethy, ONETHY_ANTIGRAVITY_AUTH: "0" })).toEqual([])
  })

  test("deduplicates configured sources and respects explicit removal", () => {
    expect(isAntigravityTarget(ANTIGRAVITY_SPEC)).toBe(true)
    expect(isAntigravityTarget(ANTIGRAVITY_PACKAGE + "@3.0.28")).toBe(true)
    expect(isAntigravityTarget("@not-antigravity/plugin")).toBe(false)
    const manual = [{ type: "add" as const, target: ANTIGRAVITY_PACKAGE + "@3.0.28" }]
    expect(withNativeAntigravity(manual, onethy)).toEqual(manual)
    for (const target of ["*", ANTIGRAVITY_PACKAGE, "opencode.antigravity-auth", "cortexkit.antigravity-auth"]) {
      const removed = [{ type: "remove" as const, target }]
      expect(withNativeAntigravity(removed, onethy)).toEqual(removed)
    }
  })

  test("does not change unrelated plugins, credentials, or config", () => {
    const other = [{ type: "add" as const, target: "@another/agent-tools", options: { enabled: true } }]
    const loaded = withNativeAntigravity(other, onethy)
    expect(loaded).toHaveLength(2)
    expect(loaded[1]).toBe(other[0])
    expect(loaded[0]).toMatchObject({ type: "add", target: ANTIGRAVITY_SPEC })
  })
})
