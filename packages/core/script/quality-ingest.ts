/** CLI-only ingestion of independently verified benchmark outcomes. Not exposed as an agent tool. */
import fs from "node:fs/promises"
import { importVerifiedOutcomes, type VerifiedTrial } from "../src/model-outcomes.js"

const [workspace, report] = process.argv.slice(2)
if (!workspace || !report) {
  console.error("Usage: bun --cwd packages/core script/quality-ingest.ts /absolute/workspace /absolute/verified-trials.json")
  process.exit(2)
}
try {
  const stat = await fs.lstat(report)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    throw new Error("Report must be a regular JSON file of at most 1 MiB.")
  const source: unknown = JSON.parse(await fs.readFile(report, "utf8"))
  if (!Array.isArray(source) || source.length < 1 || source.length > 1000)
    throw new Error("Expected an array of 1 to 1000 verified benchmark trials.")
  const result = await importVerifiedOutcomes(workspace, source as VerifiedTrial[])
  console.log(JSON.stringify({ ...result, workspace, restartRequired: true }))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
