// OnethyCode -> OnethyCode native file-based personalization importer.
// Safe by default: dry-run, no script execution, no overwrites, no credentials.
import { mkdtemp, readdir, mkdir, copyFile, lstat, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir, homedir } from "node:os"
import { join, relative, resolve, dirname, basename, extname, sep } from "node:path"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cleanupObsoleteGeneratedMCPs, cleanupGeneratedOnethyMCPs, migrateOldOnethyLocalMCPBundle } from "./onethy-customizations-cleanup.mjs"
import { curatedLocalMCPs } from "./onethy-customizations-local-mcp.mjs"
import { curatedNativePlugins } from "./onethy-customizations-local-plugins.mjs"
import { convertOnethyCodeAgent } from "./onethy-customizations-agent.mjs"
import { convertOnethyCodeCommand } from "./onethy-customizations-command.mjs"
import { convertOnethyCodeHook, convertOnethyCodeMod } from "./onethy-customizations-descriptors.mjs"


const CATALOG = "https://github.com/davila7/claude-code-templates.git"
export const types = ["skills", "agents", "commands", "settings", "hooks", "mcps", "plugins", "mods", "loops"]
export async function syncOnethyCustomizations(options = {}) {
const install = options.install === true
const verify = options.verify === true
const chosen = options.type || "all"
const sourceDir = options.sourceDir
if (chosen !== "all" && !types.includes(chosen)) throw new Error("Unknown --type: " + chosen)
const kinds = chosen === "all" ? types : [chosen]
const destination = options.global
  ? resolve(options.globalDir || process.env.OMNICODE_CONFIG_DIR ||
      (process.platform === "win32"
        ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "omnicode")
        : join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omnicode")))
  : resolve(options.cwd || process.cwd(), ".opencode")
const report = { mode: verify ? "verify" : install ? "install" : "preview", target: destination, ready: 0, installed: 0, existing: 0, rejected: 0, pending: 0, errors: [], components: {} }
const staging = sourceDir ? undefined : await mkdtemp(join(tmpdir(), "onethy-onethy-"))
const source = sourceDir ? resolve(sourceDir) : join(staging, "catalog")
if (install && !verify && kinds.includes("mcps")) {
  report.obsoleteGeneratedMcpRemoved =
    (await cleanupObsoleteGeneratedMCPs(destination)) + (await cleanupGeneratedOnethyMCPs(destination))
  report.migratedLocalMcpBundle = await migrateOldOnethyLocalMCPBundle(destination)
}

function git(...argv) {
  const p = spawnSync("git", argv, { encoding: "utf8", timeout: 240000, maxBuffer: 10_000_000 })
  if (p.error || p.status !== 0) throw new Error(p.error?.message || p.stderr?.trim() || "git failed")
}
async function* traverse(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const f = join(directory, entry.name)
    if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") yield* traverse(f)
    else if (entry.isFile()) yield f // no symlinks
  }
}
const exists = async (path) => { try { await lstat(path); return true } catch (e) { if (e.code === "ENOENT") return false; throw e } }
const slug = (value) => {
  const clean = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const name = clean || "component"
  if (name.length <= 64) return name
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 8)
  return name.slice(0, 55).replace(/-+$/g, "") + "-" + digest
}
const inside = (root, file) => { const p = relative(root, file); return p && p !== ".." && !p.startsWith(".." + sep) && !p.startsWith(sep) }
const toolkit = { Read: "read", Write: "write", Edit: "edit", Bash: "bash", Glob: "glob", Grep: "grep", WebFetch: "webfetch", WebSearch: "websearch", Task: "task", NotebookEdit: "edit" }
function convertMarkdown(contents, kind, name) {
  if (!contents.startsWith("---\n")) return { body: "---\nname: " + name + "\ndescription: Imported OnethyCode " + kind + " component\n---\n\n" + contents, warning: "Synthesized missing YAML frontmatter" }
  const end = contents.indexOf("\n---\n", 4)
  if (end < 0) return { body: "---\nname: " + name + "\ndescription: Imported OnethyCode " + kind + " component\n---\n\n" + contents, warning: "Synthesized invalid YAML frontmatter" }
  const header = contents.slice(4, end)
  const body = contents.slice(end + 5)
  // Do not use a YAML parser on untrusted source. Modify only the known tools field.
  const line = header.match(/^tools:\s*(.+)$/m)
  let updated = header
  let warning
  if (line) {
    let unknown = []
    const converted = line[1].split(",").map(x => x.trim()).filter(Boolean).map(x => {
      const val = toolkit[x]
      if (!val) unknown.push(x)
      return val
    }).filter(Boolean)
    updated = header.replace(/^tools:.*$/m, "tools:\n" + [...new Set(converted)].map(x => "  " + x + ": true").join("\n"))
    if (unknown.length) warning = "Unknown tool names: " + unknown.join(", ")
  }
  if (kind === "skills") updated = /^name:\s*.*$/m.test(updated) ? updated.replace(/^name:\s*.*$/m, "name: " + name) : "name: " + name + "\n" + updated
  else if (!/^name:\s*/m.test(updated)) updated = "name: " + name + "\n" + updated
  if (!/^description:\s*/m.test(updated)) {
    updated = 'description: "Imported OnethyCode ' + kind + ' component"\n' + updated
  }
  if (/\b(?:mcp__|context-manager|claude -p|Claude Code CLI)\b/i.test(body))
    warning = [warning, "Runtime-specific references may require manual changes"].filter(Boolean).join("; ")
  return { body: "---\n" + updated + "\n---\n" + body, warning }
}
async function safeAncestors(base, out) {
  // Imported content must never follow a preexisting symlink outside the native config.
  const chain = [destination, base]
  const parts = relative(base, dirname(out)).split(sep).filter(Boolean)
  for (const part of parts) chain.push(join(chain.at(-1), part))
  for (const candidate of chain) {
    try {
      const info = await lstat(candidate)
      if (info.isSymbolicLink() || !info.isDirectory()) return false
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }
  return true
}
async function record(type, name, sourceFile, out, convert, prepared) {
  const base = join(destination, type)
  if (!inside(base, out) || !(await safeAncestors(base, out))) { report.rejected++; return }
  if (await exists(out)) { report.existing++; return }
  const input = convert ? await readFile(sourceFile, "utf8") : undefined
  const result = prepared !== undefined ? { body: prepared } : convert ? (type === "agents" ? convertOnethyCodeAgent(input, name) : type === "commands" ? convertOnethyCodeCommand(input, name) : convertMarkdown(input, type, name)) : undefined
  if (result?.warning) {
    report.components[type].warnings.push({ name, warning: result.warning })
  }
  report.ready++
  if (!install || verify) return
  await mkdir(dirname(out), { recursive: true })
  try {
    if (convert || prepared !== undefined) await writeFile(out, result.body, { flag: "wx" })
    else await copyFile(sourceFile, out, 1)
    report.installed++
  } catch (e) {
    if (e.code === "EEXIST") report.existing++
    else throw e
  }
}
try {
  const remoteKinds = kinds.filter(type => !["mcps", "plugins"].includes(type))
  if (!sourceDir && remoteKinds.length) {
    git("clone", "--depth", "1", "--filter=blob:none", "--sparse", CATALOG, source)
    git("-C", source, "sparse-checkout", "set", ...remoteKinds.map(t => "cli-tool/components/" + t))
  }
  for (const type of kinds) {
    const root = join(source, "cli-tool", "components", type)
    report.components[type] = { files: 0, warnings: [] }
    if (type === "mcps") {
      const output = join(destination, "mcp", "onethy", "local-tools.json")
      report.components[type].files = 1
      await record("mcp", "local-tools", source, output, false, curatedLocalMCPs())
      continue
    }
    if (type === "plugins") {
      const plugins = curatedNativePlugins()
      for (const plugin of plugins) {
        report.components[type].files++
        const output = join(destination, "plugins", "onethy", plugin.file)
        await record("plugins", plugin.id, source, output, false, JSON.stringify(plugin, null, 2) + "\n")
      }
      continue
    }
    if (!(await exists(root))) { report.components[type].missing = true; continue }
    if (type === "hooks") {
      for await (const file of traverse(root)) {
        const ext = extname(file).toLowerCase()
        if (![".py", ".sh", ".js", ".ts", ".json", ".md"].includes(ext)) continue
        const rel = relative(root, file).replaceAll(sep, "/")
        const converted = convertOnethyCodeHook(rel, await readFile(file, "utf8"))
        const dest = join(destination, "hooks", "onethy", converted.id + ".json")
        report.components[type].files++
        await record("hooks", converted.id, file, dest, false, converted.file)
        if (!converted.supported) report.pending++
      }
      continue
    }
    if (type === "mods") {
      for (const category of await readdir(root, { withFileTypes: true })) {
        if (!category.isDirectory()) continue
        const categoryRoot = join(root, category.name)
        for (const folder of await readdir(categoryRoot, { withFileTypes: true })) {
          if (!folder.isDirectory()) continue
          const dir = join(categoryRoot, folder.name)
          const manifestFile = join(dir, ".claude-plugin", "plugin.json")
          const readmeFile = join(dir, "README.md")
          const manifest = await readFile(manifestFile, "utf8").catch(e => e.code === "ENOENT" ? "" : Promise.reject(e))
          const readme = await readFile(readmeFile, "utf8").catch(e => e.code === "ENOENT" ? "" : Promise.reject(e))
          if (!manifest && !readme) continue
          const id = category.name + "/" + folder.name
          if (/tmpl|marketplace|catalog/i.test(id)) { report.pending++; continue }
          const converted = convertOnethyCodeMod(id, manifest, readme)
          const dest = join(destination, "mods", "onethy", converted.id + ".json")
          report.components[type].files++
          await record("mods", converted.id, manifest ? manifestFile : readmeFile, dest, false, converted.file)
          if (!converted.supported) report.pending++
        }
      }
      continue
    }
    // Only file-based customizations are installed automatically. Settings
    // and unrelated plugins remain inventoried because they may conflict.
    if (!["skills", "agents", "commands"].includes(type)) {
      for await (const file of traverse(root)) report.components[type].files++
      report.pending += report.components[type].files
      continue
    }
    if (type === "skills") {
      // Flatten category/name into a stable native name; include all skill assets.
      const categories = await readdir(root, { withFileTypes: true })
      for (const category of categories.filter(x => x.isDirectory())) {
        const folders = await readdir(join(root, category.name), { withFileTypes: true })
        for (const folder of folders.filter(x => x.isDirectory())) {
          const skillDir = join(root, category.name, folder.name)
          if (!(await exists(join(skillDir, "SKILL.md")))) continue
          const name = slug(category.name + "-" + folder.name)
          for await (const file of traverse(skillDir)) {
            const rel = relative(skillDir, file)
            const out = join(destination, "skills", name, rel)
            report.components[type].files++
            await record(type, name, file, out, basename(file) === "SKILL.md")
          }
        }
      }
      continue
    }
    for await (const file of traverse(root)) {
      if (!["agents", "commands"].includes(type) || extname(file).toLowerCase() !== ".md") continue
      const name = slug(relative(root, file).slice(0, -3).split(sep).join("-"))
      const out = join(destination, type, name + ".md")
      report.components[type].files++
      await record(type, name, file, out, true)
    }
  }
  return report
} catch (e) {
  throw e
} finally {
  if (staging) await rm(staging, { recursive: true, force: true })
}

}
