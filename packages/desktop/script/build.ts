#!/usr/bin/env bun
import { $ } from "bun"
import { exists } from "node:fs/promises"
import path from "node:path"
import { copyBuiltCliToResources, downloadCliToResources, getCurrentCli, resolveChannel } from "./utils"

// Prepares resources/ (icons, metainfo, the bundled CLI) for OPENCODE_CHANNEL and builds the app into out/.
// The CLI comes from ../cli/dist when it holds the target; otherwise dev downloads the published dev CLI,
// beta the beta CLI, and prod fails.
const dir = path.resolve(import.meta.dir, "..")

const cli = path.resolve(dir, "../cli/dist")

const channel = resolveChannel()

process.chdir(dir)

await $`bun ./script/copy-icons.ts ${channel}`

await $`bun ./script/copy-metainfo.ts ${channel}`

const targetDir = getCurrentCli().package.replace("@opencode/", "")
const hasBuiltCli = async () =>
  (await exists(path.join(cli, targetDir))) ||
  (await exists(path.join(cli, targetDir.replace(/-baseline$/, ""))))

let built = await hasBuiltCli()

// Production must bundle the CLI built from this checkout. Build it automatically when missing.
if (channel === "prod" && !built) {
  console.log(`CLI build not found at ${cli}; building the current target first`)
  await $`bun run --cwd ../cli build --single`
  built = await hasBuiltCli()
}

if (channel === "prod" && !built)
  throw new Error(`Production desktop build requires the CLI artifact for ${targetDir} in ${cli}; the CLI build completed without producing it`)

if (built) await copyBuiltCliToResources(cli)

if (!built) await downloadCliToResources(channel === "beta" ? "beta" : undefined)

await $`bunx electron-vite build`
