import { describe, expect, test } from "bun:test"
import { legacyAITmplAgent } from "../src/config/plugin/onethy-agent-compat"

describe("historical AITmpl agent compatibility", () => {
  const system = '---\r\nname: python-pro\r\ndescription: "Use when building safe Python applications and APIs."\r\ntools: Read, Edit\r\n---\r\nAn imported agent.'
  test("restores specialist descriptions and subagent mode", () => {
    const value = legacyAITmplAgent("programming-languages-python-pro", {
      description: "Imported AITmpl agents component", mode: "primary", system,
    })
    expect(value?.mode).toBe("subagent")
    expect(value?.description).toContain("safe Python applications")
    expect(value?.description).not.toContain("tools: Read")
  })
  test("never changes a user-created primary agent or an explicit different mode", () => {
    expect(legacyAITmplAgent("mine", { description: "My main agent", mode: "primary", system })).toBeUndefined()
    expect(legacyAITmplAgent("mine", { description: "Imported AITmpl agents component", mode: "subagent", system })).toBeUndefined()
    expect(legacyAITmplAgent("mine", { description: "Imported AITmpl agents component", mode: "primary", system: "No structured source" })).toBeUndefined()
  })
})
