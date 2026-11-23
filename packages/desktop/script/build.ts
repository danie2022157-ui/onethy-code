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
let built =
  (await exists(path.join(cli, targetDir))) ||
  (await exists(path.join(cli, targetDir.replace(/-baseline$/, ""))))

if (channel === "prod" && !built) {
  console.log(`[desktop] Matching production CLI not found in ${cli}; building it for the current target...`)
  await $`bun run --cwd ../cli build --single`
  built =
    (await exists(path.join(cli, targetDir))) ||
    (await exists(path.join(cli, targetDir.replace(/-baseline$/, ""))))
  if (!built) throw new Error(`CLI build completed but the expected artifact is still missing: ${path.join(cli, targetDir)}`)
}

if (built) await copyBuiltCliToResources(cli)
else await downloadCliToResources(channel === "beta" ? "beta" : undefined)

await $`bunx electron-vite build`
