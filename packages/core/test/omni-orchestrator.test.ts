import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "./lib/effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { OmniConfig } from "@opencode/core/omni-config"
import { OmniBus } from "@opencode/core/omni-bus"
import { OmniOrchestrator } from "@opencode/core/omni-orchestrator"
import { OmniSession } from "@opencode/core/omni-session"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"

const projectDir = AbsolutePath.make(process.cwd())

const testLocation = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: projectDir })),
)

const { effect } = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([OmniConfig.node, OmniBus.node, OmniSession.node, OmniOrchestrator.node]),
    [Location.node.replace(testLocation)],
  ),
)

describe("OmniCode Multi-Agent Orchestration & Bus", () => {
  effect("OmniBus: publishes structured inter-agent messages and filters by task", () =>
    Effect.gen(function* () {
      const bus = yield* OmniBus.Service

      yield* bus.clear()

      const msg = yield* bus.publish({
        sender: "supervisor",
        target: "coder",
        taskId: "task-101",
        type: "handoff",
        payload: { instruction: "Implement endpoint" },
      })

      expect(msg.id).toBeDefined()
      expect(msg.sender).toBe("supervisor")
      expect(msg.target).toBe("coder")
      expect(msg.type).toBe("handoff")

      const all = yield* bus.list()
      expect(all.length).toBe(1)

      const forTask = yield* bus.listByTask("task-101")
      expect(forTask.length).toBe(1)

      yield* bus.publish({
        sender: "@explore (ses-child-1)",
        target: "*",
        taskId: "auth-map",
        sessionID: "ses-child-1",
        parentSessionID: "ses-parent-1",
        type: "artifact",
        payload: "Auth module located at src/auth.ts",
      })

      const bySession = yield* bus.listBySession("ses-parent-1")
      expect(bySession.some((m) => m.sessionID === "ses-child-1")).toBe(true)

      const digest = yield* bus.formatContextDigest("ses-parent-1", 5)
      expect(digest.includes("BARRAMENTO COMPARTILHADO ENTRE SESSÕES")).toBe(true)
      expect(digest.includes("src/auth.ts")).toBe(true)
    }),
  )

  effect("OmniOrchestrator: lists specialist agents and plans decomposed mission", () =>
    Effect.gen(function* () {
      const orchestrator = yield* OmniOrchestrator.Service
      const bus = yield* OmniBus.Service
      const agents = yield* orchestrator.getAgents()

      expect(agents.length).toBe(6)
      expect(agents.map((a) => a.id)).toEqual([
        "supervisor",
        "researcher",
        "librarian",
        "architect",
        "coder",
        "reviewer",
      ])

      const tasks = yield* orchestrator.planMission("Corrigir autenticação e validar com testes", "mission-auth")
      expect(tasks.length).toBe(3)
      expect(tasks[0].assignedAgent).toBe("researcher")
      expect(tasks[1].assignedAgent).toBe("coder")
      expect(tasks[2].assignedAgent).toBe("reviewer")
      const planMessage = (yield* bus.list()).find((message) => message.type === "plan")
      expect(planMessage?.payload).toMatchObject({ missionID: "mission-auth" })

      expect(yield* orchestrator.getActiveTasks("mission-auth")).toHaveLength(3)
      expect(yield* orchestrator.getActiveTasks("mission-other")).toHaveLength(0)
      expect(yield* orchestrator.getActiveTasks()).toHaveLength(0)
      tasks[0].status = "failed"
      expect((yield* orchestrator.getActiveTasks("mission-auth"))[0].status).toBe("pending")
      const completed = yield* orchestrator.executeTask("mission-auth", tasks[0].id, "Rotas identificadas com sucesso")
      expect(completed.status).toBe("completed")
      expect(completed.result).toBe("Rotas identificadas com sucesso")
      const statusMessage = (yield* bus.list()).find((message) => message.type === "status")
      expect(statusMessage?.payload).toMatchObject({ missionID: "mission-auth", status: "completed" })
      const crossMission = yield* Effect.exit(orchestrator.executeTask("mission-other", tasks[1].id, "must not complete"))
      expect(crossMission._tag).toBe("Failure")
      expect((yield* orchestrator.getActiveTasks("mission-auth"))[1].status).toBe("pending")
      completed.status = "failed"
      expect((yield* orchestrator.getActiveTasks("mission-auth"))[0].status).toBe("completed")
    }),
  )

  effect("mission scheduler runs only ready stages with a bounded parallelism", () =>
    Effect.gen(function* () {
      const orchestrator = yield* OmniOrchestrator.Service
      const tasks = yield* orchestrator.planUltrawork("Build safe feature", "mission-scheduler")
      const first = yield* orchestrator.claimReadyTasks("mission-scheduler", 2)
      expect(first).toHaveLength(2)
      expect(first.every((task) => task.status === "running")).toBe(true)
      expect((yield* orchestrator.claimReadyTasks("mission-scheduler", 2))).toHaveLength(0)

      yield* orchestrator.executeTask("mission-scheduler", tasks[0].id, "Exploration done")
      yield* orchestrator.failTask("mission-scheduler", tasks[1].id, "Network failed")
      expect((yield* orchestrator.claimReadyTasks("mission-scheduler", 2))).toHaveLength(0)
      yield* orchestrator.retryTask("mission-scheduler", tasks[1].id)

      const retried = yield* orchestrator.claimReadyTasks("mission-scheduler", 2)
      expect(retried.map((task) => task.id)).toEqual([tasks[1].id])
      yield* orchestrator.executeTask("mission-scheduler", tasks[1].id, "Docs collected")

      const serial = yield* orchestrator.claimReadyTasks("mission-scheduler", 8)
      expect(serial).toHaveLength(1)
      expect(serial[0].id).toBe(tasks[2].id)
      expect((yield* orchestrator.claimReadyTasks("mission-scheduler", 8))).toHaveLength(0)
    }),
  )

  effect("mission restoration marks abandoned workers failed until explicit retry", () =>
    Effect.gen(function* () {
      const store = yield* OmniSession.Service
      const orchestrator = yield* OmniOrchestrator.Service
      yield* store.saveMissionTasks("mission-recovery-test", [{
        id: "task-recovery",
        missionID: "mission-recovery-test",
        title: "Interrupted build",
        assignedAgent: "coder",
        status: "running",
      }])
      const restored = yield* orchestrator.getActiveTasks("mission-recovery-test")
      expect(restored[0].status).toBe("failed")
      expect(restored[0].result).toContain("retry required")
      expect((yield* store.loadMissionTasks("mission-recovery-test"))?.[0].status).toBe("failed")
      yield* orchestrator.retryTask("mission-recovery-test", "task-recovery")
      expect((yield* orchestrator.claimReadyTasks("mission-recovery-test", 1))[0].status).toBe("running")
    }),
  )

  effect("OmniOrchestrator: expires model cooldowns using the caller clock", () =>
    Effect.gen(function* () {
      const orchestrator = yield* OmniOrchestrator.Service
      yield* orchestrator.clearModelCooldown()
      yield* orchestrator.markModelCooldown("provider", "model", 1_000)
      expect(yield* orchestrator.isModelInCooldown("provider", "model")).toBe(true)
      yield* TestClock.adjust("1000 millis")
      expect(yield* orchestrator.isModelInCooldown("provider", "model")).toBe(false)
    }),
  )

  effect("OmniOrchestrator: plans Ultrawork, Arena, routes models by category, and enforces Ralph Loop", () =>
    Effect.gen(function* () {
      const orchestrator = yield* OmniOrchestrator.Service

      const ulwTasks = yield* orchestrator.planUltrawork("Refatorar módulo de pagamentos")
      expect(ulwTasks.length).toBe(5)
      expect(ulwTasks[0].parallel).toBe(true)
      expect(ulwTasks[1].assignedAgent).toBe("librarian")
      const bus = yield* OmniBus.Service
      const ulwPlan = (yield* bus.list()).find((message) => message.type === "plan" && (message.payload as { mode?: string }).mode === "ultrawork")
      expect(ulwPlan?.payload).toMatchObject({ missionID: ulwTasks[0].missionID })

      const arenaTasks = yield* orchestrator.planArena("Resolver race condition", [
        "test/model-a",
        "test/model-b",
        "test/model-c",
      ])
      expect(arenaTasks.length).toBe(3)
      expect(arenaTasks[0].preferredModel).toBe("test/model-a")
      const arenaPlan = (yield* bus.list()).find((message) => message.type === "plan" && (message.payload as { mode?: string }).mode === "arena")
      expect(arenaPlan?.payload).toMatchObject({ missionID: arenaTasks[0].missionID })

      const teamTasks = yield* orchestrator.planTeamPipeline("Construir funcionalidade", "mission-team")
      const teamPlan = (yield* bus.list()).find((message) => message.type === "plan" && (message.payload as { mode?: string }).mode === "team_pipeline")
      expect(teamPlan?.payload).toMatchObject({ missionID: teamTasks[0].missionID })

      const routed = yield* orchestrator.selectModelForAgent("explore", "Buscar arquivos rapidamente", [
        Model.Info.default(Provider.ID.make("test"), Model.ID.make("z-model")),
        Model.Info.default(Provider.ID.make("test"), Model.ID.make("a-model")),
      ])
      expect(routed.category).toBe("fast_explore")
      expect(routed.primary?.id).toBe("a-model")

      const filtered = yield* orchestrator.selectModelForAgent("coder", "Implementar mudança", [
        {
          ...Model.Info.default(Provider.ID.make("test"), Model.ID.make("disabled")),
          enabled: false,
        },
        {
          ...Model.Info.default(Provider.ID.make("test"), Model.ID.make("deprecated")),
          status: "deprecated",
        },
        Model.Info.default(Provider.ID.make("test"), Model.ID.make("available")),
      ])
      expect(filtered.primary?.id).toBe("available")
      expect(filtered.fallback).toBeUndefined()

      const contract = orchestrator.formatBoomerangContract("coder")
      expect(contract.includes("PROTOCOLO BOOMERANG")).toBe(true)

      const ralphPending = yield* orchestrator.verifyCompletion({ todosPending: 2, hasUnverifiedEdits: false })
      expect(ralphPending.passed).toBe(false)

      const ralphDone = yield* orchestrator.verifyCompletion({ todosPending: 0, hasUnverifiedEdits: false })
      expect(ralphDone.passed).toBe(true)
    }),
  )
})

