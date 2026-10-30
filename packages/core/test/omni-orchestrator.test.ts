import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { OmniConfig } from "@opencode/core/omni-config"
import { OmniBus } from "@opencode/core/omni-bus"
import { OmniOrchestrator } from "@opencode/core/omni-orchestrator"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"

const projectDir = AbsolutePath.make(process.cwd())

const testLocation = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: projectDir })),
)

const { effect } = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([OmniConfig.node, OmniBus.node, OmniOrchestrator.node]),
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

      const tasks = yield* orchestrator.planMission("Corrigir autenticação e validar com testes")
      expect(tasks.length).toBe(3)
      expect(tasks[0].assignedAgent).toBe("researcher")
      expect(tasks[1].assignedAgent).toBe("coder")
      expect(tasks[2].assignedAgent).toBe("reviewer")

      const completed = yield* orchestrator.executeTask(tasks[0].id, "Rotas identificadas com sucesso")
      expect(completed.status).toBe("completed")
      expect(completed.result).toBe("Rotas identificadas com sucesso")
    }),
  )

  effect("OmniOrchestrator: plans Ultrawork, Arena, routes models by category, and enforces Ralph Loop", () =>
    Effect.gen(function* () {
      const orchestrator = yield* OmniOrchestrator.Service

      const ulwTasks = yield* orchestrator.planUltrawork("Refatorar módulo de pagamentos")
      expect(ulwTasks.length).toBe(5)
      expect(ulwTasks[0].parallel).toBe(true)
      expect(ulwTasks[1].assignedAgent).toBe("librarian")

      const arenaTasks = yield* orchestrator.planArena("Resolver race condition", [
        "openai/gpt-6-astra",
        "opencode/big-pickle",
        "opencode/deepseek-v4.1-flash-free",
      ])
      expect(arenaTasks.length).toBe(3)
      expect(arenaTasks[0].preferredModel).toBe("openai/gpt-6-astra")

      const routed = yield* orchestrator.selectModelForAgent("explore", "Buscar arquivos rapidamente", [
        { providerID: "opencode", id: "glm-5.3-flash-free" },
        { providerID: "openai", id: "gpt-6-astra" },
      ])
      expect(routed.category).toBe("fast_explore")
      expect(routed.primary?.id).toBe("glm-5.3-flash-free")

      const contract = orchestrator.formatBoomerangContract("coder")
      expect(contract.includes("PROTOCOLO BOOMERANG")).toBe(true)

      const ralphPending = yield* orchestrator.verifyCompletion({ todosPending: 2, hasUnverifiedEdits: false })
      expect(ralphPending.passed).toBe(false)

      const ralphDone = yield* orchestrator.verifyCompletion({ todosPending: 0, hasUnverifiedEdits: false })
      expect(ralphDone.passed).toBe(true)
    }),
  )
})

