import { describe, expect } from "bun:test"
import os from "os"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AbsolutePath } from "@opencode/core/schema"
import { InstructionBuiltIns } from "@opencode/core/instructions/builtins"
import { Instructions } from "@opencode/core/instructions/index"
import { withEnv } from "../fixture/env"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { readInitial, readUpdate } from "../lib/instructions"

const directory = AbsolutePath.make(FSUtil.resolve("/repo/packages/core"))
const projectDirectory = AbsolutePath.make(FSUtil.resolve("/repo"))
const timestamp = Date.parse("2026-06-03T12:00:00.000Z")
const temporary = os.tmpdir()
const localDate = (time: number) => new Date(time).toDateString()
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(
    location(
      { directory },
      { projectDirectory, vcs: { type: "git", store: AbsolutePath.make(FSUtil.resolve("/repo/.git")) } },
    ),
  ),
)
const it = testEffect(
  AppNodeBuilder.build(InstructionBuiltIns.node, [
    Location.node.replace(locationLayer),
    Global.node.replace(Global.layerWith({ config: temporary, tmp: temporary })),
  ]),
)

describe("InstructionBuiltIns", () => {
  it.effect("loads location-scoped environment and host-local date instructions", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load())

      expect(initialized.text).toBe(
        [
          `Today's date: ${localDate(timestamp)}`,
          "",
          "Here is some useful information about the environment you are running in:",
          "<env>",
          `  Working directory: ${directory}`,
          `  Workspace root folder: ${projectDirectory}`,
          "  Is directory a git repo: yes",
          `  Platform: ${process.platform}`,
          `  Prefer ${temporary} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`,
          "</env>",
        ].join("\n"),
      )
    }),
  )

  it.effect("updates the date without repeating unchanged environment instructions", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load())

      yield* TestClock.setTime(timestamp + 24 * 60 * 60 * 1000)
      const refreshed = yield* readUpdate(yield* context.load(), initialized)

      expect(refreshed.text).toBe(`Today's date is now: ${localDate(timestamp + 24 * 60 * 60 * 1000)}`)
    }),
  )

  it.effect("does not update again within the same local calendar day", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load())

      yield* TestClock.setTime(timestamp + 60 * 60 * 1000)
      expect((yield* readUpdate(yield* context.load(), initialized)).changed).toBe(false)
    }),
  )
  it.effect("does not emit empty Onethy instruction sources when Onethy is inactive", () =>
    withEnv({ OMNICODE_ACTIVE: undefined }, () => Effect.gen(function* () {
      const builtins = yield* InstructionBuiltIns.Service
      const observed = yield* Instructions.read(yield* builtins.load())
      for (const key of ["omnicode/memory-bank", "omnicode/global-memory", "omnicode/auto-customizations"]) {
        const source = observed.find((item) => item.key === key)
        expect(source).toBeDefined()
        expect(source!.value).toBe(Instructions.removed)
      }
      const initial = yield* readInitial(yield* builtins.load())
      expect(initial.text).not.toContain("<auto_memory_bank>")
    })),
  )

  it.effect("loads project memory without blank optional instructions when Onethy is active", () =>
    withEnv({ OMNICODE_ACTIVE: "1" }, () => Effect.gen(function* () {
      const builtins = yield* InstructionBuiltIns.Service
      const initial = yield* readInitial(yield* builtins.load())
      expect(initial.text).toContain("<auto_memory_bank>")
    })),
  )

  it.effect("OnethyCode always exposes all seven capability categories to every agent despite retired flags", () =>
    withEnv({
      OMNICODE_ACTIVE: "1",
      OMNICODE_AUTO_CUSTOMIZATIONS: JSON.stringify({
        enabled: false, useSkills: false, useAgents: false,
        useMcps: false, useHooks: false, useMods: false,
        useCommands: false, useSettings: false,
      }),
    }, () => Effect.gen(function* () {
      const builtins = yield* InstructionBuiltIns.Service
      const initial = yield* readInitial(yield* builtins.load())
      expect(initial.text).toContain("<auto_customizations_orchestrator>")
      expect(initial.text).toContain("ATIVO PARA TODOS OS AGENTES")
      for (const feature of ["[SKILLS]", "[SUBAGENTES]", "[SERVIDORES MCP]", "[GANCHOS & HOOKS]", "[MODS & PLUGINS]", "[COMANDOS SLASH & LOOPS]", "[MODOS & SETTINGS]"]) {
        expect(initial.text).toContain(feature)
      }
      expect(initial.text).toContain("MCPs conectados")
      expect(initial.text).toContain("Respeitar permissões")
    })),
  )

})
