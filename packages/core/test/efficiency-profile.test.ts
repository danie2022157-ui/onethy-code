import { describe, expect, test } from "bun:test"
import { agentModelRanking, boundedMemorySections, efficiencyProfile } from "../src/efficiency-profile"

describe("Onethy efficiency profiles", () => {
  test("are disabled outside OnethyCode and default to balanced inside", () => {
    expect(efficiencyProfile({}).mode).toBe("quality")
    expect(efficiencyProfile({ OMNICODE_ACTIVE: "1" }).mode).toBe("balanced")
    expect(efficiencyProfile({ ONETHY_ACTIVE: "1", ONETHY_EFFICIENCY_PROFILE: "economy" }).mode).toBe("economy")
    expect(efficiencyProfile({ ONETHY_ACTIVE: "1", ONETHY_EFFICIENCY_PROFILE: "invalid" }).mode).toBe("balanced")
  })

  test("bounds expensive agent dispatch and tool transcript sizes without blocking high quality", () => {
    const economy = efficiencyProfile({ ONETHY_ACTIVE: "1", ONETHY_EFFICIENCY_PROFILE: "economy" })
    const quality = efficiencyProfile({ ONETHY_ACTIVE: "1", ONETHY_EFFICIENCY_PROFILE: "quality" })
    expect(economy.missionRounds).toBeLessThan(quality.missionRounds)
    expect(economy.toolOutputBytes).toBeLessThan(quality.toolOutputBytes)
    expect(agentModelRanking("explore", "balanced")).toBe("cost")
    expect(agentModelRanking("coder", "balanced")).toBe("newest")
    expect(agentModelRanking("coder", "economy")).toBe("cost")
    expect(agentModelRanking("reviewer", "economy")).toBe("context")
  })

  test("keeps high-value memory and leaves a retrieval hint when text does not fit", () => {
    const small = boundedMemorySections([
      { name: "project-brief.md", text: "a".repeat(500) },
      { name: "system-patterns.md", text: "b".repeat(500) },
    ], 240)
    expect(small).toHaveLength(1)
    expect(small[0]).toContain("More memory available on demand")
    expect(small[0]).toContain("project-brief.md")
    expect(small.join("")).not.toContain("b".repeat(20))
    expect(boundedMemorySections([{ name: "short", text: "abc" }], 100)).toEqual([
      "### [Memory Bank: short]\nabc",
    ])
  })
})
