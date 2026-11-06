import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { importVerifiedOutcomes, learnedModelOrder, readOutcomes, resultsFile, sanitizeOutcomes } from "../src/model-outcomes"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((p) => fs.rm(p, { recursive: true, force: true }))))

describe("trusted model outcome learning", () => {
  test("learns only verified offline tasks without storing original task IDs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "onethy-quality-"))
    roots.push(root)
    const now = Date.now()
    const trials = Array.from({ length: 12 }, (_, i) => ([
      { taskId: "secret-project-task-" + i, model: "a/expensive", category: "code_implementation", verified: true, costUsd: 2, durationMs: 1000, verifiedBy: "ci:trusted-suite" },
      { taskId: "secret-project-task-" + i, model: "b/cheaper", category: "code_implementation", verified: true, costUsd: 1, durationMs: 1500, verifiedBy: "ci:trusted-suite" },
    ])).flat()
    await importVerifiedOutcomes(path.join(root, "project"), trials, root, now)
    const entries = await readOutcomes(path.join(root, "project"), root)
    expect(entries).toHaveLength(24)
    expect(learnedModelOrder(["a/expensive", "b/cheaper"], entries, "code_implementation", now)[0]).toBe("b/cheaper")
    expect(await fs.readFile(resultsFile(path.join(root, "project"), root), "utf8")).not.toContain("secret-project-task")
    expect(await readOutcomes(path.join(root, "other"), root)).toEqual([])
    await importVerifiedOutcomes(path.join(root, "project"), trials, root, now)
    expect(await readOutcomes(path.join(root, "project"), root)).toHaveLength(24)
  })

  test("does not route from sparse, stale or poor evidence", () => {
    const now = Date.now()
    const samples = Array.from({ length: 8 }, (_, i) => ({
      taskHash: String(i).padStart(64, "0"), model: "a/bad", category: "code_implementation",
      passed: i < 5, costUsd: 0, durationMs: 1, recordedAt: now,
    }))
    expect(learnedModelOrder(["a/bad", "b/new"], samples, "code_implementation", now)).toEqual([])
    expect(sanitizeOutcomes({ version: 1, outcomes: samples }, now - 91 * 86_400_000)).toEqual([])
  })

  test("requires evidence attribution and rejects untrusted schema", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "onethy-quality-"))
    roots.push(root)
    await expect(importVerifiedOutcomes(root, [{
      taskId: "test", model: "a/b", category: "code_implementation",
      verified: true, costUsd: 1, durationMs: 1, verifiedBy: "agent:self-report",
    }], root)).rejects.toThrow()
  })
})
