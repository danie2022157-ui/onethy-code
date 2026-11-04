import { spawn } from "node:child_process"
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import { Plugin } from "@opencode/plugin/tui"
import { useExit } from "../../context/exit"
import { useToast } from "../../ui/toast"

/**
 * The confirmed uninstall runs in a separate Windows console, after this TUI
 * process exits. That avoids deleting files still in use by the application.
 */
/** Source deletion is permitted only for a verified Onethy source checkout
 * under the current Windows user's home. Never infer it from process.cwd(). */
export function onethySourceCheckout(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string | undefined {
  const home = env.USERPROFILE
  const installRoot = env.ONETHY_INSTALL_ROOT
  if (platform !== "win32" || !home || !installRoot || !path.isAbsolute(home) || !path.isAbsolute(installRoot))
    return
  const root = path.resolve(installRoot)
  const relative = path.relative(path.resolve(home), root)
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    return
  if (!/^onethy[-_]?code(?:[-_].*)?$/i.test(path.basename(root))) return
  try {
    const realHome = realpathSync(home)
    const realRoot = realpathSync(root)
    const resolvedRelative = path.relative(realHome, realRoot)
    if (!resolvedRelative || resolvedRelative === ".." || resolvedRelative.startsWith(".." + path.sep) || path.isAbsolute(resolvedRelative))
      return
    if (lstatSync(root).isSymbolicLink()) return
    if (!statSync(path.join(root, "bin", "onethy.js")).isFile()) return
    if (!statSync(path.join(root, "install.ps1")).isFile()) return
  } catch {
    return
  }
  return root
}

/**
 * The Windows installer owns its launcher only when its config points at
 * this verified checkout. Never execute another application's onethy.cmd.
 */
export function onethyInstalledLauncher(checkout: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!env.LOCALAPPDATA || !path.isAbsolute(env.LOCALAPPDATA)) return
  const directory = path.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps")
  const file = path.join(directory, "onethy.cmd")
  try {
    const info = JSON.parse(readFileSync(path.join(directory, "onethy-config.json"), "utf8"))
    if (typeof info?.checkout !== "string") return
    if (path.normalize(info.checkout).toLowerCase() !== path.normalize(checkout).toLowerCase()) return
    const launcher = readFileSync(file, "utf8")
    if (!launcher.includes('"%~dp0onethy.ps1" %*')) return
    const script = readFileSync(path.join(directory, "onethy.ps1"), "utf8")
    if (!script.includes("onethy-config.json") || !script.includes("bin\\onethy.js")) return
    return file
  } catch {
    return
  }
}

function powershellLiteral(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'"
}

/** A detached, UTF-16LE encoded PowerShell command, independent of checkout files.
 * The command requires the explicit, verified checkout path: a partial purge
 * must never be reported as a complete uninstall. */
export function uninstallWorkerCommand(pid: number, checkout: string, launcher: string, parentPid?: number): string {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid OnethyCode PID")
  if (!checkout || !path.isAbsolute(checkout) || !launcher || !path.isAbsolute(launcher))
    throw new Error("Verified OnethyCode source and launcher paths are required")
  const pids = [...new Set([pid, parentPid].filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0))]
  const source = powershellLiteral(checkout)
  return [
    "$ErrorActionPreference = 'Stop'",
    "$status = 1",
    "try {",
    "  $deadline = (Get-Date).AddSeconds(60)",
    ...pids.map((value) => [
      "  while (Get-Process -Id " + value + " -ErrorAction SilentlyContinue) {",
      "    if ((Get-Date) -gt $deadline) { throw 'Timeout waiting for OnethyCode to exit.' }",
      "    Start-Sleep -Milliseconds 250",
      "  }",
    ]).flat(),
    "  Start-Sleep -Milliseconds 500",
    "  Write-Host 'Removing OnethyCode installation and data...' -ForegroundColor Yellow",
    "  & " + powershellLiteral(launcher) + " unistall --purge --force --defer-launchers",
    "  if ($LASTEXITCODE -ne 0) { throw ('Application uninstall failed with code ' + $LASTEXITCODE) }",
    "  $checkout = " + source,
    "  if (-not (Test-Path -LiteralPath $checkout -PathType Container)) { throw 'Source code folder not found.' }",
    "  $info = Get-Item -LiteralPath $checkout -Force",
    "  if ($info.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Declined: folder linked by symlink/junction.' }",
    "  if (-not (Test-Path -LiteralPath (Join-Path $checkout 'bin\\onethy.js') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $checkout 'install.ps1') -PathType Leaf)) { throw 'The folder does not appear to be an OnethyCode checkout.' }",
    // The CLI has exited; its .cmd/.ps1 launcher is no longer in use.
    "  $launcherDirectory = Split-Path -Parent " + powershellLiteral(launcher),
    "  $configFile = Join-Path $launcherDirectory 'onethy-config.json'",
    "  $scriptFile = Join-Path $launcherDirectory 'onethy.ps1'",
    "  $config = Get-Content -LiteralPath $configFile -Raw -ErrorAction Stop | ConvertFrom-Json",
    "  if ([string]$config.checkout -ine $checkout) { throw 'The registered installer belongs to another folder.' }",
    "  $script = Get-Content -LiteralPath $scriptFile -Raw -ErrorAction Stop",
    "  if (-not $script.Contains('onethy-config.json') -or -not $script.Contains('bin\\onethy.js')) { throw 'Unrecognized Windows installer.' }",
    "  $unknownLaunchers = @()",
    "  foreach ($name in @('onethy.cmd', 'onethy-code.cmd', 'omni.cmd', 'omnicode.cmd')) {",
    "    $file = Join-Path $launcherDirectory $name",
    "    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }",
    "    $body = Get-Content -LiteralPath $file -Raw -ErrorAction Stop",
    "    if ($body.Contains('\"%~dp0onethy.ps1\" %*') -and $body.Contains('WindowsPowerShell')) {",
    "      Remove-Item -LiteralPath $file -Force -ErrorAction Stop",
    "    } else { $unknownLaunchers += $file }",
    "  }",
    "  Remove-Item -LiteralPath $scriptFile -Force -ErrorAction Stop",
    "  Remove-Item -LiteralPath $configFile -Force -ErrorAction Stop",
    "  Write-Host ('Deleting source code: ' + $checkout) -ForegroundColor Yellow",
    "  $deleted = $false",
    "  foreach ($attempt in 1..20) {",
    "    try { Remove-Item -LiteralPath $checkout -Recurse -Force -ErrorAction Stop; $deleted = $true; break }",
    "    catch { if ($attempt -eq 20) { throw }; Start-Sleep -Milliseconds 300 }",
    "  }",
    "  if (-not $deleted -or (Test-Path -LiteralPath $checkout)) { throw 'Could not remove the source code folder.' }",
    "  if ($unknownLaunchers.Count -gt 0) { throw ('Some shortcuts were not removed because they do not match OnethyCode: ' + ($unknownLaunchers -join ', ')) }",
    "  $status = 0",
    "  Write-Host 'OnethyCode completely removed from this computer.' -ForegroundColor Green",
    "} catch {",
    "  Write-Host ('Incomplete uninstall: ' + $_.Exception.Message) -ForegroundColor Red",
    "}",
    "Read-Host 'Press Enter to close'",
  ].join("\n")
}

export default Plugin.define({
  id: "onethy.unistall",
  setup(context) {
    context.ui.slot({
      append: "app",
      render() {
        const toast = useToast()
        const exit = useExit()
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "system.unistall",
            title: "Uninstall OnethyCode completely",
            description: "Execute the removal of the application and its data after confirmation",
            group: "System",
            slash: { name: "unistall", aliases: ["uninstall"] },
            palette: true,
            async run() {
              if (process.env.ONETHY_ACTIVE !== "1" && process.env.OMNICODE_ACTIVE !== "1") {
                toast.show({ message: "Available only in OnethyCode.", variant: "warning" })
                return
              }
              if (process.platform !== "win32") {
                await context.ui.dialog.alert({
                  title: "Complete uninstallation",
                  message: "Direct execution of /uninstall still requires Windows. Use onethy uninstall --purge in another terminal.",
                })
                return
              }
              const checkout = onethySourceCheckout()
              const launcher = checkout ? onethyInstalledLauncher(checkout) : undefined
              if (!checkout || !launcher) {
                await context.ui.dialog.alert({
                  title: "Uninstallation not started",
                  message: "Could not verify the source code and global installer of OnethyCode. No files were removed. Reinstall with install.ps1 or perform manual cleanup verifying paths.",
                })
                return
              }
              const confirmed = await context.ui.dialog.confirm({
                title: "Delete ALL of OnethyCode?",
                message: [
                  "This action permanently removes the program, Windows commands, settings, sessions, local memories, credentials, cache, and source code:",
                  checkout,
                  "Files and local changes in this folder will be lost. Projects in other folders will not be deleted.",
                  "OnethyCode will be closed to execute the cleanup in another window.",
                ].join("\n"),
                label: { confirm: "Delete everything", cancel: "Cancel" },
              })
              if (!confirmed) return
              try {
                const script = uninstallWorkerCommand(process.pid, checkout, launcher, process.ppid)
                const worker = spawn("powershell.exe", [
                  "-NoProfile", "-NoLogo", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64"),
                ], { detached: true, stdio: "inherit", windowsHide: false, cwd: process.env.USERPROFILE || process.cwd() })
                // Detect synchronous errors before exiting and don't keep the UI
                // process alive only to track the separate uninstall console.
                await new Promise<void>((resolve, reject) => {
                  worker.once("error", reject)
                  worker.once("spawn", resolve)
                })
                worker.unref()
                // Do not terminate Bun while Solid/OpenTUI still owns its native scene.
                // Use the application's normal ExitProvider lifecycle, outside this
                // command callback, so the renderer can release resources cleanly.
                queueMicrotask(() => exit())
              } catch (error) {
                toast.show({
                  message: error instanceof Error ? error.message : String(error),
                  variant: "error",
                })
              }
            },
          }],
        }))
        return null
      },
    })
  },
})
