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
