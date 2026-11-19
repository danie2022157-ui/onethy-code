import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { Global } from "@opencode/util/global"
import { OmniBus } from "@opencode/core/omni-bus"
import { OmniSession } from "@opencode/core/omni-session"
import { InstructionBuiltIns } from "@opencode/core/instructions/builtins"
import { Instructions } from "@opencode/core/instructions/index"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"
import { withEnv } from "./fixture/env"
import { readInitial } from "./lib/instructions"

const projectDir = AbsolutePath.make(fs.mkdtempSync(path.join(os.tmpdir(), "omni-bus-sync-test-")))
const subDirectory = AbsolutePath.make(path.join(projectDir, "packages", "client"))
fs.mkdirSync(subDirectory, { recursive: true })

const testLocation = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: subDirectory }, { projectDirectory: projectDir })),
)

const { effect } = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([OmniBus.node, OmniSession.node, InstructionBuiltIns.node]),
    [
      Location.node.replace(testLocation),
      Global.node.replace(Global.layerWith({ config: projectDir, tmp: projectDir })),
    ],
  ),
)

describe("OmniBus and Cross-Session Memory Sync", () => {
  effect("OmniBus and OmniSession write to project root even when running from a subdirectory", () =>
    withEnv({ OMNICODE_ACTIVE: "1" }, () =>
      Effect.gen(function* () {
        const bus = yield* OmniBus.Service
        const omniSession = yield* OmniSession.Service

        yield* bus.publish({
          sender: "coder",
          target: "*",
          taskId: "task-auth",
          type: "artifact",
          payload: "Implementado middleware de autenticação JWT",
        })

        yield* omniSession.recordMemory("Adotado JWT como padrão de autenticação para todas as sessões.")

        const busFile = path.join(projectDir, ".omnicode", "bus.json")
        const memoryFile = path.join(projectDir, ".omnicode", "memory.md")

        expect(fs.existsSync(busFile)).toBe(true)
        expect(fs.existsSync(memoryFile)).toBe(true)

        const busContent = JSON.parse(fs.readFileSync(busFile, "utf-8"))
        expect(busContent.length).toBeGreaterThan(0)
        expect(busContent[0].payload).toBe("Implementado middleware de autenticação JWT")

        const memoryContent = fs.readFileSync(memoryFile, "utf-8")
        expect(memoryContent).toContain("Adotado JWT como padrão")
      }),
    ),
  )

  effect("InstructionBuiltIns injects OmniBus digest and project decisions into LLM system prompt", () =>
    withEnv({ OMNICODE_ACTIVE: "1" }, () =>
      Effect.gen(function* () {
        const builtins = yield* InstructionBuiltIns.Service
        const initial = yield* readInitial(yield* builtins.load())

        expect(initial.text).toContain("<omnicode_inter_session_bus>")
        expect(initial.text).toContain("Implementado middleware de autenticação JWT")
        expect(initial.text).toContain("<omnicode_project_decisions>")
        expect(initial.text).toContain("Adotado JWT como padrão")
        expect(initial.text).toContain("<auto_memory_bank>")

        const memoryBankDir = path.join(projectDir, ".omnicode", "memory-bank")
        expect(fs.existsSync(memoryBankDir)).toBe(true)
        expect(fs.existsSync(path.join(memoryBankDir, "active-context.md"))).toBe(true)
        expect(fs.existsSync(path.join(memoryBankDir, "project-brief.md"))).toBe(true)
      }),
    ),
  )

  effect("InstructionBuiltIns omits bus and decisions when OMNICODE_ACTIVE is not set", () =>
    withEnv({ OMNICODE_ACTIVE: undefined }, () =>
      Effect.gen(function* () {
        const builtins = yield* InstructionBuiltIns.Service
        const observed = yield* Instructions.read(yield* builtins.load())

        const busSource = observed.find((item) => item.key === "omnicode/bus")
        const decisionsSource = observed.find((item) => item.key === "omnicode/project-decisions")

        expect(busSource).toBeDefined()
        expect(busSource!.value).toBe(Instructions.removed)
        expect(decisionsSource).toBeDefined()
        expect(decisionsSource!.value).toBe(Instructions.removed)
      }),
    ),
  )
})
