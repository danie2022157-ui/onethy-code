#!/usr/bin/env node

/**
 * OnethyCode CLI Executable
 * Executa o terminal e TUI NATIVOS do OnethyCode com suporte multi-agente,
 * Onethy Fusion, Self-Healing e Memory Bank.
 */

import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
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

function resolveGitCommit(dir) {
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
    // Worktree .git files or unusual layouts fall back to git rev-parse below.
  }
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    // Released or source-archive installs may not contain a Git checkout.
    return undefined
  }
}

function resolveBundledEntry(dir, commit) {
  if (process.env.ONETHY_NO_BUNDLE === "1") return undefined
  const bundleDir = path.join(dir, ".cache", "onethy-cli")
  const entry = path.join(bundleDir, "index.js")
  const stampFile = path.join(bundleDir, "stamp.json")
  try {
    if (!fs.existsSync(entry) || !fs.existsSync(stampFile)) return undefined
    const stamp = JSON.parse(fs.readFileSync(stampFile, "utf8"))
    if (commit && stamp.commit !== commit) return undefined
    return entry
  } catch {
    return undefined
  }
}

const cliDir = path.join(rootDir, "packages", "cli")
const activeCommit = resolveGitCommit(rootDir)
const bundledEntry = resolveBundledEntry(cliDir, activeCommit)
const bunArgs = bundledEntry
  ? [bundledEntry, ...process.argv.slice(2)]
  : ["run", "--cwd", cliDir, "src/index.ts", ...process.argv.slice(2)]

const child = spawn(bunBin, bunArgs, {
  stdio: "inherit",
  env: {
    ...makeOmniEnvironment(process.env, bunBin),
    ONETHY_ACTIVE: "1",
    ONETHY_INSTALL_ROOT: rootDir,
    ONETHY_ANTIGRAVITY_AUTH: process.env.ONETHY_ANTIGRAVITY_AUTH ?? "1",
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

