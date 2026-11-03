import { expect } from "bun:test"
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { OmniCheckpointTool } from "@opencode/core/tool/plugin/omni-checkpoint"
import { OmniCommitTool } from "@opencode/core/tool/plugin/omni-commit"
import { parseStatus } from "@opencode/core/tool/plugin/omni-commit"
import { Effect } from "effect"
import { AbsolutePath } from "../src/schema"
import { initRepo } from "./fixture/git"
import { tmpdirScoped } from "./fixture/tmpdir"
import { withEnv } from "./fixture/env"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

it.effect("parses unstaged rename and copy records as one destination entry", () =>
  Effect.sync(() => {
    expect(parseStatus(" R renamed destination.txt\0original source.txt\0")).toEqual({
      statusLines: [" R renamed destination.txt"],
      modifiedFiles: ["renamed destination.txt"],
    })
    expect(parseStatus(" C copied destination.txt\0original source.txt\0")).toEqual({
      statusLines: [" C copied destination.txt"],
      modifiedFiles: ["copied destination.txt"],
    })
    expect(parseStatus("R  renamed destination.txt\0original source.txt\0")).toEqual({
      statusLines: ["R  renamed destination.txt"],
      modifiedFiles: ["renamed destination.txt"],
    })
  }),
)

it.effect("commit_all stages only changed paths, including names with spaces", () =>
  withEnv({ OMNICODE_ACTIVE: "1" }, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* Effect.promise(() => initRepo(directory.path))
      const tracked = path.join(directory.path, "tracked file.txt")
      const unrelated = path.join(directory.path, "already staged.txt")
      yield* Effect.promise(() => fs.writeFile(tracked, "changed\n"))
      yield* Effect.promise(() => fs.writeFile(unrelated, "staged\n"))
      execFileSync("git", ["add", "--", "already staged.txt"], { cwd: directory.path })
      const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
      const locations = yield* LocationServiceMap.Service
      const layer = locations.get(location)
      yield* Effect.gen(function* () {
        yield* registerToolPlugin(OmniCommitTool.Plugin)
        const session = yield* (yield* Session.Service).create({ location })
        const result = yield* executeTool(yield* Tool.Service, {
          sessionID: session.id,
          ...toolIdentity,
          call: { type: "tool-call", id: "commit-safe", name: "omni_commit", input: { action: "commit_all", message: "test: safe staging" } },
        })
        expect(result.status).toBe("completed")
      }).pipe(Effect.provide(layer))
      expect(execFileSync("git", ["show", "--pretty=", "--name-only", "HEAD"], { cwd: directory.path, encoding: "utf8" }).trim().split("\n").sort()).toEqual(["already staged.txt", "tracked file.txt"])
      expect(execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: directory.path, encoding: "utf8" }).trim()).toBe("")
    }),
  ),
)

it.effect("commit_all treats Git pathspec magic in filenames literally", () =>
  withEnv({ OMNICODE_ACTIVE: "1" }, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* Effect.promise(() => initRepo(directory.path))
      yield* Effect.promise(() => fs.writeFile(path.join(directory.path, "literala.txt"), "unrelated\n"))
      execFileSync("git", ["add", "--", "literala.txt"], { cwd: directory.path })
      execFileSync("git", ["commit", "-m", "baseline"], { cwd: directory.path })
      yield* Effect.promise(() => fs.writeFile(path.join(directory.path, "literal[ab].txt"), "changed\n"))
      const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
      const locations = yield* LocationServiceMap.Service
      const layer = locations.get(location)
      yield* Effect.gen(function* () {
        yield* registerToolPlugin(OmniCommitTool.Plugin)
        const session = yield* (yield* Session.Service).create({ location })
        const result = yield* executeTool(yield* Tool.Service, {
          sessionID: session.id,
          ...toolIdentity,
          call: { type: "tool-call", id: "commit-pathspec-magic", name: "omni_commit", input: { action: "commit_all", message: "test: literal paths" } },
        })
        expect(result.status).toBe("completed")
      }).pipe(Effect.provide(layer))
      expect(execFileSync("git", ["show", "--pretty=", "--name-only", "HEAD"], { cwd: directory.path, encoding: "utf8" }).trim().split("\n")).toEqual(["literal[ab].txt"])
      expect(execFileSync("git", ["status", "--porcelain"], { cwd: directory.path, encoding: "utf8" })).toBe("")
    }),
  ),
)

it.effect("commit_all stages the destination, not the source, of a rename", () =>
  withEnv({ OMNICODE_ACTIVE: "1" }, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* Effect.promise(() => initRepo(directory.path))
      yield* Effect.promise(() => fs.writeFile(path.join(directory.path, "old.txt"), "same\n"))
      execFileSync("git", ["add", "--", "old.txt"], { cwd: directory.path })
      execFileSync("git", ["commit", "-m", "baseline"], { cwd: directory.path })
      yield* Effect.promise(() => fs.rename(path.join(directory.path, "old.txt"), path.join(directory.path, "new name.txt")))
      const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
      const locations = yield* LocationServiceMap.Service
      const layer = locations.get(location)
      yield* Effect.gen(function* () {
        yield* registerToolPlugin(OmniCommitTool.Plugin)
        const session = yield* (yield* Session.Service).create({ location })
        const result = yield* executeTool(yield* Tool.Service, {
          sessionID: session.id,
          ...toolIdentity,
          call: { type: "tool-call", id: "commit-rename", name: "omni_commit", input: { action: "commit_all", message: "test: rename" } },
        })
        expect(result.status).toBe("completed")
      }).pipe(Effect.provide(layer))
      expect(execFileSync("git", ["show", "--pretty=", "--name-only", "HEAD"], { cwd: directory.path, encoding: "utf8" }).trim()).toBe("new name.txt")
      expect(execFileSync("git", ["status", "--porcelain"], { cwd: directory.path, encoding: "utf8" })).toBe("")
    }),
  ),
)

it.effect("restore refuses a dirty workspace when the checkpoint has no snapshot", () =>
  withEnv({ OMNICODE_ACTIVE: "1" }, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* Effect.promise(() => initRepo(directory.path))
      const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
      const locations = yield* LocationServiceMap.Service
      const layer = locations.get(location)
      const session = yield* (yield* Session.Service).create({ location })
      const results = yield* Effect.gen(function* () {
        yield* registerToolPlugin(OmniCheckpointTool.Plugin)
        const tools = yield* Tool.Service
        yield* executeTool(tools, { sessionID: session.id, ...toolIdentity, call: { type: "tool-call", id: "cp-empty", name: "omni_checkpoint", input: { action: "create" } } })
        yield* Effect.promise(() => fs.writeFile(path.join(directory.path, "user-work.txt"), "keep me\n"))
        return yield* executeTool(tools, { sessionID: session.id, ...toolIdentity, call: { type: "tool-call", id: "cp-restore-dirty", name: "omni_checkpoint", input: { action: "restore" } } })
      }).pipe(Effect.provide(layer))
      expect(results.status).toBe("error")
      expect(yield* Effect.promise(() => fs.readFile(path.join(directory.path, "user-work.txt"), "utf8"))).toBe("keep me\n")
    }),
  ),
)

it.effect("restore succeeds without changing a clean checkpoint", () =>
  withEnv({ OMNICODE_ACTIVE: "1" }, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* Effect.promise(() => initRepo(directory.path))
      const file = path.join(directory.path, "tracked.txt")
      yield* Effect.promise(() => fs.writeFile(file, "snapshot\n"))
      execFileSync("git", ["add", "--", "tracked.txt"], { cwd: directory.path })
      execFileSync("git", ["commit", "-m", "snapshot"], { cwd: directory.path })
      const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
      const locations = yield* LocationServiceMap.Service
      const layer = locations.get(location)
      const session = yield* (yield* Session.Service).create({ location })
      const result = yield* Effect.gen(function* () {
        yield* registerToolPlugin(OmniCheckpointTool.Plugin)
        yield* executeTool(yield* Tool.Service, {
          sessionID: session.id,
          ...toolIdentity,
          call: { type: "tool-call", id: "checkpoint-clean-create", name: "omni_checkpoint", input: { action: "create" } },
        })
        return yield* executeTool(yield* Tool.Service, {
          sessionID: session.id,
          ...toolIdentity,
          call: { type: "tool-call", id: "checkpoint-clean-restore", name: "omni_checkpoint", input: { action: "restore" } },
        })
      }).pipe(Effect.provide(layer))
      expect(result.status).toBe("completed")
      expect(execFileSync("git", ["status", "--porcelain"], { cwd: directory.path, encoding: "utf8" })).not.toContain("tracked.txt")
      expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("snapshot\n")
    }),
  ),
)

it.effect("restore fails instead of reporting success when checkpoint application fails", () =>
  withEnv({ OMNICODE_ACTIVE: "1" }, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* Effect.promise(() => initRepo(directory.path))
      const file = path.join(directory.path, "tracked.txt")
      yield* Effect.promise(() => fs.writeFile(file, "snapshot\n"))
      execFileSync("git", ["add", "--", "tracked.txt"], { cwd: directory.path })
      execFileSync("git", ["commit", "-m", "snapshot"], { cwd: directory.path })
      const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
      const locations = yield* LocationServiceMap.Service
      const layer = locations.get(location)
      const session = yield* (yield* Session.Service).create({ location })
      yield* Effect.gen(function* () {
        yield* registerToolPlugin(OmniCheckpointTool.Plugin)
        yield* executeTool(yield* Tool.Service, {
          sessionID: session.id,
          ...toolIdentity,
          call: { type: "tool-call", id: "checkpoint-create", name: "omni_checkpoint", input: { action: "create" } },
        })
      }).pipe(Effect.provide(layer))
      yield* Effect.promise(() => fs.writeFile(file, "new local work\n"))
      execFileSync("git", ["add", "--", "tracked.txt"], { cwd: directory.path })
      execFileSync("git", ["commit", "-m", "advance head"], { cwd: directory.path })
      const result = yield* Effect.gen(function* () {
        return yield* executeTool(yield* Tool.Service, {
          sessionID: session.id,
          ...toolIdentity,
          call: { type: "tool-call", id: "checkpoint-restore", name: "omni_checkpoint", input: { action: "restore" } },
        })
      }).pipe(Effect.provide(layer))
      expect(result.status).toBe("error")
      expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("new local work\n")
    }),
  ),
)
