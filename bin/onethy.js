#!/usr/bin/env node

/**
 * OnethyCode CLI Executable
 * Executa o terminal e TUI NATIVOS do OnethyCode com suporte multi-agente,
 * Onethy Fusion, Self-Healing e Memory Bank.
 */

import { execFileSync, spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { findBun, makeOmniEnvironment } from "./omni-runtime.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, "..")

const bunBin = findBun(process.env)
if (!bunBin) {
  console.error("[OnethyCode Error] Bun was not found. Install Bun or set BUN_BIN to an absolute Bun executable path.")
  process.exit(1)
}

const cliDir = path.join(rootDir, "packages", "cli")
let activeCommit
try {
  activeCommit = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
    cwd: rootDir,
    encoding: "utf8",
    timeout: 2000,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim()
} catch {
  // Released or source-archive installs may not contain a Git checkout.
}

const child = spawn(bunBin, ["run", "--cwd", cliDir, "src/index.ts", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...makeOmniEnvironment(process.env, bunBin),
    ONETHY_ACTIVE: "1",
    ONETHY_INSTALL_ROOT: rootDir,
    ...(activeCommit ? { ONETHY_COMMIT: activeCommit } : {}),
    OPENCODE_CLI_NAME: "onethy",
    OPENCODE_THEME: process.env.OPENCODE_THEME || "onethy",
  },
  cwd: process.cwd(),
})

child.on("exit", (code) => {
  process.exit(code ?? 0)
})

child.on("error", (err) => {
  console.error("[OnethyCode Error]", err.message)
  process.exit(1)
})

