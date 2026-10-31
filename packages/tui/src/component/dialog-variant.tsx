import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useNewDesigns } from "../config"
import { DialogFusionModels } from "./dialog-fusion-models"

export function DialogVariant() {
  const local = useLocal()
  const dialog = useDialog()
  const newDesigns = useNewDesigns()

  const options = createMemo(() => {
    if (local.model.auto.enabled()) {
      const pool = local.model.auto.tierPool()
      const summary = local.model.auto.allowedModelsSummary()
      return [
        {
          value: "modo auto",
          title: "Modo Auto",
          category: "Níveis de Otimização",
          description: `Automático por complexidade da tarefa · ${pool.balanced.label}`,
          onSelect: () => {
            local.model.auto.setTier("default")
            dialog.clear()
          },
        },
        {
          value: "eficiência",
          title: "Eficiência",
          category: "Níveis de Otimização",
          description: `Menor consumo de crédito e latência · ${pool.efficiency.label}`,
          onSelect: () => {
            local.model.auto.setTier("efficiency")
            dialog.clear()
          },
        },
        {
          value: "balanceado",
          title: "Balanceado",
          category: "Níveis de Otimização",
          description: `Equilíbrio entre capacidade e crédito · ${pool.balanced.label}`,
          onSelect: () => {
            local.model.auto.setTier("balanced")
            dialog.clear()
          },
        },
        {
          value: "inteligente",
          title: "Inteligente",
          category: "Níveis de Otimização",
          description: `Modelos mais capazes p/ tarefas complexas · ${pool.intelligence.label}`,
          onSelect: () => {
            local.model.auto.setTier("intelligence")
            dialog.clear()
          },
        },
        {
          value: "modelos permitidos",
          title: "🎯 Modelos Permitidos por Provedor...",
          category: "Ajustes do Omni Fusion",
          description: `${summary} · Organizados em colunas (OpenAI, Google, OpenCode)`,
          onSelect: () => {
            dialog.replace(() => <DialogFusionModels />)
          },
        },
        {
          value: "thinking routing",
          title: local.model.auto.thinkingRouting()
            ? "✓ 🧠 Roteamento de Thinking: [ATIVADO]"
            : "○ 🧠 Roteamento de Thinking: [DESATIVADO]",
          category: "Ajustes do Omni Fusion",
          description: local.model.auto.thinkingRouting()
            ? "Ativo: ajusta raciocínio dinamicamente (low em buscas, max em arquitetura)"
            : "Inativo: mantém variante fixa do modelo. Clique para ativar",
          onSelect: () => {
            local.model.auto.toggleThinkingRouting()
          },
        },
      ]
    }

    return [
      {
        value: "default",
        title: "Padrão (Default)",
        category: "Variantes do Modelo",
        onSelect: () => {
          dialog.clear()
          local.model.variant.set(undefined)
        },
      },
      ...local.model.variant
        .list()
        .filter((variant) => variant !== "default")
        .map((variant) => ({
          value: variant,
          title: variant,
          category: "Variantes do Modelo",
          onSelect: () => {
            dialog.clear()
            local.model.variant.set(variant)
          },
        })),
    ]
  })

  return (
    <DialogSelect<string>
      options={options()}
      title={local.model.auto.enabled() ? "Selecionar variante — ⚡ Omni Fusion" : "Selecionar variante"}
      renderFilter={!newDesigns()}
      current={local.model.variant.current() ?? (local.model.auto.enabled() ? "modo auto" : "default")}
      flat={false}
    />
  )
}
