import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { OmniBus } from "@opencode/core/omni-bus"
import { AbsolutePath } from "@opencode/core/schema"
import { testEffect } from "./lib/effect"
import { withEnv } from "./fixture/env"
import { location } from "./fixture/location"

const testLocation = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(process.cwd()) })),
)
const { effect } = testEffect(AppNodeBuilder.build(OmniBus.node, [Location.node.replace(testLocation)]))

describe("OmniBus persistence concurrency", () => {
  effect("serializes concurrent publishes and lists without dropping messages", () =>
    withEnv({ OMNICODE_ACTIVE: "1" }, () =>
      Effect.gen(function* () {
        const bus = yield* OmniBus.Service
        yield* bus.clear()

        yield* Effect.all(
          Array.from({ length: 20 }, (_, index) => bus.publish({ sender: `agent-${index}` })),
          { concurrency: "unbounded" },
        )

        const all = yield* bus.list()
        expect(all).toHaveLength(20)
        expect(new Set(all.map((message) => message.sender)).size).toBe(20)
        const persisted = yield* Effect.promise(async () =>
          JSON.parse(await fs.readFile(path.join(process.cwd(), ".omnicode", "bus.json"), "utf-8")),
        )
        expect(persisted).toHaveLength(20)
      }),
    ),
  )

  effect("clear is ordered with concurrent persistence operations", () =>
    withEnv({ OMNICODE_ACTIVE: "1" }, () =>
      Effect.gen(function* () {
        const bus = yield* OmniBus.Service
        yield* bus.clear()
        yield* Effect.all(
          [bus.publish({ sender: "before-clear" }), bus.clear()],
          { concurrency: "unbounded" },
        )
        yield* bus.clear()
        expect(yield* bus.list()).toHaveLength(0)
      }),
    ),
  )
})
