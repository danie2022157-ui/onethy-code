import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useNewDesigns } from "../config"
import { DialogVariant } from "./dialog-variant"

export function DialogFusionModels() {
  const local = useLocal()
  const dialog = useDialog()
  const newDesigns = useNewDesigns()

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const raw = local.model.auto.rawConnectedModels()
    const isAll = local.model.auto.isAllModelsAllowed()
    const summary = local.model.auto.allowedModelsSummary()

    const list: DialogSelectOption<string>[] = [
      {
        value: "__all__",
        title: isAll ? "✓ [Todos os Modelos Conectados]" : "○ [Usar Todos os Modelos Conectados]",
        description: isAll
          ? "Ativo: Omni Fusion pode rotear dinamicamente para qualquer modelo conectado"
          : "Clique para permitir todos os modelos conectados sem restrição",
        onSelect: () => {
          local.model.auto.setAllowAllModels()
        },
      },
    ]

    for (const m of raw) {
      const allowed = local.model.auto.isModelAllowed(m.providerID, m.id)
      const checked = !isAll && allowed
      const mark = checked ? "✓ " : isAll ? "✓ " : "○ "
      const bucket = local.model.auto.classify(m.id, m.name)
      const bucketName =
        bucket === "efficiency" ? "Eficiência" : bucket === "intelligence" ? "Inteligência" : "Balanceado"

      list.push({
        value: `${m.providerID}/${m.id}`,
        title: `${mark}${m.name}`,
        description: `Tier: ${bucketName} · Provedor: ${m.providerID} · ${m.id}`,
        onSelect: () => {
          local.model.auto.toggleModelAllowed(m.providerID, m.id)
        },
      })
    }

    list.push({
      value: "__thinking__",
      title: local.model.auto.thinkingRouting()
        ? "✓ 🧠 Roteamento de Thinking: [ATIVADO]"
        : "○ 🧠 Roteamento de Thinking: [DESATIVADO]",
      description: local.model.auto.thinkingRouting()
        ? "Ajusta tokens de raciocínio dinamicamente (low em buscas, max em arquitetura) · Clique para desativar"
        : "Variante de raciocínio estática · Clique para ativar roteamento dinâmico de thinking",
      onSelect: () => {
        local.model.auto.toggleThinkingRouting()
      },
    })

    list.push({
      value: "__back__",
      title: "← Voltar para Opções de Variante",
      description: `Configuração atual: ${summary}`,
      onSelect: () => {
        dialog.replace(() => <DialogVariant />)
      },
    })

    return list
  })

  return (
    <DialogSelect<string>
      options={options()}
      title="Omni Fusion — Modelos Permitidos"
      description={`Selecione quais modelos o Omni Fusion pode utilizar (${local.model.auto.allowedModelsSummary()})`}
      renderFilter={!newDesigns()}
      flat={true}
      placeholder="Filtrar modelos por nome ou provedor..."
    />
  )
}

