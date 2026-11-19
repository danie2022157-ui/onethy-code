#!/usr/bin/env bun

import fs from "node:fs"
import { rm } from "node:fs/promises"
import path from "node:path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import type { BunPlugin } from "bun"
import { discoverPluginRuntimeSpecifiers, pluginRuntimeLoaderCode } from "@opencode/plugin/runtime-modules"
import { bundledModelsSnapshot, modelsSnapshotPlugin } from "../../core/script/models-snapshot"

const cliDir = path.resolve(import.meta.dirname, "..")
const rootDir = path.resolve(cliDir, "..", "..")
const outdir = path.join(cliDir, ".cache", "onethy-cli")

function resolveGitCommit(dir: string) {
  try {
    const gitDir = path.join(dir, ".git")
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim()
    if (/^[a-f0-9]{40}$/i.test(head)) return head.slice(0, 7)
    if (head.startsWith("ref: ")) {
      const ref = head.slice(5).trim()
      const refPath = path.join(gitDir, ...ref.split("/"))
      if (fs.existsSync(refPath)) {
        const hash = fs.readFileSync(refPath, "utf8").trim()
        if (/^[a-f0-9]{40}$/i.test(hash)) return hash.slice(0, 7)
      }
      const packedPath = path.join(gitDir, "packed-refs")
      if (fs.existsSync(packedPath)) {
        const line = fs
          .readFileSync(packedPath, "utf8")
          .split(/\r?\n/)
          .find((entry) => entry && !entry.startsWith("#") && !entry.startsWith("^") && entry.endsWith(` ${ref}`))
        if (line && /^[a-f0-9]{40}\b/i.test(line)) return line.slice(0, 7)
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

process.chdir(cliDir)
const tempOutdir = `${outdir}.${process.pid}.${Date.now()}.tmp`
await rm(tempOutdir, { recursive: true, force: true })

const solidPlugin = createSolidTransformPlugin()
const modelsSnapshot = modelsSnapshotPlugin(await bundledModelsSnapshot())
const appAssetsPlugin: BunPlugin = {
  name: "opencode-app-assets",
  setup(build) {
    build.onResolve({ filter: /^virtual:opencode-app-assets$/ }, () => ({
      path: "opencode-app-assets",
      namespace: "opencode",
    }))
    build.onLoad({ filter: /^opencode-app-assets$/, namespace: "opencode" }, () => ({
      loader: "js",
      contents: "export default () => new Uint8Array()",
    }))
  },
}

const pluginRuntimeEntries = discoverPluginRuntimeSpecifiers()
const pluginRuntimeModulesSource = [
  "export const resolveHostPackageRoots = () => []",
  "const modules = {",
  ...[...pluginRuntimeEntries.keys()].map(
    (specifier) => `  ${JSON.stringify(specifier)}: ${pluginRuntimeLoaderCode(specifier, pluginRuntimeEntries)},`,
  ),
  "}",
  "export const loadRuntimeModules = () => modules",
].join("\n")

const pluginRuntimePlugin: BunPlugin = {
  name: "opencode-plugin-runtime",
  setup(build) {
    build.onLoad({ filter: /plugin[/\\]src[/\\]runtime-modules\.ts$/ }, () => ({
      contents: pluginRuntimeModulesSource,
      loader: "ts",
    }))
    build.onLoad({ filter: /[/\\]internal[/\\]httpApi(?:Scalar|Swagger)\.js$/ }, () => ({
      contents:
        'export const css = ""; export const javascript = \'document.body.textContent = "Scalar/Swagger UI assets are not bundled in OpenCode"\'',
      loader: "js",
    }))
  },
}

const result = await Bun.build({
  entrypoints: ["./src/index.ts", "./src/photon-worker.ts"],
  outdir: tempOutdir,
  tsconfig: "./tsconfig.json",
  target: "bun",
  format: "esm",
  splitting: true,
  plugins: [appAssetsPlugin, solidPlugin, pluginRuntimePlugin, modelsSnapshot],
  external: ["node-gyp", "@opentui/core*", "@opencode/pty*", "@parcel/watcher*"],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  await rm(tempOutdir, { recursive: true, force: true }).catch(() => {})
  process.exit(1)
}

const commit = resolveGitCommit(rootDir) ?? "local"
await Bun.write(
  path.join(tempOutdir, "stamp.json"),
  JSON.stringify({ commit, builtAt: Date.now() }, null, 2),
)

// Atomic replacement: swap new build into place to prevent ENOENT on concurrently loaded chunks
await rm(outdir, { recursive: true, force: true }).catch(() => {})
try {
  fs.renameSync(tempOutdir, outdir)
} catch {
  fs.cpSync(tempOutdir, outdir, { recursive: true, force: true })
  await rm(tempOutdir, { recursive: true, force: true }).catch(() => {})
}

