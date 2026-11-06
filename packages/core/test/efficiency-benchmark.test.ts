import { describe, expect, test } from "bun:test"
import { compareTrials, summarizeTrials, type Trial } from "../src/efficiency-benchmark"

const baseline: Trial[] = [
  { taskId: "read-and-explain", costUsd: 0.4, durationMs: 2_000, verified: true },
  { taskId: "fix-and-test", costUsd: 0.6, durationMs: 3_000, verified: true },
]

describe("efficiency acceptance benchmark", () => {
  test("accepts an equally verified, faster and 30% cheaper candidate", () => {
    const result = compareTrials(baseline, [
      { taskId: "read-and-explain", costUsd: 0.28, durationMs: 1_800, verified: true },
      { taskId: "fix-and-test", costUsd: 0.42, durationMs: 2_500, verified: true },
    ])
    expect(result.qualityPassed).toBe(true)
    expect(result.safeToRollOut).toBe(true)
    expect(result.targetMet).toBe(true)
    expect(result.costReduction).toBeCloseTo(0.3)
  })

  test("blocks cheap results when verified quality decreases", () => {
    const result = compareTrials(baseline, [
      { taskId: "read-and-explain", costUsd: 0.1, durationMs: 1_000, verified: true },
      { taskId: "fix-and-test", costUsd: 0.1, durationMs: 1_000, verified: false },
    ])
    expect(result.qualityPassed).toBe(false)
    expect(result.safeToRollOut).toBe(false)
  })

  test("blocks candidates with 50% slower execution", () => {
    const result = compareTrials(baseline, [
      { taskId: "read-and-explain", costUsd: 0.2, durationMs: 3_500, verified: true },
      { taskId: "fix-and-test", costUsd: 0.2, durationMs: 4_500, verified: true },
    ])
    expect(result.latencyPassed).toBe(false)
    expect(result.safeToRollOut).toBe(false)
  })

  test("refuses unequal or invalid workloads instead of inventing savings", () => {
    expect(() => compareTrials(baseline, [baseline[0]!])).toThrow()
    expect(() => summarizeTrials([{ taskId: "x", verified: true, costUsd: -1, durationMs: 1 }])).toThrow()
    expect(() => compareTrials(baseline, baseline.map((trial) => ({ ...trial, taskId: "same" })))).toThrow()
  })
})
