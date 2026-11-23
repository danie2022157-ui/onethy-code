import { describe, expect, test } from "bun:test"
import { fusionTierLabel } from "@opencode/client/fusion"
import { formatRelativeTime, formatTemplate } from "./onethy"

describe("formatTemplate", () => {
  test("replaces named params", () => {
    expect(formatTemplate("{{name}} activated (@{{id}})", { name: "Omni", id: "omni" })).toBe(
      "Omni activated (@omni)",
    )
  })

  test("returns template unchanged without params", () => {
    expect(formatTemplate("Hello {{x}}")).toBe("Hello {{x}}")
  })

  test("blanks missing params", () => {
    expect(formatTemplate("a{{missing}}b", {})).toBe("ab")
  })
})

describe("formatRelativeTime", () => {
  const now = 1_800_000_000_000

  test("formats English and Portuguese", () => {
    const fiveMinAgo = now - 5 * 60_000
    expect(formatRelativeTime(fiveMinAgo, "en-US", now)).toContain("5")
    expect(formatRelativeTime(fiveMinAgo, "en-US", now)).toContain("ago")
    expect(formatRelativeTime(fiveMinAgo, "pt-BR", now)).toContain("há")
  })

  test("uses day unit for older timestamps", () => {
    expect(formatRelativeTime(now - 86_400_000, "en-US", now)).toBe("yesterday")
    expect(formatRelativeTime(now - 86_400_000, "pt-BR", now)).toBe("ontem")
  })
})

describe("fusionTierLabel locale", () => {
  test("localizes tiers", () => {
    expect(fusionTierLabel("balanced", false, "en")).toBe("Balanced")
    expect(fusionTierLabel("balanced", false, "br")).toBe("Balanceado")
  })
})
