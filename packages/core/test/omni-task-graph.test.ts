import { describe, expect, test } from "bun:test"
import { OmniTaskGraph } from "../src/omni-task-graph.js"

const plan = [
  { id: "explore", title: "Inspect code", assignedAgent: "researcher", dependsOn: [] },
  { id: "api", title: "Implement API", assignedAgent: "coder", dependsOn: ["explore"] },
  { id: "ui", title: "Implement CLI", assignedAgent: "coder", dependsOn: ["explore"] },
  { id: "review", title: "Review both", assignedAgent: "reviewer", dependsOn: ["api", "ui"] },
]

describe("Onethy dependency scheduling", () => {
  test("rejects cycles, missing predecessors, duplicate IDs and invalid names", () => {
    expect(() => OmniTaskGraph.validate(plan)).not.toThrow()
    expect(() => OmniTaskGraph.validate([{ ...plan[0]!, dependsOn: ["explore"] }])).toThrow("Cyclic")
    expect(() => OmniTaskGraph.validate([plan[0]!, { ...plan[1]!, dependsOn: ["missing"] }])).toThrow("Unknown")
    expect(() => OmniTaskGraph.validate([plan[0]!, plan[0]!])).toThrow("Duplicate")
    expect(() => OmniTaskGraph.validate([{ ...plan[0]!, id: "../bad" }])).toThrow("Invalid")
  })

  test("schedules parallel dependencies without starting final review early", () => {
    const tasks = plan.map((task) => ({ ...task, status: "pending" as "pending" | "running" | "completed" | "failed" }))
    expect(OmniTaskGraph.ready(tasks, 3).map((task) => task.id)).toEqual(["explore"])
    tasks[0]!.status = "completed"
    expect(OmniTaskGraph.ready(tasks, 2).map((task) => task.id)).toEqual(["api", "ui"])
    tasks[1]!.status = "running"
    expect(OmniTaskGraph.ready(tasks, 2).map((task) => task.id)).toEqual(["ui"])
    tasks[1]!.status = "completed"
    tasks[2]!.status = "failed"
    expect(OmniTaskGraph.ready(tasks, 2)).toHaveLength(0)
    tasks[2]!.status = "completed"
    expect(OmniTaskGraph.ready(tasks, 2).map((task) => task.id)).toEqual(["review"])
  })
})
