/** Local-only embedding search via Ollama (optional; does not download models). */
export * as OmniEmbeddings from "./omni-embeddings.js"

import fs from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const git = promisify(execFile)
const OLLAMA = "http://127.0.0.1:11434/api/embed"
const MODEL = "nomic-embed-text"
const MAX_FILES = 350
const MAX_BYTES_PER_FILE = 64 * 1024
const MAX_INPUT_CHARACTERS = 4500
const EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".java",
  ".cs", ".cpp", ".h", ".rb", ".php", ".vue", ".svelte", ".sql", ".sh", ".md",
])
const EXCLUDED = new Set([
  ".git", ".omnicode", "node_modules", "dist", "build", ".next", "coverage",
  "vendor", "target", ".venv", ".turbo", "out", "__pycache__",
])
const cache = new Map<string, { mtime: number; bytes: number; vector: number[] }>()

export interface Result {
  readonly file: string
  readonly score: number
  readonly line: number
  readonly excerpt: string
}

export function sourceAllowed(file: string): boolean {
  const segments = file.replaceAll("\\", "/").split("/")
  if (segments.some((part) => EXCLUDED.has(part) || part.startsWith("."))) return false
  const name = segments.at(-1)?.toLowerCase() ?? ""
  if (name.includes("secret") || name.includes("credential") ||
    name.includes("private") || name.endsWith(".key") || name.endsWith(".pem")) return false
  return EXTENSIONS.has(path.extname(name))
}

export function similarity(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let xx = 0
  let yy = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    xx += a[i]! ** 2
    yy += b[i]! ** 2
  }
  return xx > 0 && yy > 0 ? dot / Math.sqrt(xx * yy) : 0
}

function parseVectors(data: unknown, count: number): number[][] {
  const embeddings = (data as { embeddings?: unknown })?.embeddings
  if (!Array.isArray(embeddings) || embeddings.length !== count) throw new Error("Ollama returned invalid embedding data")
  const vectors = embeddings.map((embedding: unknown) => {
    if (!Array.isArray(embedding) || embedding.length === 0 ||
      embedding.some((num) => typeof num !== "number" || !Number.isFinite(num)))
      throw new Error("Ollama returned an invalid embedding vector")
    return embedding as number[]
  })
  const dimension = vectors[0]?.length
  if (vectors.some((vector) => vector.length !== dimension)) throw new Error("Ollama vector dimensions differ")
  return vectors
}

async function embed(input: string[]): Promise<number[][]> {
  let res: Response
  try {
    res = await fetch(OLLAMA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, input, truncate: true }),
      signal: AbortSignal.timeout(40_000),
    })
  } catch {
    throw new Error("Ollama local is unavailable (127.0.0.1:11434). Start Ollama and install nomic-embed-text.")
  }
  if (!res.ok) throw new Error("Ollama embedding request failed (" + res.status + "). Install or load " + MODEL + ".")
  return parseVectors(await res.json(), input.length)
}

/**
 * Git-scoped bounded embedding retrieval. Results are computed on-device and cached
 * in process memory only; no project source code is sent to remote endpoints.
 */
export async function semanticSearch(root: string, query: string, limit = 10): Promise<Result[]> {
  if (!query.trim()) return []
  const cwd = path.resolve(root)
  const output = await git("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd, timeout: 10_000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8",
  })
  const files = output.stdout.split("\0").filter(sourceAllowed).slice(0, MAX_FILES)
  const nodes: Array<{ file: string; key: string; mtime: number; bytes: number; source: string }> = []
  for (const file of files) {
    try {
      const fullPath = path.join(cwd, file)
      if (!fullPath.startsWith(cwd + path.sep)) continue
      const stat = await fs.lstat(fullPath)
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > MAX_BYTES_PER_FILE) continue
      const content = (await fs.readFile(fullPath, "utf8")).slice(0, MAX_INPUT_CHARACTERS)
      if (content.includes("\0")) continue
      nodes.push({
        file, key: fullPath, mtime: stat.mtimeMs, bytes: stat.size,
        source: file + "\n" + content,
      })
    } catch {}
  }
  const missing = nodes.filter((node) => {
    const cached = cache.get(node.key)
    return !cached || cached.mtime !== node.mtime || cached.bytes !== node.bytes
  })
  for (let i = 0; i < missing.length; i += 16) {
    const batch = missing.slice(i, i + 16)
    const vectors = await embed(batch.map((node) => node.source))
    for (let j = 0; j < batch.length; j++) {
      const node = batch[j]!
      cache.set(node.key, { mtime: node.mtime, bytes: node.bytes, vector: vectors[j]! })
    }
  }
  const [queryVector] = await embed([query])
  return nodes.map((node) => {
    const content = node.source.split("\n")
    const index = content.findIndex((line, n) => n > 0 && /\b(export|function|class|interface|def|async|func|type)\b/.test(line))
    return {
      file: node.file,
      score: similarity(queryVector!, cache.get(node.key)!.vector),
      line: Math.max(1, index),
      excerpt: content[Math.max(1, index)]?.trim().slice(0, 200) ?? "",
    }
  }).sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, limit)
}
