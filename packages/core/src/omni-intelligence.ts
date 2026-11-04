/** Read-only, bounded discovery helpers for the OnethyCode terminal. */
export * as OmniIntelligence from "./omni-intelligence.js"

import fs from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const git = promisify(execFile)
const IGNORE = new Set([
  ".git", ".omnicode", ".svn", ".hg", "node_modules", "dist", "build",
  ".next", "coverage", ".turbo", "target", ".venv", "vendor", "out",
])
const EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc", ".py", ".rs",
  ".go", ".java", ".kt", ".cs", ".c", ".h", ".cpp", ".hpp", ".rb", ".php",
  ".vue", ".svelte", ".sql", ".sh", ".ps1", ".md", ".mdx", ".toml", ".yaml", ".yml",
])
const ALIASES: Record<string, string[]> = {
  login: ["auth", "signin", "authenticate", "authentication", "session"],
  autenticacao: ["auth", "login", "authentication", "credential"],
  usuario: ["user", "account", "profile"],
  banco: ["database", "db", "sql", "repository", "storage"],
  erro: ["error", "exception", "failure", "throw"],
  teste: ["test", "spec", "assert", "expect"],
  busca: ["search", "query", "find", "lookup"],
  memoria: ["memory", "remember", "knowledge", "context"],
  permissao: ["permission", "allow", "deny", "policy"],
  projeto: ["project", "workspace", "repository"],
  agente: ["agent", "subagent", "worker"],
  custo: ["cost", "usage", "token", "price"],
}
const MAX_FILES = 1200
const MAX_TOTAL_BYTES = 8 * 1024 * 1024
const MAX_FILE_BYTES = 128 * 1024

export interface Match {
  readonly file: string
  readonly line: number
  readonly score: number
  readonly excerpt: string
}

export interface CatalogEntry {
  readonly category: string
  readonly name: string
  readonly description: string
}

export function tokenize(input: string): string[] {
  return (input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase().match(/[a-z0-9_]+/g) ?? [])
    .flatMap((term) => term.split("_"))
    .filter((term) => term.length >= 2)
}

function terms(query: string): string[] {
  const tokens = tokenize(query)
  return [...new Set(tokens.flatMap((token) => [token, ...(ALIASES[token] ?? [])]))]
}

export function relevance(query: string, title: string, content: string): number {
  const words = terms(query)
  if (!words.length) return 0
  const titleWords = new Set(tokenize(title))
  const contentWords = new Set(tokenize(content.slice(0, 4000)))
  const normalizedTitle = title.toLowerCase()
  const normalizedContent = content.toLowerCase()
  let score = 0
  for (const word of words) {
    if (titleWords.has(word)) score += 7
    else if (normalizedTitle.includes(word)) score += 3
    if (contentWords.has(word)) score += 2
    else if (normalizedContent.includes(word)) score += 0.5
  }
  if (normalizedTitle.includes(query.toLowerCase())) score += 9
  if (normalizedContent.includes(query.toLowerCase())) score += 3
  return score
}

export function rankCatalog(items: readonly CatalogEntry[], query: string, limit = 10): CatalogEntry[] {
  if (!query.trim()) return items.slice(0, limit)
  return items.map((entry) => ({ entry, score: relevance(query, entry.name, entry.description) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map((item) => item.entry)
}

function ignoredFile(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.startsWith(".env") || lower.endsWith(".pem") ||
    lower.endsWith(".key") || lower.includes("credentials") ||
    lower.includes("secrets") || lower === "id_rsa" || lower === "id_ed25519" ||
    lower === "package-lock.json" || lower.endsWith(".lock")
}

/** A bounded scan, never traversing symlinks or known generated/private directories. */
export async function searchWorkspace(root: string, query: string, limit = 10): Promise<Match[]> {
  if (!query.trim()) return []
  const found: Match[] = []
  const pending = [path.resolve(root)]
  let seen = 0
  let bytes = 0
  while (pending.length && seen < MAX_FILES && bytes < MAX_TOTAL_BYTES) {
    const directory = pending.shift()!
    let entries: import("node:fs").Dirent[]
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!IGNORE.has(entry.name) && !entry.name.startsWith(".")) pending.push(path.join(directory, entry.name))
        continue
      }
      if (!entry.isFile() || ignoredFile(entry.name) || !EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      if (seen++ >= MAX_FILES || bytes >= MAX_TOTAL_BYTES) break
      const file = path.join(directory, entry.name)
      const relative = path.relative(root, file).replace(/\\/g, "/")
      try {
        const stat = await fs.lstat(file)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES || stat.size === 0) continue
        bytes += stat.size
        const content = await fs.readFile(file, "utf8")
        if (content.includes("\0")) continue
        const pathScore = relevance(query, relative, "")
        let bestLine = 0
        let bestScore = 0
        let bestExcerpt = ""
        const lines = content.split(/\r?\n/)
        for (let index = 0; index < lines.length; index++) {
          const text = lines[index]!
          const score = relevance(query, "", text)
          if (score > bestScore) {
            bestLine = index + 1
            bestScore = score
            bestExcerpt = text.trim().slice(0, 240)
          }
        }
        if (pathScore + bestScore > 0)
          found.push({ file: relative, line: bestLine, excerpt: bestExcerpt, score: pathScore + bestScore })
      } catch {
        // Files may disappear while an agent edits; keep search available.
      }
    }
  }
  return found.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, limit)
}

async function readHistoryFiles(directory: string, suffix: string, max = 100): Promise<CatalogEntry[]> {
  let names: string[]
  try {
    names = (await fs.readdir(directory)).filter((name) => /^[\w-]+\.(json|md)$/.test(name) && name.endsWith(suffix))
  } catch {
    return []
  }
  const records: CatalogEntry[] = []
  for (const name of names.sort().reverse().slice(0, max)) {
    try {
      const file = path.join(directory, name)
      const stat = await fs.lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 48 * 1024) continue
      const data = (await fs.readFile(file, "utf8")).slice(0, 7000)
      records.push({ category: "history", name: path.basename(directory) + "/" + name, description: data })
    } catch {}
  }
  return records
}

/** Searches Onethy-specific persisted sessions, mission state and project memory. */
export async function searchProjectHistory(root: string, query: string, limit = 10): Promise<CatalogEntry[]> {
  const base = path.join(path.resolve(root), ".omnicode")
  const collections = await Promise.all([
    readHistoryFiles(path.join(base, "sessions"), ".json"),
    readHistoryFiles(path.join(base, "missions"), ".json"),
    readHistoryFiles(path.join(base, "plans"), ".md"),
    readHistoryFiles(path.join(base, "memory-bank"), ".md", 20),
  ])
  return rankCatalog(collections.flat(), query, limit).map((record) => ({
    ...record, description: record.description.slice(0, 900),
  }))
}

export interface DiffReview {
  readonly changed: string[]
  readonly patch: string
  readonly truncated: boolean
}

/** Only executes read-only git subcommands with an argv array, never via a shell. */
export async function reviewDiff(root: string): Promise<DiffReview> {
  const cwd = path.resolve(root)
  const options = { cwd, encoding: "utf8" as const, windowsHide: true, timeout: 12000, maxBuffer: 2 * 1024 * 1024 }
  const [status, unstaged, staged] = await Promise.all([
    git("git", ["status", "--short", "--untracked-files=normal"], options),
    git("git", ["diff", "--no-ext-diff", "--no-color", "--"], options),
    git("git", ["diff", "--cached", "--no-ext-diff", "--no-color", "--"], options),
  ])
  const patch = ["--- Unstaged ---", unstaged.stdout, "--- Staged ---", staged.stdout].join("\n")
  return {
    changed: status.stdout.split(/\r?\n/).filter(Boolean).slice(0, 100),
    patch: patch.slice(0, 28000),
    truncated: patch.length > 28000 || status.stdout.split(/\r?\n/).length > 101,
  }
}
