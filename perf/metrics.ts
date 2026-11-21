/** Small, dependency-free metrics helpers shared by performance benchmarks. */
export type Distribution = {
  readonly count: number
  readonly min: number
  readonly median: number
  readonly p95: number
  readonly max: number
}

export type MemorySample = {
  readonly heapUsed: number
  readonly rss: number
  readonly external: number
}

export type BenchmarkRun = {
  readonly latencyMs: number
  readonly ttftMs?: number
  readonly tokens: {
    readonly input: number
    readonly output: number
    readonly reasoning: number
  }
  readonly memory: {
    readonly start: MemorySample
    readonly peak: MemorySample
    readonly end: MemorySample
    readonly retainedHeapBytes: number
  }
}

export type BenchmarkReport = {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly runs: ReadonlyArray<BenchmarkRun>
  readonly latencyMs: Distribution
  readonly ttftMs: Distribution
  readonly tokens: {
    readonly input: number
    readonly output: number
    readonly reasoning: number
  }
  readonly memory: {
    readonly retainedHeapBytes: Distribution
    readonly peakHeapUsedBytes: number
    readonly peakRssBytes: number
  }
}

export const sampleMemory = (): MemorySample => {
  const usage = process.memoryUsage()
  return { heapUsed: usage.heapUsed, rss: usage.rss, external: usage.external }
}

export const recorder = (now: () => number = performance.now.bind(performance)) => {
  const startedAt = now()
  const startMemory = sampleMemory()
  let firstTokenAt: number | undefined
  let peakMemory = startMemory
  let inputTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0

  return {
    firstToken() {
      firstTokenAt ??= now()
    },
    usage(usage: { readonly input?: number; readonly output?: number; readonly reasoning?: number }) {
      inputTokens += usage.input ?? 0
      outputTokens += usage.output ?? 0
      reasoningTokens += usage.reasoning ?? 0
    },
    sampleMemory() {
      const current = sampleMemory()
      peakMemory = {
        heapUsed: Math.max(peakMemory.heapUsed, current.heapUsed),
        rss: Math.max(peakMemory.rss, current.rss),
        external: Math.max(peakMemory.external, current.external),
      }
    },
    finish(): BenchmarkRun {
      const endMemory = sampleMemory()
      peakMemory = {
        heapUsed: Math.max(peakMemory.heapUsed, endMemory.heapUsed),
        rss: Math.max(peakMemory.rss, endMemory.rss),
        external: Math.max(peakMemory.external, endMemory.external),
      }
      return {
        latencyMs: now() - startedAt,
        ...(firstTokenAt === undefined ? {} : { ttftMs: firstTokenAt - startedAt }),
        tokens: { input: inputTokens, output: outputTokens, reasoning: reasoningTokens },
        memory: {
          start: startMemory,
          peak: peakMemory,
          end: endMemory,
          retainedHeapBytes: endMemory.heapUsed - startMemory.heapUsed,
        },
      }
    },
  }
}

export const distribution = (values: ReadonlyArray<number>): Distribution => {
  const sorted = values.toSorted((a, b) => a - b)
  const percentile = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    median: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? 0,
  }
}

export const report = (runs: ReadonlyArray<BenchmarkRun>): BenchmarkReport => ({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runs,
  latencyMs: distribution(runs.map((run) => run.latencyMs)),
  ttftMs: distribution(runs.flatMap((run) => (run.ttftMs === undefined ? [] : [run.ttftMs]))),
  tokens: runs.reduce(
    (total, run) => ({
      input: total.input + run.tokens.input,
      output: total.output + run.tokens.output,
      reasoning: total.reasoning + run.tokens.reasoning,
    }),
    { input: 0, output: 0, reasoning: 0 },
  ),
  memory: {
    retainedHeapBytes: distribution(runs.map((run) => run.memory.retainedHeapBytes)),
    peakHeapUsedBytes: Math.max(0, ...runs.map((run) => run.memory.peak.heapUsed)),
    peakRssBytes: Math.max(0, ...runs.map((run) => run.memory.peak.rss)),
  },
})
