import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Location } from "@opencode/core/location"
import { OmniPolicy } from "@opencode/core/omni-policy"
import { OmniPath } from "@opencode/core/omni-path"
import { OmniShell } from "@opencode/core/omni-shell"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"

const projectDir = AbsolutePath.make(process.cwd())

const testLocation = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: projectDir })),
)

const { effect } = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Bus.node, OmniPath.node, OmniShell.node, OmniPolicy.node]),
    [Location.node.replace(testLocation)],
  ),
)

describe("OmniCode Core Security & Policy", () => {
  effect("OmniPolicy: registers, lists, and removes global hard-deny rules", () =>
    Effect.gen(function* () {
      const policy = yield* OmniPolicy.Service

      expect(yield* policy.hardDeny("file.write", "/etc/hosts")).toBe(false)

      yield* policy.addHardDeny("file.write", "/etc/hosts")
      expect(yield* policy.hardDeny("file.write", "/etc/hosts")).toBe(true)

      const list = yield* policy.listHardDeny()
      expect(list.some((r) => r.action === "file.write" && r.resource === "/etc/hosts")).toBe(true)

      yield* policy.removeHardDeny("file.write", "/etc/hosts")
      expect(yield* policy.hardDeny("file.write", "/etc/hosts")).toBe(false)

      yield* policy.addHardDeny("edit", "**/.git/hooks/*")
      expect(yield* policy.hardDeny("edit", "repo/.git/hooks/pre-commit")).toBe(true)
      yield* policy.removeHardDeny("edit", "**/.git/hooks/*")
    }),
  )

  effect("OmniPath: contains paths strictly within workspace and rejects traversal", () =>
    Effect.gen(function* () {
      const pathResolver = yield* OmniPath.Service

      const isInside = yield* pathResolver.isInsideWorkspace("package.json")
      expect(isInside).toBe(true)

      const outsideEscape = yield* pathResolver.isInsideWorkspace("../../windows/system32")
      expect(outsideEscape).toBe(false)
    }),
  )

  effect("OmniShell: classifies safe, mutation, destructive and blocked shell commands", () =>
    Effect.gen(function* () {
      const shellGuard = yield* OmniShell.Service

      const safe = yield* shellGuard.classify("git status", ".")
      expect(safe).toBe("safe_inspection")

      const mutation = yield* shellGuard.classify("npm install lodash", ".")
      expect(mutation).toBe("mutation")

      const destructive = yield* shellGuard.classify("rm -rf src", ".")
      expect(destructive).toBe("destructive")

      const blockedInjection = yield* shellGuard.classify("echo $(cat /etc/passwd)", ".")
      expect(blockedInjection).toBe("blocked")
    }),
  )
})
