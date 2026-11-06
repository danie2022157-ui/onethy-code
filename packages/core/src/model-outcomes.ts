/** Trusted benchmark outcomes only; never infer task success from an agent's own prose. */
import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Path as GlobalPath } from "@opencode/util/global"

const AGE_MS = 90 * 86_400_000
const MAX = 4096
const CATEGORIES = new Set([
  "fast_explore", "external_research", "deep_architecture",
  "code_implementation", "security_review", "orchestration",
])
export type Outcome = {
  taskHash: string
  model: string
  category: string
  passed: boolean
  costUsd: number
  durationMs: number
  recordedAt: number
}
export type VerifiedTrial = {
  taskId: string
  model: string
  category: string
  verified: boolean
  costUsd: number
  durationMs: number
  /** Independent test or review identifier, not agent self-reported text. */
  verifiedBy: string
}
export const resultsFile = (directory: string, dataRoot = GlobalPath.data) =>
  path.join(dataRoot, "onethy", "quality", createHash("sha256").update(path.resolve(directory)).digest("hex").slice(0, 24) + ".json")

function valid(o: unknown): o is Outcome {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false
  const x = o as Partial<Outcome>
  return typeof x.taskHash === "string" && /^[a-f0-9]{64}$/.test(x.taskHash) &&
    typeof x.model === "string" && /^[^\s/]+\/[^\s]+$/.test(x.model) && x.model.length < 240 &&
    typeof x.category === "string" && CATEGORIES.has(x.category) &&
    typeof x.passed === "boolean" &&
    typeof x.costUsd === "number" && Number.isFinite(x.costUsd) && x.costUsd >= 0 &&
    typeof x.durationMs === "number" && Number.isFinite(x.durationMs) && x.durationMs >= 0 &&
    typeof x.recordedAt === "number" && Number.isFinite(x.recordedAt)
}
export function sanitizeOutcomes(source: unknown, now = Date.now()): Outcome[] {
  if (!source || typeof source !== "object" || Array.isArray(source)) return []
  const data = source as { version?: unknown; outcomes?: unknown }
  if (data.version !== 1 || !Array.isArray(data.outcomes)) return []
  const seen = new Set<string>()
  return data.outcomes.filter(valid).filter((o) => {
    if (o.recordedAt > now || now - o.recordedAt > AGE_MS) return false
    const id = o.taskHash + "|" + o.model + "|" + o.category
    if (seen.has(id)) return false
    seen.add(id)
    return true
  }).slice(-MAX)
}
export async function readOutcomes(directory: string, dataRoot = GlobalPath.data): Promise<Outcome[]> {
  try {
    const file = resultsFile(directory, dataRoot)
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return []
    return sanitizeOutcomes(JSON.parse(await fs.readFile(file, "utf8")))
  } catch {
    return []
  }
}
export function normalizeTrial(trial: VerifiedTrial, now: number): Outcome {
  if (typeof trial.taskId !== "string" || !trial.taskId.trim() || trial.taskId.length > 200 ||
    typeof trial.verifiedBy !== "string" || !/^(ci|test|review):[a-zA-Z0-9._/-]{3,100}$/.test(trial.verifiedBy) ||
    typeof trial.model !== "string" || !/^[^\s/]+\/[^\s]+$/.test(trial.model) ||
    typeof trial.category !== "string" || !CATEGORIES.has(trial.category) ||
    typeof trial.verified !== "boolean" ||
    !Number.isFinite(trial.costUsd) || trial.costUsd < 0 ||
    !Number.isFinite(trial.durationMs) || trial.durationMs < 0)
    throw new Error("Invalid independent benchmark outcome")
  return {
    taskHash: createHash("sha256").update(trial.verifiedBy + "\0" + trial.taskId).digest("hex"),
    model: trial.model,
    category: trial.category,
    passed: trial.verified,
    costUsd: trial.costUsd,
    durationMs: trial.durationMs,
    recordedAt: now,
  }
}
/** Import is run only by a deliberate local CLI invocation, not by model-controlled tools. */
export async function importVerifiedOutcomes(
  directory: string,
  trials: ReadonlyArray<VerifiedTrial>,
  dataRoot = GlobalPath.data,
  now = Date.now(),
) {
  if (!trials.length || trials.length > 1000) throw new Error("Expected 1-1000 verified trials")
  const incoming = trials.map((trial) => normalizeTrial(trial, now))
  const previous = await readOutcomes(directory, dataRoot)
  const unique = new Map([...previous, ...incoming].map((o) => [o.taskHash + "|" + o.model + "|" + o.category, o]))
  const outcomes = sanitizeOutcomes({ version: 1, outcomes: [...unique.values()] }, now)
  const file = resultsFile(directory, dataRoot)
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = file + "." + randomBytes(6).toString("hex") + ".tmp"
  try {
    await fs.writeFile(temp, JSON.stringify({ version: 1, outcomes }), { encoding: "utf8", mode: 0o600, flag: "wx" })
    await fs.rename(temp, file)
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {})
  }
  return { imported: incoming.length, retained: outcomes.length }
}
export type Ranking = {
  model: string
  attempts: number
  passRate: number
  usdPerVerified: number
  meanLatencyMs: number
}

/** Compare models for the same class of independently verified task. */
export function rankVerifiedModels(outcomes: ReadonlyArray<Outcome>, category: string, now = Date.now()): Ranking[] {
  const relevant = outcomes.filter((o) => valid(o) && o.category === category &&
    o.recordedAt <= now && now - o.recordedAt <= AGE_MS)
  const groups = new Map<string, Outcome[]>()
  for (const item of relevant) groups.set(item.model, [...(groups.get(item.model) ?? []), item])
  return [...groups].flatMap(([model, items]) => {
    const attempts = items.length
    const passed = items.filter((o) => o.passed).length
    // Require >= 8 independent cases to avoid short-run fluctuations; gate quality at 90%.
    if (attempts < 8 || passed / attempts < 0.9) return []
    const cost = items.reduce((sum, o) => sum + o.costUsd, 0)
    return [{
      model, attempts, passRate: passed / attempts,
      usdPerVerified: cost / passed,
      meanLatencyMs: items.reduce((sum, o) => sum + o.durationMs, 0) / attempts,
    }]
  }).sort((a, b) => b.passRate - a.passRate || a.usdPerVerified - b.usdPerVerified)
}
/**
 * Return an optional scoring function. An override is allowed only if at least two model
 * candidates have sufficiently verified records; the cheapest quality-competitive model
 * wins, with a <= 3 percentage-point gap to the highest observed success rate.
 */
export function learnedModelOrder(
  models: ReadonlyArray<string>,
  outcomes: ReadonlyArray<Outcome>,
  category: string,
  now = Date.now(),
): string[] {
  const eligible = new Set(models)
  const qualified = rankVerifiedModels(outcomes, category, now).filter((o) => eligible.has(o.model))
  if (qualified.length < 2) return []
  const bestRate = Math.max(...qualified.map((o) => o.passRate))
  return qualified.filter((o) => o.passRate >= bestRate - 0.03)
    .sort((a, b) => a.usdPerVerified - b.usdPerVerified || b.passRate - a.passRate)
    .map((o) => o.model)
}
