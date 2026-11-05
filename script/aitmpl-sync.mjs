#!/usr/bin/env node
/**
 * Synchronize file-based AITmpl customizations with the native OnethyCode config.
 * Requires Git. Never executes catalog components or overwrites user files.
 *
 * node script/aitmpl-sync.mjs                 # preview
 * node script/aitmpl-sync.mjs --install       # install compatible components
 * node script/aitmpl-sync.mjs --install --type skills
 * node script/aitmpl-sync.mjs --install --global
 */
import { mkdtemp, readdir, mkdir, copyFile, lstat, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir, homedir } from "node:os"
import { join, relative, resolve, dirname, sep } from "node:path"
import { spawnSync } from "node:child_process"

const SOURCE = "https://github.com/davila7/claude-code-templates.git"
const TYPES = ["skills", "agents", "commands"]
const args = process.argv.slice(2)
const install = args.includes("--install")
const global = args.includes("--global")
const selected = args.includes("--type") ? args[args.indexOf("--type") + 1] : "all"
if (selected !== "all" && !TYPES.includes(selected)) {
  console.error("Invalid --type. Use skills, agents, commands or all.")
  process.exit(2)
}
const types = selected === "all" ? TYPES : [selected]
const target = global ? join(homedir(), ".config", "opencode") : resolve(".opencode")
const temporary = await mkdtemp(join(tmpdir(), "onethy-aitmpl-"))
const source = join(temporary, "catalog")
const report = { source: SOURCE, target, mode: install ? "install" : "preview", scanned: 0, copied: 0, existing: 0, ignored: 0, errors: [] }

function git(...argv) {
  const result = spawnSync("git", argv, { encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024 * 8 })
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr?.trim() ?? "git failed")
}
async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    // Skip symlinks and special entries from downloaded content.
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}
function validPath(root, file) {
  const r = relative(root, file)
  return r && r !== ".." && !r.startsWith(".." + sep) && !resolve(file).includes("\0")
}
try {
  git("clone", "--depth", "1", "--filter=blob:none", "--sparse", SOURCE, source)
  git("-C", source, "sparse-checkout", "set", ...types.map((t) => "cli-tool/components/" + t))
  for (const type of types) {
    const root = join(source, "cli-tool", "components", type)
    let found = 0
    try { await lstat(root) } catch { report.errors.push("Missing source directory: " + type); continue }
    for await (const file of walk(root)) {
      if (!validPath(root, file)) continue
      const rel = relative(root, file)
      const extension = file.split(".").pop()?.toLowerCase()
      // Agents and commands in native OpenCode format are Markdown definitions.
      if (type !== "skills" && extension !== "md") { report.ignored++; continue }
      if (type === "skills" && /(^|[\\/])(?:node_modules|\.git)([\\/]|$)/.test(rel)) { report.ignored++; continue }
      const dest = join(target, type, rel)
      if (!validPath(join(target, type), dest)) { report.ignored++; continue }
      report.scanned++; found++
      try { await lstat(dest); report.existing++; continue } catch (e) { if (e.code !== "ENOENT") throw e }
      if (install) {
        await mkdir(dirname(dest), { recursive: true })
        await copyFile(file, dest, 1 /* COPYFILE_EXCL */)
        report.copied++
      }
    }
    console.log(type + ": " + found + " compatible files examined")
  }
  console.log(JSON.stringify(report, null, 2))
  console.log("Note: MCPs, hooks, settings, plugins, mods and loops need Onethy-specific adapters; none are executed or activated by this importer.")
} catch (error) {
  console.error("AITmpl import failed:", error.message)
  process.exitCode = 1
} finally {
  await rm(temporary, { recursive: true, force: true })
}
