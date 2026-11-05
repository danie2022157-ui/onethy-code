/**
 * Persistent local MCP template operations for OnethyCode.
 *
 * This module is deliberately dependency-free so it can be tested using Node
 * on Windows and Linux. No MCP process is started by a management operation.
 */
import { mkdir, readFile, lstat, open, rename, unlink } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { curatedLocalMCPs, LOCAL_MCP_NAMES } from "./onethy-customizations-local-mcp.mjs"

const known = new Set(LOCAL_MCP_NAMES)
const rootName = "mcp"
const fileParts = [rootName, "onethy", "local-tools.json"]
const bundled = JSON.parse(curatedLocalMCPs()).mcpServers

export function isNativeMCP(name) { return known.has(name) }
export function bundlePath(root) { return join(resolve(root), ...fileParts) }
export function nativeDefaults() { return structuredClone(bundled) }

async function fileInfo(file) {
  try { return await lstat(file) }
  catch (error) {
    if (error.code === "ENOENT") return undefined
    throw error
  }
}

async function safeRoot(root) {
  const candidates = [root, join(root, "mcp"), join(root, "mcp", "onethy")]
  for (const candidate of candidates) {
    const stat = await fileInfo(candidate)
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
      throw new Error("Refusing MCP configuration through a symlink or non-directory: " + candidate)
  }
  const target = bundlePath(root)
  const meta = await fileInfo(target)
  if (meta && (!meta.isFile() || meta.isSymbolicLink()))
    throw new Error("Refusing MCP configuration through a symlink or non-file: " + target)
}

export async function readNativeBundle(root) {
  await safeRoot(root)
  const target = bundlePath(root)
  const meta = await fileInfo(target)
  if (!meta) return undefined
  const raw = await readFile(target, "utf8")
  if (Buffer.byteLength(raw, "utf8") > 128000) throw new Error("Native MCP configuration too large")
  let doc
  try { doc = JSON.parse(raw) }
  catch { throw new Error("Invalid native MCP JSON: " + target) }
  if (!doc || typeof doc !== "object" || Array.isArray(doc) ||
      !doc.mcpServers || typeof doc.mcpServers !== "object" || Array.isArray(doc.mcpServers))
    throw new Error("Invalid native MCP configuration structure: " + target)
  return doc
}

async function atomicWrite(root, data) {
  await safeRoot(root)
  const path = bundlePath(root)
  const parent = dirname(path)
  await mkdir(parent, { recursive: true })
  const temp = path + "." + randomUUID() + ".tmp"
  const handle = await open(temp, "wx", 0o600)
  try {
    await handle.writeFile(JSON.stringify(data, null, 2) + "\n", "utf8")
  } finally { await handle.close() }
  try {
    await safeRoot(root)
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

export async function removeNativeMCP(root, name) {
  if (!isNativeMCP(name)) throw new Error("Not a bundled OnethyCode MCP: " + name)
  const doc = await readNativeBundle(root)
  if (!doc || !Object.hasOwn(doc.mcpServers, name)) return false
  delete doc.mcpServers[name]
  await atomicWrite(root, doc)
  return true
}

export async function restoreNativeMCP(root, name) {
  if (name !== "all" && !isNativeMCP(name)) throw new Error("Unknown bundled MCP: " + name)
  const doc = (await readNativeBundle(root)) ?? { mcpServers: {} }
  const names = name === "all" ? LOCAL_MCP_NAMES : [name]
  for (const id of names) doc.mcpServers[id] = structuredClone(bundled[id])
  await atomicWrite(root, doc)
  return names
}

export async function listNativeMCPs(root) {
  const bundle = await readNativeBundle(root)
  return LOCAL_MCP_NAMES.map(name => ({
    name,
    installed: !!bundle && Object.hasOwn(bundle.mcpServers, name),
  }))
}
