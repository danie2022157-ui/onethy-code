import { spawn } from "node:child_process"
import { lstatSync, statSync } from "node:fs"
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
    if (lstatSync(root).isSymbolicLink()) return
    if (!statSync(path.join(root, "bin", "onethy.js")).isFile()) return
    if (!statSync(path.join(root, "install.ps1")).isFile()) return
  } catch {
    return
  }
  return root
}

function powershellLiteral(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'"
}

export function uninstallWorkerCommand(pid: number, removeSource?: string): string {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid OnethyCode PID")
  return [
    `while (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 300 }`,
    "Start-Sleep -Milliseconds 800",
    "Write-Host 'Desinstalando OnethyCode e removendo seus dados...' -ForegroundColor Yellow",
    "& onethy unistall --purge --force",
    "$status = $LASTEXITCODE",
    ...(removeSource ? [
      "if ($status -eq 0) {",
      `  Write-Host 'Removendo codigo-fonte: ' ${powershellLiteral(removeSource)} -ForegroundColor Yellow`,
      `  try { Remove-Item -LiteralPath ${powershellLiteral(removeSource)} -Recurse -Force -ErrorAction Stop }`,
      "  catch { Write-Host ('Falha ao remover o codigo-fonte: ' + $_.Exception.Message) -ForegroundColor Red; $status = 1 }",
      "}",
    ] : []),
    "if ($status -ne 0) { Write-Host 'A desinstalacao nao foi concluida. Verifique as mensagens acima.' -ForegroundColor Red }",
    "else { Write-Host 'Desinstalacao finalizada.' -ForegroundColor Green }",
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
              const confirmed = await context.ui.dialog.confirm({
                title: "Desinstalar OnethyCode?",
                message: [
                  "Isso apagara permanentemente configuracoes, sessoes, credenciais e cache do OnethyCode.",
                  "O repositorio de codigo e os projetos de clientes nao serao apagados.",
                  "O OnethyCode sera encerrado e a desinstalacao continuara em uma nova janela.",
                ].join("\n"),
                label: { confirm: "Desinstalar", cancel: "Cancelar" },
              })
              if (!confirmed) return
              const checkout = onethySourceCheckout()
              const removeSource = checkout
                ? await context.ui.dialog.confirm({
                    title: "Apagar tambem o codigo-fonte?",
                    message: [
                      "Esta pasta sera apagada permanentemente, incluindo alteracoes locais nao enviadas ao GitHub:",
                      checkout,
                      "Confirme somente se nao precisa mais de nenhum arquivo dessa pasta.",
                    ].join("\n"),
                    label: { confirm: "Apagar codigo-fonte", cancel: "Preservar pasta" },
                  })
                : false
              try {
                const worker = spawn("powershell.exe", [
                  "-NoProfile", "-NoLogo", "-Command", uninstallWorkerCommand(process.pid, removeSource ? checkout : undefined),
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
