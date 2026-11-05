// One-time cleanup of obsolete auto-generated MCP discovery files.
// Only removes disabled, unedited generated records from the retired namespace.
// User-configured or enabled MCPs are never deleted.
import { readdir, readFile, lstat, unlink, rmdir } from "node:fs/promises"
import { join } from "node:path"
import { createHash } from "node:crypto"

const retiredFingerprint = "2cd3f5ce12d5ffba8f062d37732273b69379a78c59bc58f978a14a8954348090"
const digest = (value) => createHash("sha256").update(value).digest("hex")
const readDir = async (directory) => readdir(directory, { withFileTypes: true }).catch((error) => {
  if (error.code === "ENOENT") return []
  throw error
})

export async function cleanupObsoleteGeneratedMCPs(configRoot) {
  let removed = 0
  const root = join(configRoot, "mcp")
  // User-owned MCP roots can be links to shared directories; never mutate those.
  try { const meta = await lstat(root); if (!meta.isDirectory() || meta.isSymbolicLink()) return removed }
  catch (error) { if (error.code === "ENOENT") return removed; throw error }
  for (const directory of await readDir(root)) {
    if (!directory.isDirectory() || digest(directory.name) !== retiredFingerprint) continue
    const folder = join(root, directory.name)
    for (const item of await readDir(folder)) {
      if (!item.isFile() || !item.name.endsWith(".json")) continue
      const file = join(folder, item.name)
      if (!(await lstat(file)).isFile()) continue
      let parsed
      try { parsed = JSON.parse(await readFile(file, "utf8")) } catch { continue }
      const definitions = parsed?.mcpServers
      if (!definitions || typeof definitions !== "object" || Array.isArray(definitions)) continue
      const all = Object.entries(definitions)
      // Remove only records the previous importer generated, with their
      // original disabled status preserved and without user-added credentials.
      if (!all.length || !all.every(([name, config]) =>
        name.startsWith(directory.name + "-") &&
        config && typeof config === "object" && config.disabled === true &&
        !["env", "environment", "headers", "oauth", "authorization"].some(k => Object.hasOwn(config, k))
      )) continue
      await unlink(file)
      removed++
    }
    await rmdir(folder).catch((error) => { if (!["ENOTEMPTY", "ENOENT"].includes(error.code)) throw error })
  }
  return removed
}


/**
 * Retire the old optional MCP template files generated under mcp/onethy.
 * Keep the three curated local tools, any enabled or manually customized
 * definitions, and anything that cannot be conclusively identified.
 */
export async function cleanupGeneratedOnethyMCPs(configRoot) {
  const parent = join(configRoot, "mcp")
  const directory = join(parent, "onethy")
  for (const target of [parent, directory]) {
    try {
      const info = await lstat(target)
      if (!info.isDirectory() || info.isSymbolicLink()) return 0
    } catch (error) {
      if (error.code === "ENOENT") return 0
      throw error
    }
  }
  let removed = 0
  for (const item of await readDir(directory)) {
    if (!item.isFile() || !/^[a-z0-9-]+-[a-f0-9]{8}\.json$/.test(item.name)) continue
    const file = join(directory, item.name)
    if (!(await lstat(file)).isFile()) continue
    let raw
    let parsed
    try {
      raw = await readFile(file, "utf8")
      if (raw.length > 128000) continue
      parsed = JSON.parse(raw)
    } catch { continue }
    if (!parsed || Object.keys(parsed).length !== 1) continue
    const servers = parsed.mcpServers
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) continue
    const all = Object.entries(servers)
    if (!all.length || !all.every(([key, server]) => {
      if (!/^onethy-[a-z0-9-]+-[a-f0-9]{8}$/.test(key)) return false
      if (!server || typeof server !== "object" || Array.isArray(server) || server.disabled !== true) return false
      const fields = Object.keys(server).toSorted()
      const expected = server.type === "stdio"
        ? ["args", "command", "disabled", "type"]
        : server.type === "http" ? ["disabled", "type", "url"] : []
      if (JSON.stringify(fields) !== JSON.stringify(expected)) return false
      if (server.type === "stdio")
        return typeof server.command === "string" && Array.isArray(server.args) &&
          server.args.every(x => typeof x === "string")
      return server.type === "http" && typeof server.url === "string"
    })) continue
    await unlink(file)
    removed++
  }
  return removed
}


/**
 * Migrate the original three-server OnethyCode bundle to the requested eight
 * servers. Only remove the exact unmodified old template, and only when the
 * containing directories and file are regular filesystem objects.
 *
 * Never discard a user-edited bundle or one with enabled servers.
 */
export async function migrateOldOnethyLocalMCPBundle(configRoot) {
  const parent = join(configRoot, "mcp")
  const directory = join(parent, "onethy")
  const file = join(directory, "local-tools.json")
  for (const target of [parent, directory]) {
    try {
      const info = await lstat(target)
      if (!info.isDirectory() || info.isSymbolicLink()) return false
    } catch (error) {
      if (error.code === "ENOENT") return false
      throw error
    }
  }
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) return false
  } catch (error) {
    if (error.code === "ENOENT") return false
    throw error
  }
  const previous = { mcpServers: {
    "onethy-browser": { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"], disabled: true },
    "onethy-sequential-thinking": { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"], disabled: true },
    "onethy-time": { type: "stdio", command: "uvx", args: ["mcp-server-time"], disabled: true },
  } }
  let existing
  try { existing = JSON.parse(await readFile(file, "utf8")) } catch { return false }
  if (JSON.stringify(existing) !== JSON.stringify(previous)) return false
  await unlink(file)
  return true
}
