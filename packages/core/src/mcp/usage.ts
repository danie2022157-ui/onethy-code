/** OnethyCode's local-only MCP usage learning. No tool inputs, outputs, URLs or credentials are stored. */
import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Path as GlobalPath } from "@opencode/util/global"

const WINDOW_DAYS = 30
const MAX_SERVERS = 128
const MAX_BYTES = 256 * 1024
export const WARM_LIMIT = 3

export type McpDay = { calls: number; successes: number; failures: number; totalLatencyMs: number }
export type McpActivity = {
  name: string
  lastUsedAt: number
  days: Record<string, McpDay>
}
type Database = { version: 1; servers: McpActivity[] }
export type McpPriority = {
  name: string
  tier: "warm" | "standby"
  score: number
  calls7d: number
  lastUsedAt: number | undefined
}

const dayKey = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10)
const validName = (name: string) => name.length > 0 && name.length <= 128 && !/[\u0000-\u001f]/.test(name)
const validNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0

/** Each project owns its learning history, even when its server names also exist globally. */
export function usageFile(directory: string, dataRoot = GlobalPath.data) {
  const identity = createHash("sha256").update(path.resolve(directory)).digest("hex").slice(0, 24)
  return path.join(dataRoot, "onethy", "mcp-usage", identity + ".json")
}

function sanitize(input: unknown, now: number): McpActivity[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return []
  const value = input as Partial<Database>
  if (value.version !== 1 || !Array.isArray(value.servers)) return []
  const earliest = dayKey(now - (WINDOW_DAYS - 1) * 86_400_000)
  const latest = dayKey(now)
  const entries: McpActivity[] = []
  for (const candidate of value.servers.slice(0, MAX_SERVERS * 2)) {
    if (!candidate || typeof candidate !== "object" || !validName(candidate.name) ||
      !validNumber(candidate.lastUsedAt)) continue
    const days: Record<string, McpDay> = Object.create(null)
    if (candidate.days && typeof candidate.days === "object" && !Array.isArray(candidate.days)) {
      for (const [date, day] of Object.entries(candidate.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < earliest || date > latest || !day ||
          !validNumber(day.calls) || !validNumber(day.successes) || !validNumber(day.failures) ||
          !validNumber(day.totalLatencyMs)) continue
        days[date] = {
          calls: Math.min(100_000, Math.floor(day.calls)),
          successes: Math.min(100_000, Math.floor(day.successes)),
          failures: Math.min(100_000, Math.floor(day.failures)),
          totalLatencyMs: Math.min(1_000_000_000, Math.floor(day.totalLatencyMs)),
        }
      }
    }
    if (Object.keys(days).length) entries.push({ name: candidate.name, lastUsedAt: candidate.lastUsedAt, days })
  }
  return entries.sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_SERVERS)
}

export function prioritizeMcp(
  names: ReadonlyArray<string>,
  activity: ReadonlyArray<McpActivity>,
  now = Date.now(),
  warmLimit = WARM_LIMIT,
): McpPriority[] {
  const recent = new Set(Array.from({ length: 7 }, (_, offset) => dayKey(now - offset * 86_400_000)))
  const saved = new Map(activity.map((entry) => [entry.name, entry]))
  const unique = [...new Set(names.filter(validName))]
  const ranked = unique.map((name, index) => {
    const entry = saved.get(name)
    const lastUsedAt = entry?.lastUsedAt
    const days = Object.entries(entry?.days ?? {}).filter(([day]) => recent.has(day)).map(([, count]) => count)
    const calls7d = days.reduce((sum, day) => sum + day.calls, 0)
    const successes = days.reduce((sum, day) => sum + day.successes, 0)
    const failures = days.reduce((sum, day) => sum + day.failures, 0)
    const daysAgo = lastUsedAt === undefined ? 30 : Math.max(0, (now - Math.min(now, lastUsedAt)) / 86_400_000)
    const score = calls7d === 0 ? 0 :
      Math.round(Math.log2(calls7d + 1) * 20 + Math.max(0, 30 - daysAgo * 5) +
        successes / Math.max(1, successes + failures) * 10)
    return { name, calls7d, lastUsedAt, score, index }
  })
  ranked.sort((a, b) => b.score - a.score || a.index - b.index)
  const experienced = ranked.filter((entry) => entry.calls7d >= 2)
  // On a new installation keep only the first two allowed servers warm to avoid an MCP process explosion.
  const warm = new Set((experienced.length ? experienced : ranked.slice(0, 2)).slice(0, warmLimit).map((item) => item.name))
  return ranked.map(({ name, calls7d, lastUsedAt, score }): McpPriority => ({
    name, calls7d, lastUsedAt, score, tier: warm.has(name) ? "warm" : "standby",
  }))
}

export async function openMcpUsage(directory: string, dataRoot = GlobalPath.data) {
  const file = usageFile(directory, dataRoot)
  let parsed: unknown
  try {
    const stat = await fs.stat(file)
    if (stat.isFile() && stat.size <= MAX_BYTES) parsed = JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    // Missing or corrupt telemetry never prevents agents from launching.
  }
  const records = new Map(sanitize(parsed, Date.now()).map((entry) => [entry.name, entry]))
  let pending: Promise<void> = Promise.resolve()
  const snapshot = (): McpActivity[] =>
    sanitize({ version: 1, servers: [...records.values()] }, Date.now())
  const record = (name: string, succeeded: boolean, durationMs: number): Promise<void> => {
    if (!validName(name)) return Promise.resolve()
    const now = Date.now()
    const date = dayKey(now)
    const prev = records.get(name)
    const days = { ...(prev?.days ?? {}) }
    const old = days[date] ?? { calls: 0, successes: 0, failures: 0, totalLatencyMs: 0 }
    days[date] = {
      calls: Math.min(100_000, old.calls + 1),
      successes: Math.min(100_000, old.successes + (succeeded ? 1 : 0)),
      failures: Math.min(100_000, old.failures + (succeeded ? 0 : 1)),
      totalLatencyMs: Math.min(1_000_000_000, old.totalLatencyMs + Math.min(120_000, Math.max(0, Math.round(durationMs)))),
    }
    records.set(name, { name, lastUsedAt: now, days })
    const contents = JSON.stringify({ version: 1, servers: snapshot() } satisfies Database)
    pending = pending.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
      const temp = file + "." + randomBytes(6).toString("hex") + ".tmp"
      try {
        await fs.writeFile(temp, contents, { encoding: "utf8", mode: 0o600, flag: "wx" })
        await fs.rename(temp, file)
      } finally {
        await fs.rm(temp, { force: true }).catch(() => {})
      }
    }).catch(() => {})
    return pending
  }
  return { record, snapshot, prioritize: (names: ReadonlyArray<string>, now = Date.now()) => prioritizeMcp(names, snapshot(), now) }
}
