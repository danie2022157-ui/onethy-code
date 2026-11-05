// AITmpl -> OnethyCode native file-based personalization importer.
// Safe by default: dry-run, no script execution, no overwrites, no credentials.
import { mkdtemp, readdir, mkdir, copyFile, lstat, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir, homedir } from "node:os"
import { join, relative, resolve, dirname, basename, extname, sep } from "node:path"
import { spawnSync } from "node:child_process"


const CATALOG = "https://github.com/davila7/claude-code-templates.git"
export const types = ["skills", "agents", "commands", "settings", "hooks", "mcps", "plugins", "mods", "loops"]
export async function syncAITmpl(options = {}) {
const install = options.install === true
const verify = options.verify === true
const chosen = options.type || "all"
const sourceDir = options.sourceDir
if (chosen !== "all" && !types.includes(chosen)) throw new Error("Unknown --type: " + chosen)
const kinds = chosen === "all" ? types : [chosen]
const destination = options.global ? join(homedir(), ".config", "opencode") : resolve(options.cwd || process.cwd(), ".opencode")
const report = { mode: verify ? "verify" : install ? "install" : "preview", target: destination, ready: 0, installed: 0, existing: 0, rejected: 0, pending: 0, errors: [], components: {} }
const staging = sourceDir ? undefined : await mkdtemp(join(tmpdir(), "onethy-aitmpl-"))
const source = sourceDir ? resolve(sourceDir) : join(staging, "catalog")

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
const slug = (s) => s.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase()
const inside = (root, file) => { const p = relative(root, file); return p && p !== ".." && !p.startsWith(".." + sep) && !p.startsWith(sep) }
const toolkit = { Read: "read", Write: "write", Edit: "edit", Bash: "bash", Glob: "glob", Grep: "grep", WebFetch: "webfetch", WebSearch: "websearch", Task: "task", NotebookEdit: "edit" }
function convertMarkdown(contents, kind, name) {
  if (!contents.startsWith("---\n")) return { body: contents, warning: "Missing YAML frontmatter" }
  const end = contents.indexOf("\n---\n", 4)
  if (end < 0) return { body: contents, warning: "Invalid YAML frontmatter" }
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
  if (!/^description:\s*/m.test(updated) && kind !== "skills") {
    updated = 'description: "Imported AITmpl ' + kind + ' component"\n' + updated
  }
  if (/\b(?:mcp__|context-manager|claude -p|Claude Code CLI)\b/i.test(body))
    warning = [warning, "Runtime-specific references may require manual changes"].filter(Boolean).join("; ")
  return { body: "---\n" + updated + "\n---\n" + body, warning }
}
async function record(type, name, sourceFile, out, convert) {
  const base = join(destination, type)
  if (!inside(base, out)) { report.rejected++; return }
  if (await exists(out)) { report.existing++; return }
  const input = convert ? await readFile(sourceFile, "utf8") : undefined
  const result = convert ? convertMarkdown(input, type, name) : undefined
  if (result?.warning) {
    report.components[type].warnings.push({ name, warning: result.warning })
  }
  report.ready++
  if (!install || verify) return
  await mkdir(dirname(out), { recursive: true })
  try {
    if (convert) await writeFile(out, result.body, { flag: "wx" })
    else await copyFile(sourceFile, out, 1)
    report.installed++
  } catch (e) {
    if (e.code === "EEXIST") report.existing++
    else throw e
  }
}
try {
  if (!sourceDir) {
    git("clone", "--depth", "1", "--filter=blob:none", "--sparse", CATALOG, source)
    git("-C", source, "sparse-checkout", "set", ...kinds.map(t => "cli-tool/components/" + (t === "mcps" ? "mcps" : t)))
  }
  for (const type of kinds) {
    const root = join(source, "cli-tool", "components", type)
    report.components[type] = { files: 0, warnings: [] }
    if (!(await exists(root))) { report.components[type].missing = true; continue }
    // Dangerous or Claude-runtime specific categories need explicit adapters; inventory only.
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
      if (extname(file).toLowerCase() !== ".md") continue
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
