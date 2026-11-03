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
        category: item.mode === "subagent" ? "Specialists and Subagents" : "Primary Agents",
        footer: modelName ? `[${modelName}]` : undefined,
      }
    })

    return [
      {
        value: "cfg:auto-customizations",
        title: "⚙️ Configure Auto-Resource Management & Skills...",
        description: `Status: ${local.customizations.summary()} · Configure whether AI automatically activates agents and skills`,
        category: "⚡ Auto-Orchestration",
        footer: "[Configure]",
      },
      ...agentOptions,
    ]
  })

  return (
    <DialogSelect
      title="Select agent"
      searchInTitle
      titlePlaceholder="Search agents..."
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
