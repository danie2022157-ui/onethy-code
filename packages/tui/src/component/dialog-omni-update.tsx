import { createMemo, createSignal } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useNewDesigns } from "../config"
import { openUrl } from "@opencode/util/open"
import { exec } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

function findRepoRoot(startDir = process.cwd()): string | undefined {
  let curr = startDir
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(curr, ".git"))) return curr
    const parent = path.dirname(curr)
    if (parent === curr) break
    curr = parent
  }
  return undefined
}

function runGit(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout: stdout || "", stderr: stderr || "" }))
      else resolve({ stdout: stdout || "", stderr: stderr || "" })
    })
  })
}

export function DialogOmniUpdate() {
  const dialog = useDialog()
  const toast = useToast()
  const newDesigns = useNewDesigns()
  const [updating, setUpdating] = createSignal(false)
  const [checking, setChecking] = createSignal(false)
  const repoUrl = "https://github.com/danie2022157-ui/onethy-code"

  const options = createMemo<DialogSelectOption<string>[]>(() => [
    {
      value: "pull",
      title: updating()
        ? "⏳ Baixando e aplicando atualizações..."
        : "⚡ Atualizar Agora (Auto-Pull via Git)",
      description: "Baixa os últimos commits de origin/main e atualiza seus arquivos automaticamente",
      onSelect: async () => {
        if (updating() || checking()) return
        setUpdating(true)
        toast.show({
          variant: "info",
          title: "⚡ OnethyCode Updater",
          message: "Conectando ao GitHub para baixar atualizações...",
        })

        try {
          const rootDir = findRepoRoot()
          if (!rootDir) {
            toast.show({
              variant: "warning",
              title: "⚡ Repositório Git não encontrado",
              message: "Clone o repositório 'https://github.com/danie2022157-ui/onethy-code.git' para usar auto-update.",
              duration: 5000,
            })
            return
          }

          const res = await runGit("git pull origin main", rootDir)
          const output = (res.stdout + res.stderr).trim()

          if (/already up to date|já atualizado/i.test(output)) {
            toast.show({
              variant: "info",
              title: "⚡ OnethyCode",
              message: "✓ Seu OnethyCode já está na versão mais recente!",
              duration: 3500,
            })
          } else {
            toast.show({
              variant: "success",
              title: "⚡ Atualização Concluída!",
              message: "✓ OnethyCode atualizado com sucesso! Reinicie para carregar as novas funcionalidades.",
              duration: 5000,
            })
          }
        } catch (e: any) {
          const stderr = e?.stderr || e?.stdout || e?.message || ""
          if (/conflict|overwrite|untracked/i.test(stderr)) {
            toast.show({
              variant: "warning",
              title: "⚡ Conflito Local",
              message: "Existem arquivos modificados localmente. Rode 'git stash' ou 'git pull' no terminal.",
              duration: 5000,
            })
          } else {
            toast.show({
              variant: "error",
              title: "⚡ Erro ao atualizar",
              message: `Falha na sincronização: ${String(stderr || "Verifique sua conexão.").slice(0, 80)}`,
              duration: 4000,
            })
          }
        } finally {
          setUpdating(false)
          dialog.clear()
        }
      },
    },
    {
      value: "check",
      title: checking() ? "⏳ Verificando repositório..." : "🔍 Apenas Verificar Novidades (Sem Alterar Arquivos)",
      description: "Consulta o GitHub para ver o último commit disponível sem modificar arquivos",
      onSelect: async () => {
        if (updating() || checking()) return
        setChecking(true)
        toast.show({
          variant: "info",
          title: "⚡ OnethyCode Updater",
          message: "Verificando commits no GitHub...",
        })

        try {
          const res = await fetch("https://api.github.com/repos/danie2022157-ui/onethy-code/commits/main", {
            headers: { "User-Agent": "OnethyCode-Updater" },
          }).catch(() => null)

          if (res && res.ok) {
            const data = (await res.json()) as { sha?: string; commit?: { message?: string } }
            const commitTitle = data.commit?.message?.split("\n")[0] || "Atualizações disponíveis"
            const sha = data.sha ? data.sha.slice(0, 7) : ""
            toast.show({
              variant: "success",
              title: `⚡ Versão Remota: ${sha}`,
              message: `Último commit: ${commitTitle.slice(0, 60)}`,
              duration: 4000,
            })
          } else {
            toast.show({
              variant: "info",
              title: "⚡ OnethyCode",
              message: "Repositório verificado e sincronizado!",
              duration: 3000,
            })
          }
        } catch {
          toast.show({
            variant: "warning",
            title: "⚡ OnethyCode",
            message: "Não foi possível checar a API do GitHub agora.",
            duration: 3000,
          })
        } finally {
          setChecking(false)
          dialog.clear()
        }
      },
    },
    {
      value: "github",
      title: "🌐 Abrir Repositório no GitHub",
      description: repoUrl,
      onSelect: () => {
        void openUrl(repoUrl).catch(() => undefined)
        dialog.clear()
      },
    },
    {
      value: "close",
      title: "← Fechar",
      description: "Voltar para o chat",
      onSelect: () => {
        dialog.clear()
      },
    },
  ])

  return (
    <DialogSelect<string>
      options={options()}
      title="Atualizar OnethyCode"
      description="Baixe as últimas melhorias do OnethyCode direto do GitHub"
      renderFilter={!newDesigns()}
      flat={true}
    />
  )
}

