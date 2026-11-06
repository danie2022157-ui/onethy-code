/** Private on-device embedding index; stores only normalized vectors and relative file metadata. */
import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Path as GlobalPath } from "@opencode/util/global"

const FORMAT = 1
const MAX_FILES = 350
const MAX_BYTES = 16 * 1024 * 1024
const MAX_DIMENSIONS = 4096

export type Entry = {
  file: string
  mtime: number
  bytes: number
  contentHash: string
  vector: number[]
}
type Index = { version: 1; model: string; entries: Entry[] }

export const embeddingIndexPath = (root: string, dataRoot = GlobalPath.data) => {
  const id = createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 24)
  return path.join(dataRoot, "onethy", "embeddings", id + ".json")
}

const goodEntry = (entry: unknown): entry is Entry => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false
  const value = entry as Partial<Entry>
  return typeof value.file === "string" && value.file.length > 0 && value.file.length < 4096 &&
    !path.isAbsolute(value.file) && !value.file.split(/[\\/]/).includes("..") &&
    typeof value.mtime === "number" && Number.isFinite(value.mtime) &&
    typeof value.bytes === "number" && Number.isFinite(value.bytes) && value.bytes >= 0 &&
    typeof value.contentHash === "string" && /^[a-f0-9]{64}$/.test(value.contentHash) &&
    Array.isArray(value.vector) && value.vector.length > 0 && value.vector.length <= MAX_DIMENSIONS &&
    value.vector.every((num) => typeof num === "number" && Number.isFinite(num))
}

/** A corrupt or older index must never break semantic search. */
export function parseEmbeddingIndex(value: unknown, model: string): Entry[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const index = value as Partial<Index>
  if (index.version !== FORMAT || index.model !== model || !Array.isArray(index.entries)) return []
  return index.entries.slice(0, MAX_FILES).filter(goodEntry)
}

const open = new Map<string, Promise<ReturnType<typeof makeIndex>>>()

function makeIndex(file: string, model: string, records: Entry[]) {
  const entries = new Map(records.map((entry) => [entry.file, entry]))
  let pending: Promise<void> = Promise.resolve()
  return {
    get: (file: string, hash: string) => {
      const item = entries.get(file)
      return item?.contentHash === hash ? item.vector : undefined
    },
    update: (next: ReadonlyArray<Entry>, files: ReadonlyArray<string>) => {
      const allowed = new Set(files)
      for (const file of entries.keys()) if (!allowed.has(file)) entries.delete(file)
      for (const entry of next) if (goodEntry(entry) && allowed.has(entry.file)) entries.set(entry.file, entry)
      const data = JSON.stringify({
        version: FORMAT,
        model,
        entries: [...entries.values()].slice(0, MAX_FILES),
      } satisfies Index)
      if (Buffer.byteLength(data, "utf8") > MAX_BYTES) return Promise.resolve()
      pending = pending.catch(() => {}).then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
        const temporary = file + "." + randomBytes(6).toString("hex") + ".tmp"
        try {
          await fs.writeFile(temporary, data, { encoding: "utf8", mode: 0o600, flag: "wx" })
          await fs.rename(temporary, file)
        } finally {
          await fs.rm(temporary, { force: true }).catch(() => {})
        }
      }).catch(() => {})
      return pending
    },
  }
}

export async function localEmbeddingIndex(
  root: string,
  model: string,
  dataRoot = GlobalPath.data,
) {
  const file = embeddingIndexPath(root, dataRoot)
  const key = file + "|" + model
  const existing = open.get(key)
  if (existing) return existing
  const loading = (async () => {
    let parsed: unknown
    try {
      const stat = await fs.stat(file)
      if (stat.isFile() && stat.size <= MAX_BYTES) parsed = JSON.parse(await fs.readFile(file, "utf8"))
    } catch {
      // Rebuild automatically after absence, truncation or corrupt data.
    }
    return makeIndex(file, model, parseEmbeddingIndex(parsed, model))
  })()
  open.set(key, loading)
  try {
    return await loading
  } catch (error) {
    open.delete(key)
    throw error
  }
}
