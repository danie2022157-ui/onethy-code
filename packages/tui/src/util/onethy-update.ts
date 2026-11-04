import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

type GitResult = { stdout: string; stderr: string; code: number }
export type GitRunner = (args: string[], cwd: string) => Promise<GitResult>

const OFFICIAL_ORIGIN = /(?:^|[/:@])github\.com[:/]danie2022157-ui\/onethy-code(?:\.git)?\/?$/i

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
  if (origin.code !== 0 || !OFFICIAL_ORIGIN.test(origin.stdout)) return
  const local = await git(["rev-parse", "HEAD"], root)
  if (local.code !== 0 || !/^[a-f0-9]{40}$/i.test(local.stdout)) return
  const remote = await git(["ls-remote", "origin", "refs/heads/main"], root)
  if (remote.code !== 0) return
  const found = /^([a-f0-9]{40})\s+refs\/heads\/main$/im.exec(remote.stdout)?.[1]
  if (!found || found === local.stdout) return
  return { current: local.stdout.slice(0, 7), available: found.slice(0, 7) }
}
