/**
 * Skill scan/prepare benchmark.
 *
 *   bun run benchmark:skill -- --iterations 20 --files 1000
 *
 * Builds an isolated skill tree under the OS temp directory, then measures
 * SkillScan.scan and Skill.prepare across unchanged and invalidated directory
 * states. This intentionally does not add a cache: the timings establish the
 * cost that a watcher-backed cache would need to beat.
 */
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Logger } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { AbsolutePath } from "../src/schema"
import { Skill } from "../src/skill"
import { SkillScan } from "../src/config/plugin/skill-scan"

const args = process.argv.slice(2)
const option = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : Number(args[index + 1])
}
const iterations = option("iterations", 20)
const fileCount = option("files", 1000)
if (![iterations, fileCount].every(Number.isSafeInteger) || iterations < 1 || fileCount < 1) {
  console.error("--iterations and --files must be positive integers")
  process.exit(1)
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-skill-bench-"))
const skillDir = path.join(root, "skill")
await fs.mkdir(skillDir, { recursive: true })
await Bun.write(path.join(skillDir, "SKILL.md"), "# benchmark skill\n")
await Promise.all(
  Array.from({ length: fileCount }, (_, index) => {
    const directory = path.join(skillDir, `level-${index % 6}`, `group-${index % 32}`)
    return fs.mkdir(directory, { recursive: true }).then(() =>
      Bun.write(path.join(directory, `file-${index}.md`), `# fixture ${index}\n${"content ".repeat(12)}\n`),
    )
  }),
)

const skill = {
  id: Skill.ID.make("benchmark"),
  name: Skill.Name.make("benchmark"),
  path: AbsolutePath.make(path.join(skillDir, "SKILL.md")),
  content: "# benchmark skill",
} satisfies Skill.Info

const stats = (samples: ReadonlyArray<number>) => {
  const sorted = samples.toSorted((a, b) => a - b)
  const percentile = (value: number) => sorted[Math.min(Math.ceil(sorted.length * value) - 1, sorted.length - 1)] ?? 0
  return {
    mean: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
  }
}

const program = Effect.gen(function* () {
  const fsUtil = yield* FSUtil.Service
  const scan = () => SkillScan.scan(root)
  const prepare = () => Skill.prepare(fsUtil, skill)
  const measure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const start = performance.now()
      const value = yield* effect
      return { value, ms: performance.now() - start }
    })
  const run = <A, E, R>(label: string, effect: () => Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const samples = yield* Effect.all(Array.from({ length: iterations }, () => measure(effect())), { concurrency: 1 })
      const result = stats(samples.map((sample) => sample.ms))
      console.log(
        `${label.padEnd(28)} mean ${result.mean.toFixed(2)} ms  p50 ${result.p50.toFixed(2)} ms  p95 ${result.p95.toFixed(2)} ms  min ${result.min.toFixed(2)} ms  max ${result.max.toFixed(2)} ms`,
      )
    })

  console.log(`Skill fixture: ${root}`)
  console.log(`Iterations: ${iterations}; files: ${fileCount}`)
  yield* measure(scan()) // warm filesystem/runtime paths outside recorded samples
  yield* measure(prepare())
  yield* run("SkillScan unchanged", scan)
  yield* run("Skill.prepare unchanged", prepare)
  yield* Effect.promise(() => Bun.write(path.join(skillDir, "content-only.txt"), "updated content\n"))
  yield* run("SkillScan after content edit", scan)
  yield* run("prepare after content edit", prepare)
  yield* Effect.promise(() => Bun.write(path.join(skillDir, "new-file.md"), "new entry\n"))
  yield* run("SkillScan after file create", scan)
  yield* run("prepare after file create", prepare)
  yield* Effect.promise(() => fs.rm(path.join(skillDir, "new-file.md")))
  yield* run("SkillScan after file delete", scan)
  yield* run("prepare after file delete", prepare)
}).pipe(
  Effect.scoped,
  Effect.provide(AppNodeBuilder.build(FSUtil.node)),
  Effect.provide(Logger.layer([])),
)

try {
  await Effect.runPromise(program)
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
