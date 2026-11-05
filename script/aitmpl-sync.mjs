#!/usr/bin/env node
/**
 * Optional standalone entry point for the same importer used by OnethyCode CLI.
 * Preview: node script/aitmpl-sync.mjs
 * Install: node script/aitmpl-sync.mjs --install --global
 */
import { syncAITmpl, types } from "../packages/cli/src/services/aitmpl-native.mjs"

const args = process.argv.slice(2)
const option = (key) => {
  const i = args.indexOf(key)
  return i === -1 ? undefined : args[i + 1]
}
const type = option("--type") || "all"
if (type !== "all" && !types.includes(type)) {
  console.error("Invalid --type:", type)
  process.exit(2)
}
try {
  const result = await syncAITmpl({
    install: args.includes("--install"),
    verify: args.includes("--verify"),
    global: args.includes("--global"),
    type,
    sourceDir: option("--source-dir"),
  })
  console.log(JSON.stringify(result, null, 2))
  if (result.pending) console.log("NOTE: External-runtime components are inventoried only; not connected or activated.")
} catch (e) {
  console.error("AITmpl import failed:", e.message)
  process.exitCode = 1
}
