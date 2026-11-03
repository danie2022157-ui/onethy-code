import { expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { OmniHealTool } from "@opencode/core/tool/plugin/omni-heal"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import { AbsolutePath } from "../src/schema"
import { tmpdirScoped } from "./fixture/tmpdir"
import { withEnv } from "./fixture/env"
import { testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

it.effect("repairs a failed validation and revalidates within the total validation budget", () =>
  withEnv({ OMNICODE_ACTIVE: "1" }, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
      const plugins = yield* Plugin.Service
      const host = yield* PluginHost.make(plugins)
      const registry = yield* Tool.Service
      const repairMarker = path.join(directory.path, "repaired.txt")
      const validationMarker = path.join(directory.path, "validations.txt")
      const script = path.join(directory.path, "run.cjs")
      yield* Effect.promise(() => fs.writeFile(validationMarker, ""))
      yield* Effect.promise(() => fs.writeFile(script, `require('node:fs').appendFileSync(${JSON.stringify(validationMarker)}, 'x'); process.exitCode = require('node:fs').existsSync(${JSON.stringify(repairMarker)}) ? 0 : 1`))

      yield* registry.transform((editor) => editor.add({
        name: "subagent",
        options: { codemode: false },
        description: "test subagent executor",
        input: Schema.Struct({ agent: Schema.String, description: Schema.String, prompt: Schema.String, background: Schema.optionalKey(Schema.Boolean) }),
        output: Schema.Struct({ sessionID: Schema.String, status: Schema.Literals(["completed", "running"]), output: Schema.String }),
        execute: (input) => Effect.gen(function* () {
          expect(input.agent).toBe("coder")
          expect(input.background).toBe(false)
          expect(input.prompt).toContain("not permitted to invoke omni_heal or dispatch another subagent")
          yield* Effect.promise(() => fs.writeFile(repairMarker, "fixed"))
          return {
            output: { sessionID: "repair-session", status: "completed" as const, output: "fixed" },
            content: "fixed",
            metadata: { sessionID: "repair-session", status: "completed" },
          }
        }),
      }))
      yield* OmniHealTool.Plugin.effect(host)
      const session = yield* (yield* Session.Service).create({ location }).pipe(Effect.map((value) => value.id))
      const result = yield* executeTool(registry, {
        sessionID: session,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-heal-repair", name: "omni_heal", input: { action: "run_and_heal", command: `node "${script}"`, maxAttempts: 3 } },
      })

      expect(result).toMatchObject({ status: "completed", output: { passed: true } })
      expect(yield* Effect.promise(() => fs.readFile(validationMarker, "utf8"))).toBe("xx")
    }),
  ),
)

it.effect("records subagent dispatch errors and does not retry validation", () =>
  withEnv({ OMNICODE_ACTIVE: "1" }, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
      const plugins = yield* Plugin.Service
      const host = yield* PluginHost.make(plugins)
      const registry = yield* Tool.Service
      const marker = path.join(directory.path, "validations.txt")
      const script = path.join(directory.path, "run.cjs")
      yield* Effect.promise(() => fs.writeFile(marker, ""))
      yield* Effect.promise(() => fs.writeFile(script, `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'x'); process.exitCode = 1`))
      yield* registry.transform((editor) => editor.add({
        name: "subagent",
        options: { codemode: false },
        description: "failing test subagent",
        input: Schema.Struct({ agent: Schema.String, description: Schema.String, prompt: Schema.String, background: Schema.optionalKey(Schema.Boolean) }),
        output: Schema.Struct({ sessionID: Schema.String, status: Schema.Literals(["completed", "running"]), output: Schema.String }),
        execute: () => Effect.fail(new ToolFailure({ message: "fixture dispatch failure" })),
      }))
      yield* OmniHealTool.Plugin.effect(host)
      const session = yield* (yield* Session.Service).create({ location }).pipe(Effect.map((value) => value.id))
      const result = yield* executeTool(registry, {
        sessionID: session,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-heal-dispatch-error", name: "omni_heal", input: { action: "run_and_heal", command: `node "${script}"` } },
      })

      expect(result).toMatchObject({ status: "completed", output: { passed: false } })
      expect(result.content?.[0]?.type === "text" ? result.content[0].text : "").toContain("fixture dispatch failure")
      expect(yield* Effect.promise(() => fs.readFile(marker, "utf8"))).toBe("x")
    }),
  ),
)

it.effect("reports a failing command when the subagent tool is unavailable", () =>
  withEnv({ OMNICODE_ACTIVE: "1" }, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
      const plugins = yield* Plugin.Service
      const host = yield* PluginHost.make(plugins)
      yield* OmniHealTool.Plugin.effect(host)
      const registry = yield* Tool.Service
      const marker = path.join(directory.path, "validation-runs.txt")
      const script = path.join(directory.path, "run.cjs")
      yield* Effect.promise(() => fs.writeFile(marker, ""))
      yield* Effect.promise(() => fs.writeFile(script, `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'x'); process.exitCode = 1`))
      const session = yield* (yield* Session.Service).create({ location }).pipe(Effect.map((value) => value.id))
      const result = yield* executeTool(registry, {
        sessionID: session,
        ...toolIdentity,
        call: {
          type: "tool-call",
            id: "call-heal-no-repair",
          name: "omni_heal",
          input: { action: "run_and_heal", command: `node "${script}"` },
        },
      })
      expect(result).toMatchObject({ status: "completed", output: { passed: false } })
      expect(result.content?.[0]?.type === "text" ? result.content[0].text : "").toContain("subagent tool is unavailable")
      expect(yield* Effect.promise(() => fs.readFile(marker, "utf8"))).toBe("x")
    }),
  ),
)

it.effect("limits run_and_heal validations per session and command trimmed at the boundaries", () =>
  withEnv({ OMNICODE_ACTIVE: "1" }, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
      const plugins = yield* Plugin.Service
      const host = yield* PluginHost.make(plugins)
      yield* OmniHealTool.Plugin.effect(host)
      const registry = yield* Tool.Service
      const marker = path.join(directory.path, "runs.txt")
      const script = path.join(directory.path, "run.cjs")
      yield* Effect.promise(() => fs.writeFile(marker, ""))
       yield* Effect.promise(() => fs.writeFile(script, `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'x'); process.exitCode = 1`))
      const command = `node "${script}"`
      const parentA = (yield* Session.Service).create({ location }).pipe(Effect.map((session) => session.id))
      const parentB = (yield* Session.Service).create({ location }).pipe(Effect.map((session) => session.id))
      const parentC = (yield* Session.Service).create({ location }).pipe(Effect.map((session) => session.id))
      const sessionA = yield* parentA
      const sessionB = yield* parentB
      const sessionC = yield* parentC
      let call = 0
      const run = (sessionID: Session.ID, cmd = command, maxAttempts?: number) =>
        executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: `call-heal-${++call}`,
            name: "omni_heal",
            input: { action: "run_and_heal", command: cmd, ...(maxAttempts === undefined ? {} : { maxAttempts }) },
          },
        })

      for (let index = 0; index < 3; index++) yield* run(sessionA, `  ${command}  `)
      const exhausted = yield* run(sessionA)
      expect(exhausted).toMatchObject({ status: "completed", output: { passed: false } })
      expect((yield* Effect.promise(() => fs.readFile(marker, "utf8")))).toBe("xxx")

      // The explicit maximum is clamped to three, and session IDs isolate budgets.
      for (let index = 0; index < 3; index++) yield* run(sessionB, command, 99)
      const maxClamped = yield* run(sessionB, command, 99)
      expect(maxClamped).toMatchObject({ status: "completed", output: { passed: false } })
      expect((yield* Effect.promise(() => fs.readFile(marker, "utf8")))).toBe("xxxxxx")
      for (let index = 0; index < 2; index++) yield* run(sessionA, command, 99)
      const stillExhausted = yield* run(sessionA, command, 99)
      expect(stillExhausted).toMatchObject({ status: "completed", output: { passed: false } })
      expect((yield* Effect.promise(() => fs.readFile(marker, "utf8")))).toBe("xxxxxx")

      // A distinct trimmed command has its own budget in the same session.
      const distinctCommand = `${command};`
      for (let index = 0; index < 3; index++) yield* run(sessionA, distinctCommand)
      const distinctExhausted = yield* run(sessionA, distinctCommand)
      expect(distinctExhausted).toMatchObject({ status: "completed", output: { passed: false } })
      expect((yield* Effect.promise(() => fs.readFile(marker, "utf8")))).toBe("xxxxxxxxx")

      // Invalid limits fail before execution and do not consume the command budget.
      for (const maxAttempts of [0, -1, 1.5, Infinity]) {
        expect(yield* run(sessionC, command, maxAttempts)).toMatchObject({ status: "error" })
      }
      const diagnose = yield* executeTool(registry, {
        sessionID: sessionC,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: `call-heal-${++call}`,
          name: "omni_heal",
          input: { action: "diagnose", errorLog: "TypeError: sample" },
        },
      })
      expect(diagnose.output).toMatchObject({ action: "diagnose" })
      for (let index = 0; index < 3; index++) yield* run(sessionC, command)
      const diagnoseDidNotConsume = yield* run(sessionC, command)
      expect(diagnoseDidNotConsume).toMatchObject({ status: "completed", output: { passed: false } })
      expect((yield* Effect.promise(() => fs.readFile(marker, "utf8")))).toBe("xxxxxxxxxxxx")
    }),
  ),
)
