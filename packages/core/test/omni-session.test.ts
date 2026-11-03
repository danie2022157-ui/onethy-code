import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { OmniSession, safeMissionID } from "@opencode/core/omni-session"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"

const projectDir = AbsolutePath.make(process.cwd())

const testLocation = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: projectDir })),
)

const { effect } = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([OmniSession.node]),
    [Location.node.replace(testLocation)],
  ),
)

describe("OmniCode Session & Durable Memory", () => {
  effect("saves, retrieves, and lists persistent sessions", () =>
    Effect.gen(function* () {
      const store = yield* OmniSession.Service

      const id = yield* store.save({
        goal: "Refatorar componentes de segurança",
        mode: "approve",
        subtasks: [{ id: "1" }],
        messages: [{ id: "m1" }],
      })

      expect(id).toBeDefined()

      const retrieved = yield* store.get(id)
      expect(retrieved).toBeDefined()
      expect(retrieved?.goal).toBe("Refatorar componentes de segurança")
      expect(retrieved?.mode).toBe("approve")

      const list = yield* store.list()
      expect(list.some((s) => s.id === id)).toBe(true)
    }),
  )

  effect("persists supervisor mission states for recovery after restart", () =>
    Effect.gen(function* () {
      const store = yield* OmniSession.Service
      const tasks = [{
        id: "task-a",
        missionID: "mission-persist-test",
        title: "Inspect code",
        assignedAgent: "researcher",
        status: "running" as const,
      }]
      yield* store.saveMissionTasks("mission-persist-test", tasks)
      const restored = yield* store.loadMissionTasks("mission-persist-test")
      expect(restored).toEqual(tasks)
      const missing = yield* store.loadMissionTasks("mission-persist-missing")
      expect(missing).toBeUndefined()
    }),
  )

  effect("records durable memory decisions into memory.md", () =>
    Effect.gen(function* () {
      const store = yield* OmniSession.Service

      yield* store.recordMemory("Padrão arquitetural: fail-closed para todas as ferramentas")

      const memory = yield* store.getMemory()
      expect(memory.includes("fail-closed para todas as ferramentas")).toBe(true)

      const planPath = yield* store.savePlan("ulw-test-plan", "Meta Ultrawork", [
        { id: "t1", title: "Explorar", assignedAgent: "explore" },
      ])
      expect(planPath.includes("ulw-test-plan.md")).toBe(true)
    }),
  )
})


describe("OmniCode persisted paths", () => {
  test("rejects traversal and invalid session filenames", () => {
    expect(safeMissionID("mission-123")).toBe("mission-123")
    expect(() => safeMissionID("../secret")).toThrow("Invalid mission")
    expect(() => safeMissionID("..\\\\credentials")).toThrow("Invalid mission")
    expect(() => safeMissionID("")).toThrow("Invalid mission")
  })
})
