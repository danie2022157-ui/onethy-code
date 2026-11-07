import { describe, expect, test } from "bun:test"
import {
  ANTIGRAVITY_PACKAGE,
  ANTIGRAVITY_REVISION,
  ANTIGRAVITY_SPEC,
  LEGACY_ANTIGRAVITY_PACKAGE,
  antigravityEnabled,
  isAntigravityTarget,
  isLegacyAntigravityTarget,
  withNativeAntigravity,
} from "../src/config/plugin/antigravity-native"

const onethy = { OMNICODE_ACTIVE: "1" }

describe("Onethy native Antigravity Auth replacement", () => {
  test("loads JoshRob297's pinned OpenCode v2 Git plugin instead of CortexKit", () => {
    expect(antigravityEnabled(onethy)).toBe(true)
    expect(ANTIGRAVITY_PACKAGE).toBe("github:JoshRob297/opencode-antigravity-auth")
    expect(ANTIGRAVITY_REVISION).toMatch(/^[0-9a-f]{40}$/)
    expect(ANTIGRAVITY_SPEC).toBe(ANTIGRAVITY_PACKAGE + "#" + ANTIGRAVITY_REVISION)
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

  test("removes old CortexKit entries without removing unrelated plugins", () => {
    expect(isLegacyAntigravityTarget(LEGACY_ANTIGRAVITY_PACKAGE)).toBe(true)
    expect(isLegacyAntigravityTarget(LEGACY_ANTIGRAVITY_PACKAGE + "@^3.0.30")).toBe(true)
    expect(isLegacyAntigravityTarget(ANTIGRAVITY_SPEC)).toBe(false)
    const old = [{ type: "add" as const, target: LEGACY_ANTIGRAVITY_PACKAGE + "@3.0.30" }]
    expect(withNativeAntigravity(old, onethy)).toEqual([
      { type: "add", target: ANTIGRAVITY_SPEC, options: {} },
    ])
    expect(withNativeAntigravity(old, { ...onethy, ONETHY_ANTIGRAVITY_AUTH: "0" })).toEqual([])
  })

  test("deduplicates Git sources and respects explicit removal of the new provider", () => {
    expect(isAntigravityTarget(ANTIGRAVITY_SPEC)).toBe(true)
    expect(isAntigravityTarget(ANTIGRAVITY_PACKAGE + "#v2.5.4")).toBe(true)
    expect(isAntigravityTarget(LEGACY_ANTIGRAVITY_PACKAGE)).toBe(false)
    const manual = [{ type: "add" as const, target: ANTIGRAVITY_PACKAGE + "#v2.5.4" }]
    expect(withNativeAntigravity(manual, onethy)).toEqual(manual)
    for (const target of ["*", ANTIGRAVITY_PACKAGE, ANTIGRAVITY_SPEC, "opencode-antigravity-auth", "opencode.antigravity-auth"]) {
      const removed = [{ type: "remove" as const, target }]
      expect(withNativeAntigravity(removed, onethy)).toEqual(removed)
    }
  })

  test("does not change unrelated sources or trigger credential migration", () => {
    const other = [{ type: "add" as const, target: "@another/agent-tools", options: { enabled: true } }]
    const loaded = withNativeAntigravity(other, onethy)
    expect(loaded).toHaveLength(2)
    expect(loaded[1]).toBe(other[0])
    expect(loaded[0]).toMatchObject({ type: "add", target: ANTIGRAVITY_SPEC })
  })
})
