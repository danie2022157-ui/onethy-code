/** Offline quality-and-cost gate for controlled before/after agent workload trials. */
export type Trial = {
  /** Stable opaque benchmark-case identifier, never raw code or user text. */
  taskId: string
  /** All provider costs and retries for this task, in USD. */
  costUsd: number
  /** Wall time including all agents and test verification. */
  durationMs: number
  /** Whether the task passed its independent acceptance test. */
  verified: boolean
  tokens?: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }
}

export type Summary = {
  tasks: number
  verified: number
  successRate: number
  totalCostUsd: number
  costPerVerifiedUsd: number
  p95LatencyMs: number
}

const percentile = (values: ReadonlyArray<number>, percentile: number) => {
  if (!values.length) return 0
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.ceil(percentile * ordered.length) - 1] ?? ordered.at(-1)!
}

export function summarizeTrials(trials: ReadonlyArray<Trial>): Summary {
  if (!trials.length) throw new Error("Benchmark requires at least one task")
  const unique = new Set<string>()
  for (const trial of trials) {
    if (typeof trial.taskId !== "string" || !trial.taskId.trim() || unique.has(trial.taskId) ||
      typeof trial.verified !== "boolean") throw new Error("Invalid, duplicate or missing benchmark task ID or verdict")
    if (!Number.isFinite(trial.costUsd) || trial.costUsd < 0 ||
      !Number.isFinite(trial.durationMs) || trial.durationMs < 0)
      throw new Error("Invalid benchmark trial cost or duration")
    if (trial.tokens && Object.values(trial.tokens).some((value) => !Number.isFinite(value) || value < 0))
      throw new Error("Invalid benchmark token count")
    unique.add(trial.taskId)
  }
  const verified = trials.filter((trial) => trial.verified).length
  const totalCostUsd = trials.reduce((sum, trial) => sum + trial.costUsd, 0)
  return {
    tasks: trials.length,
    verified,
    successRate: verified / trials.length,
    totalCostUsd,
    costPerVerifiedUsd: verified ? totalCostUsd / verified : Number.POSITIVE_INFINITY,
    p95LatencyMs: percentile(trials.map((trial) => trial.durationMs), 0.95),
  }
}

export function compareTrials(
  baseline: ReadonlyArray<Trial>,
  candidate: ReadonlyArray<Trial>,
  options: { maxLatencyIncrease?: number; targetCostReduction?: number } = {},
) {
  const before = summarizeTrials(baseline)
  const after = summarizeTrials(candidate)
  if (before.verified === 0) throw new Error("Baseline must have at least one verified task")
  const baselineIDs = new Set(baseline.map((trial) => trial.taskId))
  if (baselineIDs.size !== candidate.length || candidate.some((trial) => !baselineIDs.has(trial.taskId)))
    throw new Error("Baseline and candidate tasks must have the same identifiers")
  const qualityPassed = after.successRate >= before.successRate
  const maxLatencyIncrease = options.maxLatencyIncrease ?? 0.2
  const targetCostReduction = options.targetCostReduction ?? 0.2
  if (!Number.isFinite(maxLatencyIncrease) || maxLatencyIncrease < 0 ||
    !Number.isFinite(targetCostReduction) || targetCostReduction < 0 || targetCostReduction >= 1)
    throw new Error("Invalid benchmark thresholds")
  const latencyPassed = after.p95LatencyMs <= before.p95LatencyMs * (1 + maxLatencyIncrease)
  const costReduction = 1 - after.costPerVerifiedUsd / before.costPerVerifiedUsd
  const costPassed = after.costPerVerifiedUsd <= before.costPerVerifiedUsd
  return {
    before, after, costReduction,
    qualityPassed, latencyPassed, costPassed,
    targetMet: qualityPassed && latencyPassed && costReduction >= targetCostReduction,
    safeToRollOut: qualityPassed && latencyPassed && costPassed,
  }
}
