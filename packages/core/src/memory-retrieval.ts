/** Read-only bounded project/global memory retrieval. Never indexes arbitrary user files. */
import { createHash } from "node:crypto"
import path from "node:path"
import { localEmbeddingIndex } from "./embedding-index.js"
import { OmniEmbeddings } from "./omni-embeddings.js"
import {
  readMemoryFile, PROJECT_TEMPLATES, GLOBAL_TEMPLATES,
} from "./omni-memory-bank.js"

const WORDS = /[\p{L}\p{N}_-]{3,}/gu
const MAX_CHUNKS = 60
const MAX_CHARS = 1500
export type MemoryHit = {
  file: string
  line: number
  excerpt: string
  score: number
  method: "lexical" | "hybrid"
}
type Chunk = { id: string; file: string; line: number; content: string; hash: string }

export function tokenize(value: string): string[] {
  return [...new Set((value.toLowerCase().match(WORDS) ?? []).slice(0, 160))]
}
export function memoryChunks(directory: string, scope: "project" | "global"): Chunk[] {
  const templates = scope === "global" ? GLOBAL_TEMPLATES : PROJECT_TEMPLATES
  const chunks: Chunk[] = []
  for (const file of Object.keys(templates)) {
    const content = readMemoryFile(directory, file)
    if (!content) continue
    const lines = content.split(/\r?\n/)
    let buffer: string[] = []
    let start = 1
    const push = () => {
      if (!buffer.length) return
      const text = buffer.join("\n").trim()
      if (text) {
        const id = file + "#" + start
        chunks.push({
          id, file, line: start, content: text,
          hash: createHash("sha256").update(id + "\n" + text).digest("hex"),
        })
      }
      buffer = []
    }
    for (let i = 0; i < lines.length; i++) {
      const next = lines[i]!
      if (buffer.join("\n").length + next.length > MAX_CHARS) {
        push()
        start = i + 1
      }
      if (next.length > MAX_CHARS) {
        for (let offset = 0; offset < next.length; offset += MAX_CHARS) {
          start = i + 1
          buffer.push(next.slice(offset, offset + MAX_CHARS))
          push()
        }
      } else {
        if (!buffer.length) start = i + 1
        buffer.push(next)
        if (!next.trim()) push()
      }
      if (chunks.length >= MAX_CHUNKS) return chunks
    }
    push()
    if (chunks.length >= MAX_CHUNKS) break
  }
  return chunks
}
const scoreText = (query: ReadonlyArray<string>, text: string) => {
  const lower = text.toLowerCase()
  const terms = text.toLowerCase().match(WORDS) ?? []
  if (!terms.length || !query.length) return 0
  const frequencies = new Map<string, number>()
  for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
  return query.reduce((sum, term) => {
    const frequency = frequencies.get(term) ?? 0
    return sum + (frequency ? frequency / (frequency + 1.2) * 2 : lower.includes(term) ? 0.2 : 0)
  }, 0) / Math.sqrt(1 + terms.length / 100)
}

/**
 * Semantic embeddings are optional and on-device via Ollama only. If unavailable,
 * the search remains useful with deterministic lexical ranking.
 */
export async function searchMemory(
  directory: string,
  scope: "project" | "global",
  query: string,
  limit = 5,
  semantic = true,
): Promise<MemoryHit[]> {
  if (!query.trim()) return []
  const count = Math.max(1, Math.min(10, Math.floor(limit)))
  const chunks = memoryChunks(directory, scope)
  if (!chunks.length) return []
  const tokens = tokenize(query)
  const lexical = chunks.map((chunk) => scoreText(tokens, chunk.content + " " + chunk.file))
  let embeddings: Array<number | undefined> = []
  if (semantic) {
    try {
      const model = "memory-nomic-embed-text-v1"
      // Project scope and global scope use different directories and cache keys.
      const index = await localEmbeddingIndex(path.resolve(directory), model)
      const missing = chunks.filter((chunk) => !index.get(chunk.id, chunk.hash))
      for (let start = 0; start < missing.length; start += 12) {
        const batch = missing.slice(start, start + 12)
        const vectors = await OmniEmbeddings.embedTexts(batch.map((item) => item.content))
        const updated = batch.map((item, i) => ({
          file: item.id,
          contentHash: item.hash,
          vector: vectors[i]!,
          mtime: 0,
          bytes: item.content.length,
        }))
        await index.update(updated, chunks.map((item) => item.id))
      }
      const [vector] = await OmniEmbeddings.embedTexts([query])
      embeddings = chunks.map((item) => {
        const stored = index.get(item.id, item.hash)
        return stored && vector ? OmniEmbeddings.similarity(vector, stored) : undefined
      })
    } catch {
      // Ollama is optional; never send memory to another host as fallback.
    }
  }
  return chunks.map((chunk, i) => ({
    file: chunk.file,
    line: chunk.line,
    excerpt: chunk.content.slice(0, 650),
    score: lexical[i]! + Math.max(0, embeddings[i] ?? 0) * 2,
    method: embeddings[i] === undefined ? "lexical" as const : "hybrid" as const,
  })).filter((hit) => hit.score > 0).sort((a, b) =>
    b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line).slice(0, count)
}
