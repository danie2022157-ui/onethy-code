import { describe, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Tool } from "@opencode/core/tool"
import { OmniMemoryTool } from "@opencode/core/tool/plugin/omni-memory"
import { Global } from "@opencode/util/global"
import { AbsolutePath } from "@opencode/core/schema"
import { Effect, Layer, Stream } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const memoryToolNode = makeLocationNode({
  name: "test/omni-memory-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(OmniMemoryTool.Plugin, { event: { subscribe: () => Stream.never } })),
  deps: [Tool.node, Location.node, Global.node],
})

function withTool(run: (registry: Tool.Interface, root: string) => Effect.Effect<void>) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "omni-memory-tool-"))
      const previousActive = process.env.OMNICODE_ACTIVE
      process.env.OMNICODE_ACTIVE = "1"
      return { root, previousActive }
    }),
    ({ root, previousActive }) => Effect.sync(() => {
      if (previousActive === undefined) delete process.env.OMNICODE_ACTIVE
      else process.env.OMNICODE_ACTIVE = previousActive
      fs.rmSync(root, { recursive: true, force: true })
    }),
  ).pipe(Effect.flatMap(({ root }) => {
    const locationLayer = Layer.succeed(Location.Service, Location.Service.of(location(Location.Ref.make({ directory: AbsolutePath.make(root) }))))
    const globalLayer = Layer.succeed(Global.Service, Global.Service.of({
      home: root, data: root, cache: root, config: path.join(root, "global-config"), state: root, tmp: root, bin: root, log: root, repos: root,
    }))
    return Effect.gen(function* () {
      const registry = yield* Tool.Service
      yield* run(registry, root)
    }).pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([Tool.node, Location.node, memoryToolNode]), [
      Location.node.replace(locationLayer), Global.node.replace(globalLayer),
    ])))
  }))
}

const capture = (content: string, options: { scope?: "project" | "global"; confirm?: boolean; append?: boolean; file?: string } = {}) => ({
  sessionID: "ses_omni_memory_test" as never, ...toolIdentity,
  call: { type: "tool-call" as const, id: "call_capture", name: "omni_memory", input: { action: "capture", file: options.file ?? (options.scope === "global" ? "knowledge" : "active-context"), content, ...options } },
})

const runCase = (name: string, run: (registry: Tool.Interface, root: string) => Effect.Effect<void>) =>
  testEffect(Layer.empty).effect(name, withTool(run))

describe("omni_memory capture", () => {
  runCase("rejects empty content", (registry) => Effect.gen(function* () {
    const result = yield* executeTool(registry, capture("  \n"))
    expect(result.status).toBe("error")
    expect(JSON.stringify(result.error)).toContain("nonempty")
  }))

  runCase("rejects credentials without returning their matched value", (registry) => Effect.gen(function* () {
    const secret = "api_key=super-secret-value-123456789"
    const result = yield* executeTool(registry, capture(secret))
    expect(result.status).toBe("error")
    expect(JSON.stringify(result.error)).not.toContain(secret)
    expect(JSON.stringify(result.error)).toContain("Potential sensitive data detected")
  }))

  runCase("requires explicit confirmation for global capture", (registry) => Effect.gen(function* () {
    const result = yield* executeTool(registry, capture("Remember this preference", { scope: "global" }))
    expect(result.status).toBe("error")
    expect(JSON.stringify(result.error)).toContain("confirmation")
  }))

  runCase("writes an explicitly confirmed global capture to knowledge", (registry, root) => Effect.gen(function* () {
    const result = yield* executeTool(registry, capture("Remember this preference", { scope: "global", confirm: true }))
    expect(result.status).toBe("completed")
    expect(fs.readFileSync(path.join(root, "global-config", "memory-bank", "knowledge.md"), "utf8")).toContain("Remember this preference")
  }))

  runCase("does not append an exact duplicate", (registry, root) => Effect.gen(function* () {
    const input = capture("Keep tests focused", { append: true })
    expect((yield* executeTool(registry, input)).status).toBe("completed")
    const second = yield* executeTool(registry, input)
    expect(second.status).toBe("completed")
    expect(second.metadata?.duplicate).toBe("true")
    expect(fs.readFileSync(path.join(root, ".omnicode", "memory-bank", "active-context.md"), "utf8").match(/Keep tests focused/g)).toHaveLength(1)
  }))
})
