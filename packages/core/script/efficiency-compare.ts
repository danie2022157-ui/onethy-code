/** Usage: bun --cwd packages/core script/efficiency-compare.ts baseline.json candidate.json */
import fs from "node:fs/promises"
import { compareTrials, type Trial } from "../src/efficiency-benchmark.js"

const [baselinePath, candidatePath] = process.argv.slice(2)
if (!baselinePath || !candidatePath) {
  console.error("Usage: bun --cwd packages/core script/efficiency-compare.ts baseline.json candidate.json")
  process.exit(2)
}

async function trials(file: string): Promise<Trial[]> {
  const stat = await fs.stat(file)
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error("Benchmark input must be a JSON file under 2 MiB")
  const data: unknown = JSON.parse(await fs.readFile(file, "utf8"))
  if (!Array.isArray(data) || data.length === 0) throw new Error("Benchmark input must be an array of trial records")
  return data as Trial[]
}

try {
  const report = compareTrials(await trials(baselinePath), await trials(candidatePath))
  console.log(JSON.stringify(report, null, 2))
  if (!report.safeToRollOut) {
    console.error("QUALITY GATE FAILED: lower cost never compensates for a quality or latency regression.")
    process.exitCode = 1
  } else if (!report.targetMet) {
    console.error("Quality gate passed, but the 20% cost-reduction target was not reached.")
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 2
}
