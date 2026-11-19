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
const onethyWithAntigravity = { OMNICODE_ACTIVE: "1", ONETHY_ANTIGRAVITY_AUTH: "1" }

describe("Onethy native Antigravity Auth replacement", () => {
  test("is disabled by default and strips any antigravity plugins", () => {
    expect(antigravityEnabled(onethy)).toBe(false)
    expect(antigravityEnabled({})).toBe(false)
    expect(ANTIGRAVITY_PACKAGE).toBe("github:JoshRob297/opencode-antigravity-auth")
    expect(ANTIGRAVITY_REVISION).toMatch(/^[0-9a-f]{40}$/)
    expect(ANTIGRAVITY_SPEC).toBe(
      "https://github.com/JoshRob297/opencode-antigravity-auth/releases/download/v2.9.3/opencode-antigravity-auth-2.9.3.tgz",
    )
    expect(withNativeAntigravity([], onethy)).toEqual([])
    expect(withNativeAntigravity([], {})).toEqual([])

    const old = [{ type: "add" as const, target: LEGACY_ANTIGRAVITY_PACKAGE + "@3.0.30" }]
    expect(withNativeAntigravity(old, onethy)).toEqual([])

    const manual = [{ type: "add" as const, target: ANTIGRAVITY_PACKAGE + "#v2.9.3" }]
    expect(withNativeAntigravity(manual, onethy)).toEqual([])

    const other = [{ type: "add" as const, target: "@another/agent-tools", options: { enabled: true } }]
    expect(withNativeAntigravity(other, onethy)).toEqual(other)
  })

  test("can be explicitly enabled with ONETHY_ANTIGRAVITY_AUTH=1", () => {
    expect(antigravityEnabled(onethyWithAntigravity)).toBe(true)
    expect(withNativeAntigravity([], onethyWithAntigravity)).toEqual([{
      type: "add",
      target: ANTIGRAVITY_SPEC,
      options: {},
    }])

    const old = [{ type: "add" as const, target: LEGACY_ANTIGRAVITY_PACKAGE + "@3.0.30" }]
    expect(withNativeAntigravity(old, onethyWithAntigravity)).toEqual([
      { type: "add", target: ANTIGRAVITY_SPEC, options: {} },
    ])
  })

  test("identifies legacy and current Antigravity targets correctly", () => {
    expect(isLegacyAntigravityTarget(LEGACY_ANTIGRAVITY_PACKAGE)).toBe(true)
    expect(isLegacyAntigravityTarget(LEGACY_ANTIGRAVITY_PACKAGE + "@^3.0.30")).toBe(true)
    expect(isLegacyAntigravityTarget(ANTIGRAVITY_SPEC)).toBe(false)

    expect(isAntigravityTarget(ANTIGRAVITY_SPEC)).toBe(true)
    expect(isAntigravityTarget(ANTIGRAVITY_PACKAGE + "#v2.9.3")).toBe(true)
    expect(isAntigravityTarget(LEGACY_ANTIGRAVITY_PACKAGE)).toBe(false)
  })

  test("respects explicit removal when enabled", () => {
    for (const target of ["*", ANTIGRAVITY_PACKAGE, ANTIGRAVITY_SPEC, "opencode-antigravity-auth", "opencode.antigravity-auth"]) {
      const removed = [{ type: "remove" as const, target }]
      expect(withNativeAntigravity(removed, onethyWithAntigravity)).toEqual(removed)
    }
  })
})
