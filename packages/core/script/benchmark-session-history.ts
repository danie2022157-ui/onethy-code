// Reproducible benchmark for SessionHistory.entriesForRunner on a temporary Core database.
// This isolates SQL read, stored-row decoding, instruction-state assembly, and message count.
// Usage: bun run script/benchmark-session-history.ts [--iterations 30] [--messages 100] [--json report.json]

import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Logger, Schema } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Database } from "../src/database/database"
import { Bus } from "../src/bus"
import { Project } from "../src/project"
import { AbsolutePath } from "../src/schema"
import { SessionInbox } from "../src/session/inbox"
import { SessionProjector } from "../src/session/projector"
import { SessionEvent } from "../src/session/event"
import { SessionHistory } from "../src/session/history"
import { SessionMessage } from "../src/session/message"
import { SessionSchema } from "../src/session/schema"
import { InstructionState } from "../src/session/instruction-state"
import { Instructions } from "../src/instructions/index"
import { Project as ProjectSchema } from "@opencode/schema/project"
import { ProjectTable } from "../src/project/sql"

const args = process.argv.slice(2)
const option = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(args[index + 1])
  if (!Number.isInteger(value) || value < 1) {
    console.error(`--${name} must be a positive integer`)
    process.exit(1)
  }
  return value
}
const iterations = option("iterations", 30)
const messageCount = option("messages", 100)
const jsonIndex = args.indexOf("--json")
const jsonPath = jsonIndex < 0 ? undefined : args[jsonIndex + 1]
const directory = AbsolutePath.make(path.join(os.tmpdir(), `opencode-history-bench-${process.pid}`))
const sessionID = SessionSchema.ID.make("ses_history_bench")
const instructions = Instructions.make({
  key: Instructions.Key.make("benchmark/context"),
  codec: Schema.toCodecJson(Schema.String),
  read: Effect.succeed("stable benchmark instructions"),
  render: { initial: String, changed: (_previous, current) => current, removed: () => "" },
})

const percentile = (values: ReadonlyArray<number>, p: number) => {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.min(Math.ceil(sorted.length * p) - 1, sorted.length - 1)] ?? 0
}
const summarize = (values: ReadonlyArray<number>) => ({
  count: values.length,
  mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  p99: percentile(values, 0.99),
  min: Math.min(...values),
  max: Math.max(...values),
})

const layer = AppNodeBuilder.build(
  LayerNode.group([Database.node, Bus.node, Project.node, SessionProjector.node, SessionInbox.node]),
  [Bus.node.replace(Bus.configured({ persist: true }))],
)

const program = Effect.gen(function* () {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const inbox = yield* SessionInbox.Service
  yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
  yield* database.db.insert(ProjectTable).values({ id: ProjectSchema.ID.global, worktree: directory, sandboxes: [] }).run()
  yield* bus.publish(SessionEvent.Created, {
    sessionID,
    projectID: ProjectSchema.ID.global,
    location: { directory },
    slug: "history-benchmark",
    version: "benchmark",
  })
  yield* InstructionState.prepare(database.db, bus, instructions, sessionID)

  for (let index = 0; index < messageCount; index++) {
    const inboxID = SessionMessage.ID.create()
    yield* inbox.admit({
      id: inboxID,
      sessionID,
      item: { type: "user", payload: { text: `Benchmark user message ${index}` }, delivery: "steer" },
    })
    yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID })
  }

  const warm = yield* SessionHistory.entriesForRunner(database.db, sessionID, instructions, "latest")
  const samples: number[] = []
  for (let index = 0; index < iterations; index++) {
    const start = performance.now()
    const entries = yield* SessionHistory.entriesForRunner(database.db, sessionID, instructions, "latest")
    samples.push(performance.now() - start)
    if (entries.entries.length !== warm.entries.length) return yield* Effect.die(new Error("History result changed between runs"))
  }

  return {
    revision: process.env.OPENCODE_BENCH_REVISION,
    bun: Bun.version,
    iterations,
    requestedMessages: messageCount,
    observedMessages: warm.entries.length,
    latest: summarize(samples),
  }
}).pipe(Effect.provide(layer), Effect.scoped, Effect.provide(Logger.layer([])))

try {
  const result = await Effect.runPromise(program)
  console.log(`SessionHistory.entriesForRunner: ${result.iterations} iterations, ${result.observedMessages} messages`)
  console.log(`mean=${result.latest.mean.toFixed(2)}ms p50=${result.latest.p50.toFixed(2)}ms p95=${result.latest.p95.toFixed(2)}ms p99=${result.latest.p99.toFixed(2)}ms`)
  if (jsonPath) {
    await fs.mkdir(path.dirname(jsonPath), { recursive: true })
    await fs.writeFile(jsonPath, JSON.stringify(result, null, 2))
  }
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
