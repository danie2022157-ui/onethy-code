import { spawn } from "node:child_process"
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import { Plugin } from "@opencode/plugin/tui"
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
      "    if ((Get-Date) -gt $deadline) { throw 'Tempo limite aguardando encerramento do OnethyCode.' }",
      "    Start-Sleep -Milliseconds 250",
      "  }",
    ]).flat(),
    "  Start-Sleep -Milliseconds 500",
    "  Write-Host 'Removendo a instalacao e os dados do OnethyCode...' -ForegroundColor Yellow",
    "  & " + powershellLiteral(launcher) + " unistall --purge --force --defer-launchers",
    "  if ($LASTEXITCODE -ne 0) { throw ('Desinstalacao do aplicativo falhou com codigo ' + $LASTEXITCODE) }",
    "  $checkout = " + source,
    "  if (-not (Test-Path -LiteralPath $checkout -PathType Container)) { throw 'Pasta do codigo-fonte nao encontrada.' }",
    "  $info = Get-Item -LiteralPath $checkout -Force",
    "  if ($info.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Recusado: pasta vinculada por symlink/junction.' }",
    "  if (-not (Test-Path -LiteralPath (Join-Path $checkout 'bin\\onethy.js') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $checkout 'install.ps1') -PathType Leaf)) { throw 'A pasta nao parece ser um checkout OnethyCode.' }",
    // The CLI has exited; its .cmd/.ps1 launcher is no longer in use.
    "  $launcherDirectory = Split-Path -Parent " + powershellLiteral(launcher),
    "  $configFile = Join-Path $launcherDirectory 'onethy-config.json'",
    "  $scriptFile = Join-Path $launcherDirectory 'onethy.ps1'",
    "  $config = Get-Content -LiteralPath $configFile -Raw -ErrorAction Stop | ConvertFrom-Json",
    "  if ([string]$config.checkout -ine $checkout) { throw 'O instalador registrado pertence a outra pasta.' }",
    "  $script = Get-Content -LiteralPath $scriptFile -Raw -ErrorAction Stop",
    "  if (-not $script.Contains('onethy-config.json') -or -not $script.Contains('bin\onethy.js')) { throw 'Instalador do Windows nao reconhecido.' }",
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
    "  Write-Host ('Excluindo codigo-fonte: ' + $checkout) -ForegroundColor Yellow",
    "  $deleted = $false",
    "  foreach ($attempt in 1..20) {",
    "    try { Remove-Item -LiteralPath $checkout -Recurse -Force -ErrorAction Stop; $deleted = $true; break }",
    "    catch { if ($attempt -eq 20) { throw }; Start-Sleep -Milliseconds 300 }",
    "  }",
    "  if (-not $deleted -or (Test-Path -LiteralPath $checkout)) { throw 'Nao foi possivel remover a pasta de codigo-fonte.' }",
    "  if ($unknownLaunchers.Count -gt 0) { throw ('Alguns atalhos nao foram removidos por nao corresponderem ao OnethyCode: ' + ($unknownLaunchers -join ', ')) }",
    "  $status = 0",
    "  Write-Host 'OnethyCode removido completamente deste computador.' -ForegroundColor Green",
    "} catch {",
    "  Write-Host ('Desinstalacao incompleta: ' + $_.Exception.Message) -ForegroundColor Red",
    "}",
    "Read-Host 'Pressione Enter para fechar'",
  ].join("\n")
}

export default Plugin.define({
  id: "onethy.unistall",
  setup(context) {
    context.ui.slot({
      append: "app",
      render() {
        const toast = useToast()
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "system.unistall",
            title: "Desinstalar OnethyCode completamente",
            description: "Executar a remocao da aplicacao e de seus dados apos confirmacao",
            group: "System",
            slash: { name: "unistall", aliases: ["uninstall"] },
            palette: true,
            async run() {
              if (process.env.ONETHY_ACTIVE !== "1" && process.env.OMNICODE_ACTIVE !== "1") {
                toast.show({ message: "Disponivel somente no OnethyCode.", variant: "warning" })
                return
              }
              if (process.platform !== "win32") {
                await context.ui.dialog.alert({
                  title: "Desinstalacao completa",
                  message: "A execucao direta de /unistall ainda requer Windows. Use onethy unistall --purge em outro terminal.",
                })
                return
              }
              const checkout = onethySourceCheckout()
              const launcher = checkout ? onethyInstalledLauncher(checkout) : undefined
              if (!checkout || !launcher) {
                await context.ui.dialog.alert({
                  title: "Desinstalacao nao iniciada",
                  message: "Nao foi possivel verificar o codigo-fonte e o instalador global do OnethyCode. Nenhum arquivo foi removido. Reinstale com install.ps1 ou execute a limpeza manual com verificacao dos caminhos.",
                })
                return
              }
              const confirmed = await context.ui.dialog.confirm({
                title: "Excluir TODO o OnethyCode?",
                message: [
                  "Essa acao remove permanentemente o programa, os comandos do Windows, configuracoes, sessoes, memórias locais, credenciais, cache e o codigo-fonte:",
                  checkout,
                  "Arquivos e alteracoes locais nessa pasta serao perdidos. Projetos em outras pastas nao serao apagados.",
                  "O OnethyCode sera encerrado para executar a limpeza em outra janela.",
                ].join("\n"),
                label: { confirm: "Excluir tudo", cancel: "Cancelar" },
              })
              if (!confirmed) return
              try {
                const script = uninstallWorkerCommand(process.pid, checkout, launcher, process.ppid)
                const worker = spawn("powershell.exe", [
                  "-NoProfile", "-NoLogo", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64"),
                ], { detached: true, stdio: "ignore", windowsHide: false, cwd: process.env.USERPROFILE || process.cwd() })
                // Detect synchronous errors before exiting and don't keep the UI
                // process alive only to track the separate uninstall console.
                await new Promise<void>((resolve, reject) => {
                  worker.once("error", reject)
                  worker.once("spawn", resolve)
                })
                worker.unref()
                process.exit(0)
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
