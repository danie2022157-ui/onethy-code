import { confirm, intro, log, outro, spinner } from "@clack/prompts"
import { Service } from "@opencode/client/effect/service"
import { Global } from "@opencode/util/global"
import { Effect, FileSystem, Schedule } from "effect"
import path from "node:path"
import { readFile as readNativeFile } from "node:fs/promises"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { RetainedImage } from "../../services/retained-image"
import { Updater } from "../../services/updater"
import { handlePromptErrors, prompt, requireInteractive } from "../../ui/prompt"
import { errorMessage } from "../../util/error"

export default Runtime.handler(
  Commands.commands.uninstall,
  Effect.fn("cli.uninstall")(function* (input) {
    intro("Uninstall OnethyCode")
    if (input.purge && process.env.ONETHY_ACTIVE !== "1" && process.env.OMNICODE_ACTIVE !== "1")
      return yield* Effect.fail(new Error("Purge is available only in the OnethyCode runtime."))
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    if (input.purge && purgePaths(global).length === 0)
      return yield* Effect.fail(new Error("Refusing purge: no safe Onethy-owned data directories were resolved."))
    const updater = yield* Updater.Service
    const method = yield* updater.method()
    // A source-based Onethy launcher must never uninstall an unrelated OpenCode package.
    const removal = input.purge ? undefined : method ? updater.removal(method) : undefined
    const onethyLaunchers = input.purge ? yield* Effect.promise(() => ownedOnethyLaunchers()) : []
    // Data, config, and state hold sessions, credentials, settings, and prompt history; uninstall only removes the cache.
    // All channels share the cache. Stop background services before deleting it.
    // Read registrations directly: ServiceConfig.options() can migrate files even during a dry run.
    const services = (yield* fs.exists(global.state))
      ? (yield* fs.readDirectory(global.state)).filter((name) => /^service(?:-.*)?\.json$/.test(name))
      : []
    const shell = method === "curl" ? yield* shellConfigs(global.home) : []

    log.info(`Installation method: ${method ?? "unknown"}`)
    log.message("The following OnethyCode application files will be removed:")
    if (yield* fs.exists(global.cache)) log.info(`  Cache: ${global.cache}`)
    services.forEach((name) =>
      log.info(`  Stop background service and persistent terminals: ${path.join(global.state, name)}`),
    )
    shell.forEach((file) => log.info(`  Shell PATH: ${file}`))
    if (removal) log.info(`  Package: ${removal.command.join(" ")}`)
    if (method === "curl") log.info(`  Binary (manual removal): ${process.execPath}`)
    if (input.purge) {
      log.warn("PURGE: permanent removal of OnethyCode sessions, saved credentials, settings and service state.")
      for (const item of purgePaths(global)) log.info(`  Onethy data: ${item}`)
      for (const item of onethyLaunchers) log.info(`  Onethy Windows launcher: ${item}`)
      log.warn("Source checkouts and customer project directories are NOT deleted.")
    }
    if (!method && !onethyLaunchers.length)
      log.warn("Could not verify the installed Onethy launcher. Review the installation manually after cleanup.")

    if (input.dryRun) {
      log.warn("Dry run - no changes made")
      outro("Done")
      return
    }
    if (!input.force) {
      yield* requireInteractive("Use --force to uninstall without an interactive terminal, or --dry-run to preview.")
      const accepted = yield* prompt(() =>
        confirm({ message: input.purge ? "Permanently delete all OnethyCode application data and uninstall? This cannot be undone." : "Are you sure you want to uninstall?", initialValue: false }),
      )
      if (!accepted) {
        outro("Cancelled")
        return
      }
    }

    const progress = spinner()
    if (services.length) {
      progress.start("Stopping background services...")
      yield* Effect.forEach(services, (name) =>
        Effect.gen(function* () {
          const options = { file: path.join(global.state, name) }
          yield* ServerConnection.shutdownPersistentPty(options).pipe(Effect.ignore)
          yield* Service.stop(options)
        }),
      ).pipe(
        Effect.tap(() => Effect.sync(() => progress.stop("Background services stopped"))),
        Effect.tapCause(() => Effect.sync(() => progress.stop("Failed to stop background services", 1))),
      )
    }

    // Links that keep an older OpenCode replaceable may still run; move them so the cache can go.
    if (process.platform === "win32") yield* RetainedImage.relocate(global.cache, global.tmp)
    const errors: string[] = []
    progress.start("Removing Cache...")
    yield* fs.remove(global.cache, { recursive: true, force: true }).pipe(
      // Windows reports a terminated service as gone before it releases its file handles,
      // so the first removal can race that teardown.
      Effect.retry({
        while: (error) => process.platform === "win32" && error.reason._tag === "Busy",
        schedule: Schedule.max([Schedule.spaced("250 millis"), Schedule.recurs(40)]),
      }),
      Effect.tap(() => Effect.sync(() => progress.stop("Removed Cache"))),
      Effect.catch((error) =>
        Effect.sync(() => {
          progress.stop("Failed to remove Cache", 1)
          errors.push(`Cache: ${errorMessage(error)}`)
        }),
      ),
    )
    yield* Effect.forEach(shell, (file) =>
      fs.readFileString(file).pipe(
        Effect.flatMap((content) => fs.writeFileString(file, cleanShellConfig(content))),
        Effect.catch((error) => Effect.sync(() => errors.push(`Shell config ${file}: ${errorMessage(error)}`))),
      ),
    )
    if (removal) {
      progress.start(`Running ${removal.command.join(" ")}...`)
      yield* removal.run.pipe(
        Effect.tap(() => Effect.sync(() => progress.stop("Package removed"))),
        Effect.catch((error) =>
          Effect.sync(() => {
            progress.stop("Package manager uninstall failed", 1)
            errors.push(errorMessage(error))
            log.warn(`Run manually: ${removal.command.join(" ")}`)
          }),
        ),
      )
    }
    if (method === "curl") {
      log.message("To finish removing the binary, run:")
      log.info(`  rm '${process.execPath.replaceAll("'", "'\\''")}'`)
    }
    // Remove only Windows launcher files proven to belong to this checkout.
    // No administrator privileges, registry changes, or cleanup of unrelated aliases.
    if (input.purge) {
      for (const file of onethyLaunchers) {
        yield* fs.remove(file, { force: true }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => errors.push(`Windows launcher ${file}: ${errorMessage(error)}`)),
          ),
        )
      }
    }
    // The source checkout, other applications, and customer workspaces are never purge targets.
    // Only delete Onethy's own Global roots, after its services have stopped.
    if (input.purge) {
      for (const directory of purgePaths(global)) {
        progress.start(`Removing Onethy data: ${directory}`)
        yield* fs.remove(directory, { recursive: true, force: true }).pipe(
          Effect.retry({
            while: (error) => process.platform === "win32" && error.reason._tag === "Busy",
            schedule: Schedule.max([Schedule.spaced("250 millis"), Schedule.recurs(40)]),
          }),
          Effect.tap(() => Effect.sync(() => progress.stop("Removed"))),
          Effect.catch((error) =>
            Effect.sync(() => {
              progress.stop("Removal failed", 1)
              errors.push(`${directory}: ${errorMessage(error)}`)
            }),
          ),
        )
      }
    }
    if (errors.length) yield* Effect.fail(new Error(errors.join("\n")))
    outro(input.purge ? "OnethyCode application data removed. Remove the source checkout separately if desired." : "Done")
  }, handlePromptErrors),
)

const shellConfigs = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem
  const bin = path.dirname(process.execPath)
  // V1 and V2 curl installs share a PATH entry; retain it while another binary uses it.
  if ((yield* fs.readDirectory(bin)).some((name) => name !== path.basename(process.execPath))) return []
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
  const zsh = process.env.ZDOTDIR || home
  const candidates: Record<string, string[]> = {
    fish: [path.join(home, ".config/fish/config.fish"), path.join(xdg, "fish/config.fish")],
    zsh: [
      path.join(zsh, ".zshrc"),
      path.join(zsh, ".zshenv"),
      path.join(xdg, "zsh/.zshrc"),
      path.join(xdg, "zsh/.zshenv"),
    ],
    bash: [
      path.join(home, ".bashrc"),
      path.join(home, ".bash_profile"),
      path.join(home, ".profile"),
      path.join(xdg, "bash/.bashrc"),
      path.join(xdg, "bash/.bash_profile"),
    ],
    ash: [path.join(home, ".ashrc"), path.join(home, ".profile")],
    sh: [path.join(home, ".ashrc"), path.join(home, ".profile")],
  }
  const files = [...new Set(candidates[path.basename(process.env.SHELL || "bash")] ?? candidates.bash)]
  return yield* Effect.filter(files, (file) =>
    fs.readFileString(file).pipe(
      Effect.map((content) => cleanShellConfig(content) !== content),
      Effect.orElseSucceed(() => false),
    ),
  )
})

function cleanShellConfig(content: string) {
  const lines = content.split("\n")
  const entry = (line: string) =>
    /^(?:export PATH=|fish_add_path\s)/.test(line.trim()) && line.includes(".opencode/bin")
  return lines
    .filter((line, index) => !entry(line) && !(line.trim() === "# opencode" && entry(lines[index + 1] ?? "")))
    .join("\n")
}

/**
 * Never follow arbitrary paths supplied by workspace configuration. Purge is
 * limited to the runtime's Onethy-specific global roots; guard against a
 * misconfigured path that points at the home directory or a filesystem root.
 */
export function purgePaths(global: Pick<Global.Interface, "home" | "data" | "config" | "state" | "cache">) {
  const directories = [global.data, global.config, global.state, global.cache]
  const home = path.resolve(global.home)
  return [...new Set(directories.map((item) => path.resolve(item)))].filter((item) => {
    const relative = path.relative(home, item)
    if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
      return false
    return item.split(path.sep).some((segment) => segment.toLowerCase() === "omnicode")
  })
}

/**
 * The Windows installer writes a small set of launchers under WindowsApps.
 * Remove only files matching the installer's signatures AND this process's
 * checkout marker, never arbitrary user-created .cmd/.ps1 files.
 */
export async function ownedOnethyLaunchers(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): Promise<string[]> {
  if (platform !== "win32" || !env.LOCALAPPDATA || !env.ONETHY_INSTALL_ROOT) return []
  if (!path.isAbsolute(env.LOCALAPPDATA) || !path.isAbsolute(env.ONETHY_INSTALL_ROOT)) return []
  const directory = path.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps")
  const configPath = path.join(directory, "onethy-config.json")
  const scriptPath = path.join(directory, "onethy.ps1")
  const read = (file: string) => readNativeFile(file, "utf8").catch(() => "")
  const config = await read(configPath)
  let checkout: unknown
  try {
    checkout = (JSON.parse(config) as { checkout?: unknown }).checkout
  } catch {
    return []
  }
  if (typeof checkout !== "string" || path.normalize(checkout).toLowerCase() !== path.normalize(env.ONETHY_INSTALL_ROOT).toLowerCase())
    return []
  const script = await read(scriptPath)
  if (!script.includes("onethy-config.json") || !script.includes("bin\\onethy.js")) return []

  const files: string[] = []
  for (const name of ["onethy.cmd", "onethy-code.cmd", "omni.cmd", "omnicode.cmd"]) {
    const file = path.join(directory, name)
    const content = await read(file)
    if (
      /%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/i.test(content) &&
      /-File\s+"%~dp0onethy\.ps1"\s+%\*/i.test(content)
    ) files.push(file)
  }
  return [...files, scriptPath, configPath]
}
