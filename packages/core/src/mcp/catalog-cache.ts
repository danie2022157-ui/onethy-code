/** Private, short-lived, scope-bound MCP discovery cache. Only trusted local stdio MCPs. */
import { createHash, createHmac, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Path as GlobalPath } from "@opencode/util/global"
import type { Mcp } from "@opencode/schema/mcp"
import type { McpClient } from "./client.js"

const VERSION = 1
const TTL_MS = 30 * 60_000
const MAX_FILE_BYTES = 512 * 1024
const MAX_TOOLS = 100

const hash = (text: string) => createHash("sha256").update(text).digest("hex")
export const catalogCacheDirectory = (workspace: string, dataRoot = GlobalPath.data) =>
  path.join(dataRoot, "onethy", "mcp-catalog", hash(path.resolve(workspace)).slice(0, 24))

type Cached = {
  version: 1
  name: string
  fingerprint: string
  recordedAt: number
  tools: McpClient.Tool[]
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
function safeTool(value: unknown): value is McpClient.Tool {
  if (!isObject(value) || typeof value.name !== "string" || !/^[a-zA-Z0-9_.-]{1,160}$/.test(value.name) ||
    !isObject(value.inputSchema) || value.inputSchema.type !== "object") return false
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.length > 8000))
    return false
  if (value.outputSchema !== undefined && !isObject(value.outputSchema)) return false
  try { return JSON.stringify(value).length < 32 * 1024 } catch { return false }
}
export function validCatalog(value: unknown, name: string, fingerprint: string, now = Date.now()): McpClient.Tool[] | undefined {
  if (!isObject(value) || value.version !== VERSION || value.name !== name ||
    value.fingerprint !== fingerprint || typeof value.recordedAt !== "number" ||
    !Number.isFinite(value.recordedAt) || value.recordedAt > now ||
    now - value.recordedAt > TTL_MS || !Array.isArray(value.tools) || value.tools.length > MAX_TOOLS ||
    !value.tools.every(safeTool)) return
  return value.tools as McpClient.Tool[]
}
/** Only local stdio configurations can be cached; never cache remote OAuth/headers-based catalogs. */
export const cacheable = (config: Mcp.ServerConfig) =>
  config.type === "local" && !config.disabled && process.env.ONETHY_MCP_CATALOG_CACHE !== "off"

/** Does not store the command or potentially sensitive environment values in the cache. */
export async function openMcpCatalogCache(workspace: string, dataRoot = GlobalPath.data) {
  const directory = catalogCacheDirectory(workspace, dataRoot)
  const saltFile = path.join(directory, ".salt")
  let salt: Buffer
  try {
    const stat = await fs.lstat(saltFile)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 32) throw new Error("Invalid cache salt")
    salt = await fs.readFile(saltFile)
  } catch {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const fresh = randomBytes(32)
    try { await fs.writeFile(saltFile, fresh, { mode: 0o600, flag: "wx" }) } catch {}
    const stat = await fs.lstat(saltFile)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 32)
      throw new Error("Cannot establish safe cache identity")
    salt = await fs.readFile(saltFile)
  }
  const fingerprint = (config: Mcp.ServerConfig) =>
    createHmac("sha256", salt).update(JSON.stringify(config)).digest("hex")
  const fileFor = (name: string) => path.join(directory, hash(name) + ".json")
  const load = async (name: string, config: Mcp.ServerConfig, now = Date.now()) => {
    if (!cacheable(config)) return undefined
    const file = fileFor(name)
    try {
      const stat = await fs.lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) return undefined
      return validCatalog(JSON.parse(await fs.readFile(file, "utf8")), name, fingerprint(config), now)
    } catch {
      return undefined
    }
  }
  const save = async (name: string, config: Mcp.ServerConfig, tools: ReadonlyArray<McpClient.Tool>, now = Date.now()) => {
    if (!cacheable(config) || tools.length > MAX_TOOLS || !tools.every(safeTool)) return false
    // Store exactly the discovery schema, never executable inputs/outputs, authorization or server config.
    const payload: Cached = {
      version: VERSION, name, fingerprint: fingerprint(config), recordedAt: now,
      tools: JSON.parse(JSON.stringify(tools)) as McpClient.Tool[],
    }
    const content = JSON.stringify(payload)
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) return false
    const file = fileFor(name)
    const temp = file + "." + randomBytes(5).toString("hex") + ".tmp"
    try {
      await fs.writeFile(temp, content, { encoding: "utf8", mode: 0o600, flag: "wx" })
      await fs.rename(temp, file)
      return true
    } finally {
      await fs.rm(temp, { force: true }).catch(() => {})
    }
  }
  const invalidate = async (name: string) => {
    await fs.rm(fileFor(name), { force: true }).catch(() => {})
  }
  return { load, save, invalidate }
}
