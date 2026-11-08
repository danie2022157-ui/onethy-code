/**
 * Safe, bounded diagnostic log reader shared by the OnethyCode CLI and TUI.
 * The raw on-disk log is never copied to the clipboard or printed.
 * Redaction is best effort: users should review any exported diagnostics.
 */
import { open } from "node:fs/promises"
import { Logging } from "./logging.js"
import { redact } from "./log-redaction.js"

export type Source = "all" | "cli" | "tui" | "server"
export type Level = "all" | "DEBUG" | "INFO" | "WARN" | "ERROR"
export interface Filter {
  readonly source?: Source
  readonly level?: Level
  readonly search?: string
  readonly lines?: number
}

export const MAX_READ_BYTES = 512 * 1024
export const MAX_LINES = 500

export function logPath(channel = "local") {
  return Logging.file(channel === "local", channel)
}

/** Dedicated low-volume incident stream, independent of noisy INFO/DEBUG messages. */
export function errorLogPath(channel = "local") {
  return Logging.errorFile(channel === "local", channel)
}

export { redact } from "./log-redaction.js"

export function filterLine(line: string, filter: Filter = {}) {
  if (filter.source && filter.source !== "all" && !line.includes("role=" + filter.source)) return false
  if (filter.level && filter.level !== "all" && !line.includes("level=" + filter.level)) return false
  if (filter.search && !line.toLowerCase().includes(filter.search.toLowerCase())) return false
  return true
}

export function filterLines(input: readonly string[], filter: Filter = {}) {
  const lines = Math.max(1, Math.min(MAX_LINES, Math.floor(filter.lines ?? 150)))
  return input.map(redact).filter((line) => line.length > 0 && filterLine(line, filter)).slice(-lines)
}

export async function readLogs(file: string, filter: Filter = {}): Promise<string[]> {
  const content = await readBytes(file, 0, true)
  const lines = content.text.split(/\r?\n/)
  // Never display half-written records: their key names may be in a different
  // write chunk, making otherwise recognizable secrets impossible to redact.
  if (content.text && !content.text.endsWith("\n")) lines.pop()
  if (content.truncated) lines.shift()
  return filterLines(lines, filter)
}

export interface Chunk {
  readonly text: string
  readonly offset: number
  readonly truncated: boolean
}

/** Reads only a bounded range. For tailing, pass the previous offset. */
export async function readBytes(file: string, offset = 0, tail = false): Promise<Chunk> {
  const handle = await open(file, "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (!handle) return { text: "", offset: 0, truncated: false }
  try {
    const size = Number((await handle.stat()).size)
    let start = tail ? Math.max(0, size - MAX_READ_BYTES) : offset
    if (start > size) start = 0 // The file was rotated/truncated.
    const truncated = tail ? start > 0 : size - start > MAX_READ_BYTES
    if (size - start > MAX_READ_BYTES) start = size - MAX_READ_BYTES
    const length = Math.max(0, size - start)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    return { text: buffer.subarray(0, bytesRead).toString("utf8"), offset: start + bytesRead, truncated }
  } finally {
    await handle.close()
  }
}
