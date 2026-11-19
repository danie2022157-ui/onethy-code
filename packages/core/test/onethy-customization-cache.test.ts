import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Schema } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { OnethyCustomizationCache } from "../src/config/plugin/onethy-customization-cache"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([FSUtil.node])))

const Item = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
})

describe("OnethyCustomizationCache", () => {
  it.live("caches and invalidates global customization indexes when files change", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const sandbox = yield* tmpdirScoped()
      const configDir = path.join(sandbox.path, "config")
      const cacheDir = path.join(sandbox.path, "cache")
      const skillsDir = path.join(configDir, "skills")
      const alphaFile = path.join(skillsDir, "alpha", "SKILL.md")
      const betaFile = path.join(skillsDir, "beta", "SKILL.md")

      yield* fs.writeWithDirs(alphaFile, "# Alpha v1")
      const global = Global.make({ config: configDir, cache: cacheDir })
      const previousActive = process.env.OMNICODE_ACTIVE
      process.env.OMNICODE_ACTIVE = "1"

      const counter = { runs: 0 }
      const load = (items: readonly { readonly id: string; readonly label: string }[]) =>
        OnethyCustomizationCache.cached({
          fs,
          global,
          kind: "skills",
          root: skillsDir,
          directories: [skillsDir],
          schema: Item,
          compute: Effect.sync(() => {
            counter.runs += 1
            return items
          }),
        })

      return yield* Effect.ensuring(
        Effect.gen(function* () {
          const first = yield* load([{ id: "alpha", label: "Alpha v1" }])
          expect(first).toEqual([{ id: "alpha", label: "Alpha v1" }])
          expect(counter.runs).toBe(1)

          const second = yield* load([{ id: "alpha", label: "Should not recompute" }])
          expect(second).toEqual([{ id: "alpha", label: "Alpha v1" }])
          expect(counter.runs).toBe(1)

          yield* fs.writeWithDirs(betaFile, "# Beta v1")
          const third = yield* load([
            { id: "alpha", label: "Alpha v1" },
            { id: "beta", label: "Beta v1" },
          ])
          expect(third).toEqual([
            { id: "alpha", label: "Alpha v1" },
            { id: "beta", label: "Beta v1" },
          ])
          expect(counter.runs).toBe(2)
        }),
        Effect.sync(() => {
          if (previousActive === undefined) delete process.env.OMNICODE_ACTIVE
          else process.env.OMNICODE_ACTIVE = previousActive
        }),
      )
    }),
  )

  it.live("bypasses cache for project-scoped directories outside global config", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const sandbox = yield* tmpdirScoped()
      const configDir = path.join(sandbox.path, "config")
      const cacheDir = path.join(sandbox.path, "cache")
      const projectSkillsDir = path.join(sandbox.path, "project", ".opencode", "skills")
      yield* fs.writeWithDirs(path.join(projectSkillsDir, "local", "SKILL.md"), "# Local")

      const global = Global.make({ config: configDir, cache: cacheDir })
      const counter = { runs: 0 }
      const run = () =>
        OnethyCustomizationCache.cached({
          fs,
          global,
          kind: "skills",
          root: projectSkillsDir,
          directories: [projectSkillsDir],
          schema: Item,
          compute: Effect.sync(() => {
            counter.runs += 1
            return [{ id: "local", label: `Run ${counter.runs}` }]
          }),
        })

      expect(yield* run()).toEqual([{ id: "local", label: "Run 1" }])
      expect(yield* run()).toEqual([{ id: "local", label: "Run 2" }])
      expect(counter.runs).toBe(2)
    }),
  )
})
