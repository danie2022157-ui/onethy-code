import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { app, shell } from "electron"
import { Effect } from "effect"
import type { Platform } from "./machine"

const execFileAsync = promisify(execFile)

const GITHUB_OWNER = "danie2022157-ui"
const GITHUB_REPO = "onethy-code"

function isOfficialOrigin(origin: string): boolean {
  const allowed = [
    `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
    `git@github.com:${GITHUB_OWNER}/${GITHUB_REPO}`,
    `ssh://git@github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
  ]
  return allowed.includes(origin)
}

function walkParents(startDir: string): string[] {
  const dirs: string[] = []
  let current = path.resolve(startDir)
  for (let i = 0; i < 7; i++) {
    dirs.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return dirs
}

export function resolveOnethyRoot(): string | undefined {
  const candidates = [
    ...(process.env.ONETHY_INSTALL_ROOT ? [process.env.ONETHY_INSTALL_ROOT] : []),
    ...walkParents(app.getAppPath()),
    ...walkParents(path.dirname(process.execPath)),
  ]
  return candidates.find(
    (dir) => existsSync(path.join(dir, ".git")) && existsSync(path.join(dir, "packages", "tui")),
  )
}

function resolveBunBin(): string {
  if (process.env.BUN_BIN && existsSync(process.env.BUN_BIN)) return process.env.BUN_BIN
  const defaultBun = path.join(homedir(), ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun")
  if (existsSync(defaultBun)) return defaultBun
  return "bun"
}

async function runGit(root: string, args: string[], timeout = 30_000): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
    timeout,
    windowsHide: true,
  })
  return result.stdout.trim()
}

async function checkGitRepository(root: string, currentVersion: string) {
  const origin = await runGit(root, ["remote", "get-url", "origin"])
  const normalized = origin.endsWith(".git") ? origin.slice(0, -4) : origin.replace(/\/+$/, "")
  if (!isOfficialOrigin(normalized)) {
    throw new Error(`Origin Git inválido (${origin}). Esperado: ${GITHUB_OWNER}/${GITHUB_REPO}`)
  }

  await runGit(root, ["fetch", "origin", "main", "--quiet"], 20_000)
  const behindRaw = await runGit(root, ["rev-list", "--count", "HEAD..origin/main"])
  const behindCount = Number.parseInt(behindRaw, 10)
  if (!Number.isFinite(behindCount) || behindCount <= 0) return undefined

  const remoteCommit = await runGit(root, ["rev-parse", "--short=7", "origin/main"])
  const baseVersion = currentVersion.split(" ")[0] || currentVersion
  return {
    mode: "restart" as const,
    version: `${baseVersion} (${remoteCommit})`,
  }
}

async function checkGithubRelease(currentVersion: string) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": `OnethyCode-Desktop/${currentVersion}`,
  }
  const releaseRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    {
      headers,
      signal: AbortSignal.timeout(10_000),
    },
  )

  if (releaseRes.status === 404) {
    const commitRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits/main`,
      {
        headers,
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!commitRes.ok) {
      throw new Error(`GitHub API returned HTTP ${commitRes.status}`)
    }
    return undefined
  }

  if (!releaseRes.ok) {
    throw new Error(`GitHub Releases API returned HTTP ${releaseRes.status}`)
  }

  const data = (await releaseRes.json()) as {
    tag_name?: string
    html_url?: string
    assets?: Array<{ name?: string; browser_download_url?: string }>
  }
  const tagVersion = (data.tag_name ?? "").trim().replace(/^v/i, "")
  const cleanCurrent = currentVersion.split(" ")[0].trim().replace(/^v/i, "")
  if (!tagVersion || tagVersion === cleanCurrent) return undefined

  const ext = process.platform === "win32" ? ".exe" : process.platform === "darwin" ? ".dmg" : ".AppImage"
  const assetUrl = data.assets?.find(
    (asset) => typeof asset.name === "string" && asset.name.endsWith(ext) && asset.browser_download_url,
  )?.browser_download_url

  return {
    mode: "external" as const,
    version: tagVersion,
    url: assetUrl ?? data.html_url ?? `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
  }
}

export const make = Effect.fn("Updater.onethyPlatform")(function* (currentVersion: string) {
  const root = resolveOnethyRoot()
  yield* Effect.logInfo("OnethyCode GitHub updater configured", {
    repository: `${GITHUB_OWNER}/${GITHUB_REPO}`,
    root: root ?? "github-releases",
    currentVersion,
  })

  return {
    checkForUpdate: Effect.tryPromise({
      try: async () => {
        if (root) {
          const gitTarget = await checkGitRepository(root, currentVersion)
          if (gitTarget) return gitTarget
        }
        return await checkGithubRelease(currentVersion)
      },
      catch: (error) => error,
    }),
    stageUpdate: () =>
      Effect.tryPromise({
        try: async () => {
          if (!root) return
          const status = await runGit(root, ["status", "--porcelain"])
          if (status.length > 0) {
            throw new Error(
              "Existem alterações locais não commitadas no repositório OnethyCode. Faça commit ou stash antes de atualizar.",
            )
          }
          await runGit(root, ["pull", "--ff-only", "origin", "main"], 60_000)
          const bun = resolveBunBin()
          await execFileAsync(bun, ["install"], {
            cwd: root,
            timeout: 180_000,
            windowsHide: true,
          })
          const cacheScript = path.join(root, "packages", "cli", "script", "build-local-cache.ts")
          if (existsSync(cacheScript)) {
            await execFileAsync(bun, [cacheScript], {
              cwd: root,
              timeout: 120_000,
              windowsHide: true,
            })
          }
          const customScript = path.join(root, "packages", "cli", "src", "services", "onethy-customizations.mjs")
          if (existsSync(customScript)) {
            await execFileAsync("node", [customScript], {
              cwd: root,
              timeout: 60_000,
              windowsHide: true,
            }).catch(() => undefined)
          }
        },
        catch: (error) => error,
      }),
    installAndRestart: Effect.sync(() => {
      app.relaunch()
      app.exit(0)
    }),
    externalInstall: (url: string) =>
      Effect.tryPromise({
        try: () => shell.openExternal(url),
        catch: (error) => error,
      }),
  } satisfies Platform
})
