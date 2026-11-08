#!/usr/bin/env node
/**
 * Conservative, read-only OnethyCode repository auditor.
 *
 * "Outside the CLI dependency graph" does NOT mean unused. Other packages are
 * independent executables or loaded by plugins, native hosts and build tools.
 * Never delete files based on this report without tracing those entrypoints.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = fileURLToPath(new URL("../", import.meta.url))
const args = new Set(process.argv.slice(2))
const stage = execFileSync("git", ["ls-files", "--stage", "-z"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
})
const tracked = stage.split("\0").flatMap((record) => {
  if (!record) return []
  const match = /^\d{6} ([a-f0-9]{40}) \d+\t(.+)$/.exec(record)
  if (!match) return []
  const name = match[2]
  const filename = path.join(root, name)
  if (!existsSync(filename)) return []
  const size = statSync(filename).size
  return [{ path: name.replaceAll("\\", "/"), sha: match[1], bytes: size }]
})

const groups = new Map()
for (const item of tracked) {
  const group = item.path.split("/")[0]
  const stats = groups.get(group) ?? { files: 0, bytes: 0 }
  stats.files++
  stats.bytes += item.bytes
  groups.set(group, stats)
}

const packageFile = /^(?:packages\/[^/]+|packages\/plugins\/[^/]+|packages\/console\/[^/]+|packages\/stats\/[^/]+|services\/[^/]+)\/package\.json$/
const packages = tracked.filter((item) => packageFile.test(item.path)).flatMap((file) => {
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, file.path), "utf8"))
    if (!manifest.name) return []
    return [{
      name: manifest.name,
      path: file.path,
      runtimeDeps: Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }),
    }]
  } catch {
    return []
  }
})
const byName = new Map(packages.map((item) => [item.name, item]))
if (!byName.has("@opencode/cli")) throw new Error("@opencode/cli package.json not found in tracked workspace")

// Only declared runtime dependencies. Dynamic plugin discovery and independent
// Web/Desktop/Console entrypoints are intentionally not inferred here.
const cliRuntimeNames = new Set(["@opencode/cli"])
const next = ["@opencode/cli"]
while (next.length) {
  const parent = byName.get(next.shift())
  if (!parent) continue
  for (const dependency of parent.runtimeDeps) {
    if (!byName.has(dependency) || cliRuntimeNames.has(dependency)) continue
    cliRuntimeNames.add(dependency)
    next.push(dependency)
  }
}

const generated = tracked.filter((item) =>
  /(^|\/)(?:\.wrangler|\.turbo)(\/|$)/.test(item.path),
)
const largeFiles = tracked
  .filter((item) => item.bytes >= 1024 * 1024)
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 20)
  .map(({ path, bytes }) => ({ path, bytes }))
const byHash = new Map()
for (const item of tracked) {
  if (item.bytes < 512 * 1024) continue
  const list = byHash.get(item.sha) ?? []
  list.push({ path: item.path, bytes: item.bytes })
  byHash.set(item.sha, list)
}
const duplicateWorkingTreeAssets = [...byHash.values()]
  .filter((item) => item.length > 1)
  .sort((a, b) => b[0].bytes * (b.length - 1) - a[0].bytes * (a.length - 1))
  .slice(0, 10)

const report = {
  scope: "tracked files only (not node_modules, user data, or runtime telemetry)",
  counts: {
    trackedFiles: tracked.length,
    trackedWorkingTreeBytes: tracked.reduce((sum, item) => sum + item.bytes, 0),
    workspacePackages: packages.length,
    cliDeclaredRuntimePackages: cliRuntimeNames.size,
  },
  directories: [...groups.entries()].map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.bytes - a.bytes),
  outsideCliDeclaredRuntimeGraph: packages
    .filter((item) => !cliRuntimeNames.has(item.name))
    .map(({ name, path }) => ({ name, path }))
    .sort((a, b) => a.path.localeCompare(b.path)),
  generatedTracked: generated.map(({ path, bytes }) => ({ path, bytes })),
  largestTrackedFiles: largeFiles,
  duplicateWorkingTreeAssets,
  independentReferenceDirectories: ["prototype/", "salesforce/"]
    .filter((prefix) => tracked.some((item) => item.path.startsWith(prefix))),
  limitations: [
    "Static package.json runtime graph cannot prove a module is dead code.",
    "Dynamic imports, native bindings, plugins, tests, deployment and web entrypoints remain valid owners.",
    "Large assets may be required by the Console/web application; duplicate Git blobs are deduplicated in object storage.",
    "No file or package is removed by this audit command.",
  ],
}
if (args.has("--json")) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n")
} else {
  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + " MiB"
  console.log("OnethyCode repository audit (tracked Git files)")
  console.log("Files:", report.counts.trackedFiles, "Size:", mb(report.counts.trackedWorkingTreeBytes))
  console.log("Workspace packages:", packages.length, "CLI declared runtime closure:", cliRuntimeNames.size)
  console.log("Outside CLI runtime declarations (not confirmed unused):")
  for (const item of report.outsideCliDeclaredRuntimeGraph) console.log("  -", item.path)
  console.log("Tracked generated caches:", generated.length)
  for (const item of generated) console.log("  !", item.path)
  console.log("Largest files:")
  for (const item of largeFiles.slice(0, 8)) console.log("  -", mb(item.bytes), item.path)
  console.log("Read docs/onethy-optimization-audit.md before deleting source files.")
}
if (args.has("--check-generated") && generated.length) {
  console.error("Tracked generated caches must be removed from Git and ignored.")
  process.exitCode = 1
}
