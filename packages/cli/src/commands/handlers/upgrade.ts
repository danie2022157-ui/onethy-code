import { intro, log, outro, spinner } from "@clack/prompts"
import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Updater } from "../../services/updater"
import { handlePromptErrors } from "../../ui/prompt"
import { OPENCODE_VERSION } from "../../version"
import { stripVTControlCharacters } from "node:util"

export default Runtime.handler(
  Commands.commands.upgrade,
  Effect.fn("cli.upgrade")(
    function* (input) {
      intro("Upgrade")
      if (process.env.ONETHY_ACTIVE === "1" || process.env.OMNICODE_ACTIVE === "1") {
        if (process.env.OMNICODE_ACTIVE === "1" && process.env.ONETHY_ACTIVE !== "1" && !process.env.ONETHY_INSTALL_ROOT) {
          log.warn("OmniCode has no standalone update channel yet. Update its source checkout manually.")
          outro("Done")
          return
        }
        const s = spinner()
        s.start("Verificando atualizações em danie2022157-ui/onethy-code...")
        const pullResult = yield* Effect.tryPromise({
          try: async () => {
            const { execFileSync } = await import("node:child_process")
            const path = await import("node:path")
            const fs = await import("node:fs")
            const os = await import("node:os")

            const walkParents = (startDir: string) => {
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

            const candidates = [
              ...(process.env.ONETHY_INSTALL_ROOT ? [process.env.ONETHY_INSTALL_ROOT] : []),
              ...walkParents(import.meta.dirname),
              ...walkParents(path.dirname(process.execPath)),
            ]
            const root = candidates.find(
              (dir) => fs.existsSync(path.join(dir, ".git")) && fs.existsSync(path.join(dir, "packages", "tui")),
            )
            if (!root) {
              throw new Error("Não foi possível localizar o diretório de instalação Git do OnethyCode.")
            }

            const git = (...args: string[]) =>
              execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 30_000 }).trim()

            const origin = git("remote", "get-url", "origin")
            const normalized = origin.endsWith(".git") ? origin.slice(0, -4) : origin.replace(/\/+$/, "")
            const official = [
              "https://github.com/danie2022157-ui/onethy-code",
              "git@github.com:danie2022157-ui/onethy-code",
              "ssh://git@github.com/danie2022157-ui/onethy-code",
            ]
            if (!official.includes(normalized)) {
              throw new Error(`Origin Git inválido (${origin}). Esperado: danie2022157-ui/onethy-code.`)
            }

            git("fetch", "origin", "main", "--quiet")
            const localCommit = git("rev-parse", "--short=7", "HEAD")
            const remoteCommit = git("rev-parse", "--short=7", "origin/main")
            const behindCount = Number.parseInt(git("rev-list", "--count", "HEAD..origin/main"), 10)

            if (!Number.isFinite(behindCount) || behindCount <= 0) {
              return {
                status: "up-to-date" as const,
                message: `Você já está na versão mais recente de danie2022157-ui/onethy-code (commit ${localCommit}).`,
              }
            }

            if (git("branch", "--show-current") !== "main") {
              throw new Error("A atualização automática requer estar na branch 'main'.")
            }
            if (git("status", "--porcelain").length > 0) {
              throw new Error(
                `Há ${behindCount} novo(s) commit(s) em danie2022157-ui/onethy-code (${localCommit} → ${remoteCommit}), mas existem alterações locais não commitadas. Faça commit ou stash antes de atualizar.`,
              )
            }

            const defaultBun = path.join(
              os.homedir(),
              ".bun",
              "bin",
              process.platform === "win32" ? "bun.exe" : "bun",
            )
            const bun =
              process.env.BUN_BIN && fs.existsSync(process.env.BUN_BIN)
                ? process.env.BUN_BIN
                : fs.existsSync(defaultBun)
                  ? defaultBun
                  : "bun"

            s.message(`Baixando ${behindCount} commit(s) (${localCommit} → ${remoteCommit})...`)
            const pullOut = git("pull", "--ff-only", "origin", "main")

            s.message("Atualizando dependências com Bun...")
            execFileSync(bun, ["install"], { cwd: root, timeout: 180_000, stdio: "pipe" })

            const cacheScript = path.join(root, "packages", "cli", "script", "build-local-cache.ts")
            if (fs.existsSync(cacheScript)) {
              s.message("Recompilando cache rápido do OnethyCode CLI...")
              execFileSync(bun, [cacheScript], { cwd: root, timeout: 120_000, stdio: "pipe" })
            }

            const customScript = path.join(root, "packages", "cli", "src", "services", "onethy-customizations.mjs")
            if (fs.existsSync(customScript)) {
              try {
                execFileSync("node", [customScript], { cwd: root, timeout: 60_000, stdio: "pipe" })
              } catch {}
            }

            return {
              status: "updated" as const,
              message: `${localCommit} → ${remoteCommit} (${behindCount} commit(s) aplicado(s))\n${pullOut}`,
            }
          },
          catch: (err) => (err instanceof Error ? err : new Error(String(err))),
        }).pipe(Effect.result)

        if (pullResult._tag === "Success") {
          s.stop(
            pullResult.success.status === "up-to-date"
              ? "✓ OnethyCode está em dia!"
              : "✓ OnethyCode atualizado com sucesso!",
          )
          log.success(pullResult.success.message)
        } else {
          s.stop("Não foi possível concluir a atualização.")
          log.warn(pullResult.failure.message)
        }
        outro("Done")
        return
      }

      const updater = yield* Updater.Service
      const method = Option.getOrUndefined(input.method) ?? (yield* updater.method())
      if (!method)
        return yield* Effect.fail(
          new Error("Could not detect the installation method. Pass --method to choose how to upgrade OpenCode."),
        )

      log.info(`Using method: ${method}`)
      const target = Option.getOrUndefined(input.target) ?? (yield* updater.latest(method))
      const version = target.trim().replace(/^v/, "")
      if (version === OPENCODE_VERSION) {
        log.warn(`OpenCode upgrade skipped: ${version} is already installed`)
        outro("Done")
        return
      }

      log.info(`From ${OPENCODE_VERSION} → ${version}`)
      const progress = spinner()
      progress.start("Upgrading...")
      yield* updater.upgrade(method, target).pipe(
        Effect.tap(() => Effect.sync(() => progress.stop("Upgrade complete"))),
        Effect.tapCause(() => Effect.sync(() => progress.stop("Upgrade failed", 1))),
      )
      outro("Done")
    },
    (effect) =>
      handlePromptErrors(
        effect.pipe(
          Effect.mapError((error) =>
            error instanceof Updater.UpgradeError ? new Error(formatUpgradeError(error), { cause: error }) : error,
          ),
        ),
      ),
  ),
)

function formatUpgradeError(error: Updater.UpgradeError) {
  const clean = (value: string) => stripVTControlCharacters(value).replaceAll("\r", "").trim()
  const line = (value: string) => clean(value).replace(/\s+/g, " ")
  const detail = wrap(clean(error.detail), Math.max(24, (process.stdout.columns ?? 80) - 7)).join("\n")
  return [
    line(error.title),
    "",
    detail,
    ...(error.command ? ["", field("Command", line(error.command))] : []),
    field("Retry", line(error.retry)),
  ].join("\n")
}

function field(label: string, value: string) {
  const prefix = label.padEnd(9)
  const width = Math.max(24, Math.min(61, (process.stdout.columns ?? 80) - prefix.length - 10))
  const lines = wrap(value, width)
  return lines.map((line, index) => `${index === 0 ? prefix : " ".repeat(prefix.length)}${line}`).join("\n")
}

function wrap(value: string, width: number) {
  return value.split("\n").flatMap((source) => {
    if (source.length <= width) return [source]
    return source.split(/\s+/).reduce<string[]>((result, word) => {
      const index = result.length - 1
      if (index < 0 || result[index].length + word.length + 1 > width) result.push(word)
      else result[index] += ` ${word}`
      return result
    }, [])
  })
}
