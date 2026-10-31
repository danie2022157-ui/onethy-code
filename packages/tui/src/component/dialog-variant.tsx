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
      const autoThinking = local.model.auto.thinkingRouting()
      const manualLevel = local.model.auto.manualThinking()

      return [
        {
          value: "thinking routing",
          title: autoThinking
            ? "✓ 🧠 Auto Thinking: [ATIVADO (Dinâmico)]"
            : "○ 🧠 Auto Thinking: [DESATIVADO (Manual)]",
          description: autoThinking
            ? "Raciocínio dinâmico por agente (low em buscas, max em arquitetura). Clique para desativar."
            : "Raciocínio manual ativo. Escolha o nível fixo desejado abaixo.",
          onSelect: () => {
            local.model.auto.toggleThinkingRouting()
          },
        },
        ...(!autoThinking
          ? [
              {
                value: "low",
                title: manualLevel === "low" ? "● 🧠 low (Raciocínio Rápido)" : "○ 🧠 low (Raciocínio Rápido)",
                description: "Menor latência e consumo reduzido de tokens",
                onSelect: () => {
                  local.model.auto.setManualThinking("low")
                  dialog.clear()
                },
              },
              {
                value: "medium",
                title: manualLevel === "medium" ? "● 🧠 medium (Balanceado)" : "○ 🧠 medium (Balanceado)",
                description: "Equilíbrio ideal entre raciocínio e velocidade",
                onSelect: () => {
                  local.model.auto.setManualThinking("medium")
                  dialog.clear()
                },
              },
              {
                value: "high",
                title: manualLevel === "high" ? "● 🧠 high (Aprofundado)" : "○ 🧠 high (Aprofundado)",
                description: "Raciocínio profundo para código seguro e depuração complexa",
                onSelect: () => {
                  local.model.auto.setManualThinking("high")
                  dialog.clear()
                },
              },
              {
                value: "max",
                title: manualLevel === "max" ? "● 🧠 max (Máximo)" : "○ 🧠 max (Máximo)",
                description: "Raciocínio máximo para arquitetura profunda e problemas difíceis",
                onSelect: () => {
                  local.model.auto.setManualThinking("max")
                  dialog.clear()
                },
              },
              {
                value: "off",
                title: manualLevel === "off" ? "● 🚫 off (Desligado)" : "○ 🚫 off (Desligado)",
                description: "Desativa o thinking (resposta direta sem raciocínio prévio)",
                onSelect: () => {
                  local.model.auto.setManualThinking("off")
                  dialog.clear()
                },
              },
            ]
          : []),
        {
          value: "modo auto",
          title: "Modo Auto",
          description: `Automático por complexidade da tarefa · ${pool.balanced.label}`,
          onSelect: () => {
            local.model.auto.setTier("default")
            dialog.clear()
          },
        },
        {
          value: "eficiência",
          title: "Eficiência",
          description: `Menor consumo de crédito e latência · ${pool.efficiency.label}`,
          onSelect: () => {
            local.model.auto.setTier("efficiency")
            dialog.clear()
          },
        },
        {
          value: "balanceado",
          title: "Balanceado",
          description: `Equilíbrio entre capacidade e crédito · ${pool.balanced.label}`,
          onSelect: () => {
            local.model.auto.setTier("balanced")
            dialog.clear()
          },
        },
        {
          value: "inteligente",
          title: "Inteligente",
          description: `Modelos mais capazes p/ tarefas complexas · ${pool.intelligence.label}`,
          onSelect: () => {
            local.model.auto.setTier("intelligence")
            dialog.clear()
          },
        },
        {
          value: "modelos permitidos",
          title: "🎯 Modelos Permitidos...",
          description: `${summary} · Marcar modelos ou usar todos`,
          onSelect: () => {
            dialog.replace(() => <DialogFusionModels />)
          },
        },
      ]
    }

    return [
      {
        value: "default",
        title: "Default",
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
      title={local.model.auto.enabled() ? "Select variant — ⚡ Omni Fusion" : "Select variant"}
      renderFilter={!newDesigns()}
      current={local.model.variant.current() ?? (local.model.auto.enabled() ? "modo auto" : "default")}
      flat={true}
    />
  )
}
