import { spawn } from "node:child_process"
import { copyFileSync, lstatSync, mkdtempSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import os from "node:os"
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

/** Use a copy outside the source checkout, otherwise an uninstaller can
 * delete the script it is still executing. The PowerShell script performs
 * independent verification and does NOT depend on a working TUI/CLI. */
export function uninstallWorkerArgs(script: string, checkout: string, pid: number, parentPid: number) {
  if (!path.isAbsolute(script) || !path.isAbsolute(checkout)) throw new Error("Invalid OnethyCode paths")
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid OnethyCode PID")
  return [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", script,
    "-Checkout", checkout,
    "-ChildPid", String(pid),
    "-ParentPid", String(parentPid),
    "-Yes", "-KeepWindow",
  ]
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
              if (!checkout) {
                await context.ui.dialog.alert({
                  title: "Desinstalacao nao iniciada",
                  message: "Nao foi possivel identificar com seguranca a pasta OnethyCode. Nenhum arquivo foi apagado. Execute o script uninstall.ps1 em uma janela do PowerShell, informando a pasta de instalacao.",
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
                const source = path.join(checkout, "uninstall.ps1")
                if (!statSync(source).isFile()) throw new Error("uninstall.ps1 nao encontrado. Atualize o OnethyCode antes de desinstalar.")
                const stage = mkdtempSync(path.join(os.tmpdir(), "onethy-uninstall-"))
                const script = path.join(stage, "uninstall.ps1")
                copyFileSync(source, script)
                const worker = spawn("powershell.exe", uninstallWorkerArgs(script, checkout, process.pid, process.ppid), {
                  detached: true, stdio: "inherit", windowsHide: false, cwd: process.env.USERPROFILE || os.homedir(),
                })
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
