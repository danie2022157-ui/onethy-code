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
      if ((process.env.ONETHY_ACTIVE === "1" || process.env.OMNICODE_ACTIVE === "1")) {
        const s = spinner()
        s.start("Atualizando OnethyCode com Git fast-forward seguro...")
        const pullResult = yield* Effect.tryPromise(async () => {
          const { execFileSync } = await import("node:child_process")
          const path = await import("node:path")
          const fs = await import("node:fs")
          const root = process.env.ONETHY_INSTALL_ROOT
          if (!root || !fs.existsSync(path.join(root, ".git")) || !fs.existsSync(path.join(root, "packages", "tui"))) {
            throw new Error("Could not identify the OnethyCode installation; update refused.")
          }
          const git = (...args: string[]) =>
            execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 30000 }).trim()
          const origin = git("remote", "get-url", "origin")
          if (!/(?:^|[/:@])github\\.com[:/]danie2022157-ui\\/onethy-code(?:\\.git)?\\/?$/i.test(origin)) {
            throw new Error("Not the official OnethyCode Git origin; update refused.")
          }
          if (git("branch", "--show-current") !== "main") throw new Error("Update only works on the main branch.")
          if (git("status", "--porcelain").length > 0) throw new Error("Local edits exist; commit or back them up before updating.")
          const bun = process.env.BUN_BIN
          if (!bun || !fs.existsSync(bun)) throw new Error("Bun executable not found; update cancelled.")
          const result = git("pull", "--ff-only", "origin", "main")
          execFileSync(bun, ["install", "--frozen-lockfile"], { cwd: root, timeout: 180000, stdio: "pipe" })
          return result
        }).pipe(Effect.option)

        if (Option.isSome(pullResult)) {
          s.stop("✓ OnethyCode atualizado!")
          log.success(pullResult.value.trim())
        } else {
          s.stop("Falha ao atualizar via git.")
          log.warn("Atualização recusada ou falhou. Verifique a instalação oficial, alterações locais e conectividade.")
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
