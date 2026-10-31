import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { useData } from "../context/data"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { DialogAutoCustomizations } from "./dialog-auto-customizations"

export function DialogAgent() {
  const local = useLocal()
  const data = useData()
  const dialog = useDialog()

  const options = createMemo(() => {
    const models = data.location.model.list() ?? []
    const currentModel = local.model.current()
    const allAgents = local.agent.all ? local.agent.all() : local.agent.list()
    const agentOptions = allAgents.map((item) => {
      const ref = item.model ?? (currentModel ? { providerID: currentModel.providerID, id: currentModel.modelID } : undefined)
      const modelName = ref
        ? (models.find((m) => m.providerID === ref.providerID && m.id === ref.id)?.name ?? `${ref.providerID}/${ref.id}`)
        : undefined
      return {
        value: item.id,
        title: item.id,
        description: item.description,
        category: item.mode === "subagent" ? "Especialistas e Subagentes" : "Agentes Principais",
        footer: modelName ? `[${modelName}]` : undefined,
      }
    })

    return [
      {
        value: "cfg:auto-customizations",
        title: "⚙️ Configurar Auto-Uso de Customizações & Skills...",
        description: `Status: ${local.customizations.summary()} · Definir se a IA deve usar agentes e skills automaticamente`,
        category: "⚡ Orquestração Automática",
        footer: "[Configurar]",
      },
      ...agentOptions,
    ]
  })

  return (
    <DialogSelect
      title="Selecionar agente"
      searchInTitle
      titlePlaceholder="Buscar agentes..."
      current={local.agent.current()?.id}
      options={options()}
      onSelect={(option) => {
        if (option.value === "cfg:auto-customizations") {
          dialog.replace(() => <DialogAutoCustomizations />)
          return
        }
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
