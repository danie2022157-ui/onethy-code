import path from "node:path"
import { mkdir, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { resolveConfigPath } from "../commands/handlers/mcp/add"
import {
  bundlePath, isNativeMCP, listNativeMCPs, removeNativeMCP, restoreNativeMCP,
} from "./onethy-mcp-manager.mjs"

type ConfigData = {
  mcp?: Record<string, unknown> & {
    servers?: Record<string, unknown>
    overrides?: Record<string, boolean>
  }
}
type Snapshot = {
  file: string
  source: string
  data: ConfigData
}
export type McpAction = "enable" | "disable" | "remove" | "restore"
export type ManagedMcp = {
  name: string
  kind: "native" | "custom"
  present: boolean
  enabled?: boolean
  location: "project" | "global" | "none"
}

async function snapshot(directory: string): Promise<Snapshot> {
  const file = await resolveConfigPath(directory)
  const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (stat && (!stat.isFile() || stat.isSymbolicLink()))
    throw new Error("MCP configuration cannot be a symbolic link: " + file)
  const source = stat ? await readFile(file, "utf8") : "{}"
  const errors: ParseError[] = []
  const data = parse(source, errors, { allowTrailingComma: true }) as ConfigData
  if (errors.length || !data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Invalid JSON/JSONC configuration: " + file)
  if (data.mcp !== undefined && (typeof data.mcp !== "object" || data.mcp === null || Array.isArray(data.mcp)))
    throw new Error("Invalid 'mcp' field: " + file)
  return { file, source, data }
}
const own = (value: unknown, name: string) =>
  !!value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, name)

function configured(snap: Snapshot, name: string) {
  const mcp = snap.data.mcp
  if (!mcp) return false
  return own(mcp.servers, name) || (own(mcp, name) && name !== "servers" && name !== "overrides")
}
function names(snap: Snapshot) {
  const mcp = snap.data.mcp
  if (!mcp) return []
  const serverNames = Object.keys(mcp.servers && typeof mcp.servers === "object" ? mcp.servers : {})
  const direct = Object.keys(mcp).filter(name => !["servers", "overrides", "timeout"].includes(name))
  return [...new Set([...serverNames, ...direct])]
}
function override(snap: Snapshot, name: string): boolean | undefined {
  const values = snap.data.mcp?.overrides
  if (!values || typeof values !== "object") return undefined
  return typeof values[name] === "boolean" ? values[name] : undefined
}

async function atomicWrite(file: string, data: string) {
  const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (stat && (!stat.isFile() || stat.isSymbolicLink()))
    throw new Error("Refusing to modify configuration through symbolic links")
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = file + "." + randomUUID() + ".tmp"
  await writeFile(temporary, data.endsWith("\n") ? data : data + "\n", { flag: "wx", mode: 0o600 })
  try { await rename(temporary, file) }
  catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}
async function editConfig(
  snap: Snapshot,
  changes: ReadonlyArray<{ path: (string | number)[]; value: unknown }>,
) {
  let source = snap.source
  for (const change of changes) {
    source = applyEdits(source, modify(source, change.path, change.value, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }))
  }
  if (source === snap.source) return false
  await atomicWrite(snap.file, source)
  return true
}

export async function managedMcpList(cwd: string, globalRoot: string): Promise<ManagedMcp[]> {
  const projectRoot = path.join(cwd, ".opencode")
  const [nativeProject, nativeGlobal, localConfig, globalConfig] = await Promise.all([
    listNativeMCPs(projectRoot), listNativeMCPs(globalRoot), snapshot(cwd), snapshot(globalRoot),
  ])
  const localMap = new Map(nativeProject.map(item => [item.name, item.installed]))
  const globalMap = new Map(nativeGlobal.map(item => [item.name, item.installed]))
  const result: ManagedMcp[] = nativeProject.map(item => {
    const location = localMap.get(item.name) ? "project" : globalMap.get(item.name) ? "global" : "none"
    return {
      name: item.name,
      kind: "native",
      present: location !== "none",
      location,
      enabled: override(localConfig, item.name) ?? override(globalConfig, item.name),
    }
  })
  const others = new Set([...names(globalConfig), ...names(localConfig)].filter(name => !isNativeMCP(name)))
  for (const name of others) result.push({
    name,
    kind: "custom",
    present: true,
    location: configured(localConfig, name) ? "project" : "global",
    enabled: override(localConfig, name) ?? override(globalConfig, name),
  })
  return result.toSorted((a, b) => a.name.localeCompare(b.name))
}

export async function manageMcp(input: {
  action: McpAction
  name: string
  cwd: string
  globalRoot: string
  global?: boolean
}): Promise<string> {
  const { action, name, cwd, globalRoot } = input
  if (!name || name.length > 128) throw new Error("Enter a valid MCP server name")
  const projectRoot = path.join(cwd, ".opencode")
  const root = input.global ? globalRoot : projectRoot
  const directory = input.global ? globalRoot : cwd
  const target = await snapshot(directory)

  if (action === "restore") {
    if (!isNativeMCP(name) && name !== "all")
      throw new Error("Only native OnethyCode MCPs can be restored")
    const restored = await restoreNativeMCP(root, name)
    await editConfig(target, restored
      .filter(id => override(target, id) !== undefined)
      .map(id => ({ path: ["mcp", "overrides", id], value: undefined })))
    return "Restored " + restored.length + " native MCP server(s) at " + bundlePath(root)
  }

  const projectNative = await listNativeMCPs(projectRoot)
  const globalNative = await listNativeMCPs(globalRoot)
  const localConfig = input.global ? target : await snapshot(cwd)
  const globalConfig = input.global ? target : await snapshot(globalRoot)
  const inProjectNative = projectNative.some(item => item.name === name && item.installed)
  const inGlobalNative = globalNative.some(item => item.name === name && item.installed)
  const currentNative = input.global ? inGlobalNative : inProjectNative
  const available = input.global
    ? inGlobalNative || configured(globalConfig, name)
    : inProjectNative || inGlobalNative || configured(localConfig, name) || configured(globalConfig, name)
  if (!available) throw new Error("MCP not found: " + name + ". Use 'onethy mcp restore' for native MCPs.")

  if (action === "enable" || action === "disable") {
    await editConfig(target, [{ path: ["mcp", "overrides", name], value: action === "enable" }])
    return "MCP " + name + (action === "enable" ? " enabled" : " disabled") +
      " in the " + (input.global ? "global" : "project") + "."
  }
  if (action === "remove") {
    if (!currentNative && !configured(target, name)) {
      if (inGlobalNative && !input.global)
        throw new Error("This MCP is installed globally. Use --global to delete it.")
      throw new Error("MCP not found in the selected scope: " + name)
    }
    if (currentNative) await removeNativeMCP(root, name)
    const changes: Array<{ path: string[]; value: unknown }> = []
    if (own(target.data.mcp?.servers, name)) changes.push({ path: ["mcp", "servers", name], value: undefined })
    if (configured(target, name) && own(target.data.mcp, name))
      changes.push({ path: ["mcp", name], value: undefined })
    if (override(target, name) !== undefined)
      changes.push({ path: ["mcp", "overrides", name], value: undefined })
    await editConfig(target, changes)
    return "MCP " + name + " removed from the " + (input.global ? "global" : "project") +
      ". Other MCP servers were preserved."
  }
  throw new Error("Unknown MCP action: " + action)
}
