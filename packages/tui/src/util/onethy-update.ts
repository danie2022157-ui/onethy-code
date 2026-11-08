import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

type GitResult = { stdout: string; stderr: string; code: number }
export type GitRunner = (args: string[], cwd: string) => Promise<GitResult>

const OFFICIAL_ORIGINS = new Set([
  "https://github.com/danie2022157-ui/onethy-code",
  "git@github.com:danie2022157-ui/onethy-code",
  "ssh://git@github.com/danie2022157-ui/onethy-code",
])

export function isOfficialOnethyOrigin(value: string): boolean {
  const trimmed = value.trim().replace(/\/$/, "")
  const normalized = trimmed.endsWith(".git") ? trimmed.slice(0, -4) : trimmed
  return OFFICIAL_ORIGINS.has(normalized)
}
const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd, encoding: "utf8", timeout: 12000, windowsHide: true }, (error, stdout, stderr) =>
      resolve({
        stdout: (stdout || "").trim(),
        stderr: (stderr || "").trim(),
        code: error ? 1 : 0,
      }),
    )
  })

/** Locate the installed checkout, not the user's current coding project. */
export function findOnethyRoot(): string | undefined {
  const installed = process.env.ONETHY_INSTALL_ROOT
  if (installed && fs.existsSync(path.join(installed, ".git")) && fs.existsSync(path.join(installed, "packages", "tui")))
    return installed
  try {
    let directory = path.dirname(fileURLToPath(import.meta.url))
    for (let i = 0; i < 12; i++) {
      if (fs.existsSync(path.join(directory, ".git")) && fs.existsSync(path.join(directory, "packages", "tui")))
        return directory
      const parent = path.dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  } catch {}
  return undefined
}

export type OnethyUpdate = Readonly<{ current: string; available: string }>

/** A non-mutating GitHub check. No fetch, checkout, pull, stash or installation. */
export async function checkOnethyUpdate(input: {
  root?: string
  git?: GitRunner
} = {}): Promise<OnethyUpdate | undefined> {
  const root = input.root ?? findOnethyRoot()
  if (!root) return
  const git = input.git ?? runGit
  const branch = await git(["branch", "--show-current"], root)
  if (branch.code !== 0 || branch.stdout !== "main") return
  const origin = await git(["remote", "get-url", "origin"], root)
  if (origin.code !== 0 || !isOfficialOnethyOrigin(origin.stdout)) return
  // Do not mistake an ahead/diverged local checkout for an available update.
  const ahead = await git(["rev-list", "--count", "origin/main..HEAD"], root)
  if (ahead.code !== 0 || !/^\d+$/.test(ahead.stdout) || Number(ahead.stdout) > 0) return
  const local = await git(["rev-parse", "HEAD"], root)
  if (local.code !== 0 || !/^[a-f0-9]{40}$/i.test(local.stdout)) return
  const remote = await git(["ls-remote", "origin", "refs/heads/main"], root)
  if (remote.code !== 0) return
  const found = /^([a-f0-9]{40})\s+refs\/heads\/main$/im.exec(remote.stdout)?.[1]
  if (!found || found === local.stdout) return
  return { current: local.stdout.slice(0, 7), available: found.slice(0, 7) }
}
