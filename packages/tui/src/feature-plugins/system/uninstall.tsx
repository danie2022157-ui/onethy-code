import { spawn } from "node:child_process"
import { Plugin } from "@opencode/plugin/tui"
import { useToast } from "../../ui/toast"

/**
 * The confirmed uninstall runs in a separate Windows console, after this TUI
 * process exits. That avoids deleting files still in use by the application.
 */
export function uninstallWorkerCommand(pid: number): string {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid OnethyCode PID")
  return [
    `while (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 300 }`,
    "Write-Host 'Desinstalando OnethyCode e removendo seus dados...' -ForegroundColor Yellow",
    "& onethy unistall --purge --force",
    "if ($LASTEXITCODE -ne 0) { Write-Host 'Falha na desinstalacao. Verifique as mensagens acima.' -ForegroundColor Red }",
    "else { Write-Host 'Desinstalacao finalizada.' -ForegroundColor Green }",
    "Read-Host 'Pressione Enter para fechar'",
  ].join("; ")
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
              try {
                const worker = spawn("powershell.exe", [
                  "-NoProfile", "-NoLogo", "-Command", uninstallWorkerCommand(process.pid),
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
