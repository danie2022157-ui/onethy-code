import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useNewDesigns } from "../config"
import { DialogFusionModels } from "./dialog-fusion-models"
import { DialogAutoCustomizations } from "./dialog-auto-customizations"

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
          value: "auto mode",
          title: "Auto Mode",
          category: "Optimization Tiers",
          description: `Autonomous selection by task complexity · ${pool.balanced.label}`,
          onSelect: () => {
            local.model.auto.setTier("default")
            dialog.clear()
          },
        },
        {
          value: "efficiency",
          title: "Efficiency",
          category: "Optimization Tiers",
          description: `Lowest credit consumption and fastest latency · ${pool.efficiency.label}`,
          onSelect: () => {
            local.model.auto.setTier("efficiency")
            dialog.clear()
          },
        },
        {
          value: "balanced",
          title: "Balanced",
          category: "Optimization Tiers",
          description: `Optimal balance between capability and cost · ${pool.balanced.label}`,
          onSelect: () => {
            local.model.auto.setTier("balanced")
            dialog.clear()
          },
        },
        {
          value: "intelligence",
          title: "Intelligence",
          category: "Optimization Tiers",
          description: `Most capable flagship models for complex tasks · ${pool.intelligence.label}`,
          onSelect: () => {
            local.model.auto.setTier("intelligence")
            dialog.clear()
          },
        },
        {
          value: "allowed models",
          title: "Allowed Models by Provider...",
          category: "Omni Fusion Settings",
          description: `${summary} · Organized in provider columns (OpenAI, Google, OpenCode)`,
          onSelect: () => {
            dialog.push(() => <DialogFusionModels />)
          },
        },
        {
          value: "thinking routing",
          title: local.model.auto.thinkingRouting()
            ? "✓ Thinking Budget Routing: [ENABLED]"
            : "○ Thinking Budget Routing: [DISABLED]",
          category: "Omni Fusion Settings",
          description: local.model.auto.thinkingRouting()
            ? "Active: dynamically allocates reasoning effort (low on lookups, max on architecture)"
            : "Inactive: keeps fixed model reasoning budget. Click to enable",
          onSelect: () => {
            local.model.auto.toggleThinkingRouting()
          },
        },
        {
          value: "auto customizations",
          title: `Capabilities Auto-Usage: [${local.customizations.summary()}]`,
          category: "Omni Fusion Settings",
          description: "Configure which skills, agents, MCPs, hooks and mods the AI uses autonomously",
          onSelect: () => {
            dialog.push(() => <DialogAutoCustomizations />)
          },
        },
      ]
    }

    return [
      {
        value: "default",
        title: "Default",
        category: "Model Variants",
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
          category: "Model Variants",
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
      title={local.model.auto.enabled() ? "Select Model Variant — Omni Fusion" : "Select Model Variant"}
      renderFilter={!newDesigns()}
      current={local.model.variant.current() ?? (local.model.auto.enabled() ? "auto mode" : "default")}
      flat={false}
    />
  )
}
