#!/usr/bin/env node

/**
 * OmniCode CLI Executable
 * Executa o terminal e TUI NATIVOS do OpenCode, 100% idêntico, com a marca e segurança OmniCode.
 */

import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { findBun, makeOmniEnvironment } from "./omni-runtime.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, "..")

const bunBin = findBun(process.env)
if (!bunBin) {
  console.error("[OmniCode Error] Bun was not found. Install Bun or set BUN_BIN to an absolute Bun executable path.")
  process.exit(1)
}

const cliDir = path.join(rootDir, "packages", "cli")

const child = spawn(bunBin, ["run", "--cwd", cliDir, "src/index.ts", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: makeOmniEnvironment(process.env, bunBin),
  cwd: process.cwd(),
})

child.on("exit", (code) => {
  process.exit(code ?? 0)
})

child.on("error", (err) => {
  console.error("[OmniCode Error]", err.message)
  process.exit(1)
})
