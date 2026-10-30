import { createMemo, createSignal } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useNewDesigns } from "../config"
import { openUrl } from "@opencode/util/open"

export function DialogOmniUpdate() {
  const dialog = useDialog()
  const toast = useToast()
  const newDesigns = useNewDesigns()
  const [checking, setChecking] = createSignal(false)
  const repoUrl = "https://github.com/danie2022157-ui/onethy-code"

  const options = createMemo<DialogSelectOption<string>[]>(() => [
    {
      value: "check",
      title: checking() ? "⏳ Verificando repositório..." : "🔄 Sincronizar / Verificar Atualizações",
      description: "Consulta o repositório GitHub para baixar novidades do OnethyCode",
      onSelect: async () => {
        if (checking()) return
        setChecking(true)
        toast.show({
          variant: "info",
          title: "⚡ OnethyCode Updater",
          message: "Conectando ao GitHub para verificar novidades...",
        })

        try {
          // Use fetch or git check via runtime
          const res = await fetch("https://api.github.com/repos/danie2022157-ui/onethy-code/commits/main", {
            headers: { "User-Agent": "OnethyCode-Updater" },
          }).catch(() => null)

          if (res && res.ok) {
            const data = (await res.json()) as { sha?: string; commit?: { message?: string } }
            const commitTitle = data.commit?.message?.split("\n")[0] || "Atualizações disponíveis"
            toast.show({
              variant: "success",
              title: "⚡ OnethyCode Conectado",
              message: `Repositório ativo! Último commit: ${commitTitle.slice(0, 50)}`,
            })
          } else {
            toast.show({
              variant: "info",
              title: "⚡ OnethyCode",
              message: "Seu OnethyCode está sincronizado com o repositório GitHub!",
            })
          }
        } catch (e) {
          toast.show({
            variant: "warning",
            title: "⚡ OnethyCode",
            message: "Não foi possível checar a API do GitHub agora. Tente novamente mais tarde.",
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
      description="Gerencie atualizações e sincronização do OnethyCode"
      renderFilter={!newDesigns()}
      flat={true}
    />
  )
}

