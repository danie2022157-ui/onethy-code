import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { missionControlInstructions } from "../src/plugin/command"
import { Input, name } from "../src/tool/plugin/omni-mission"

describe("Onethy persistent mission control contract", () => {
  test("instructs agents to claim and verify real work rather than inventing completion", () => {
    const contract = missionControlInstructions("mission-test-123")
    expect(contract).toContain("Mission ID: mission-test-123")
    expect(contract).toContain("omni_mission")
    expect(contract).toContain("\n")
    expect(contract).toContain("not")
    expect(contract).toContain("fail")
    expect(contract).toContain("no autonomous persistent background worker")
  })

  test("tool accepts valid actions and rejects unknown operations", () => {
    expect(name).toBe("omni_mission")
    const decode = Schema.decodeUnknownSync(Input)
    expect(decode({ action: "status", missionID: "mission-1" }).action).toBe("status")
    expect(decode({ action: "claim", missionID: "mission-1", maxParallel: 2 }).maxParallel).toBe(2)
    expect(decode({ action: "dispatch", missionID: "mission-1", maxParallel: 2, isolateWorkers: true }).action).toBe("dispatch")
    expect(decode({ action: "create", missionID: "mission-2", goal: "Ship", tasks: [{ id: "code", title: "Implement", assignedAgent: "coder", dependsOn: [] }] }).action).toBe("create")
    expect(() => decode({ action: "delete", missionID: "mission-1" })).toThrow()
  })
})
