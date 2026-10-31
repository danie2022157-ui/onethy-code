import { createMemo, createSignal, Show } from "solid-js"
import { useData } from "../context/data"
import { useLocal } from "../context/local"
import { useLocation } from "../context/location"
import { DialogSelect } from "../ui/dialog-select"
import { DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { DialogMcp } from "./dialog-mcp"

export type CustomizationFilter =
  | "all"
  | "skills"
  | "hooks"
  | "mods"
  | "settings"
  | "commands"
  | "agents"
  | "mcps"

type CustomizationItem = {
  id: string
  kind: "agent" | "skill" | "hook" | "mod" | "setting" | "command" | "mcp"
  title: string
  description: string
  category: string
  footer: string
  content?: string
}

export function DialogCustomizations(props: { filter?: CustomizationFilter } = {}) {
  const data = useData()
  const local = useLocal()
  const location = useLocation()
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const [selectedDetail, setSelectedDetail] = createSignal<CustomizationItem | undefined>(undefined)

  const currentRef = () => location.ref ?? data.location.default()

  const allItems = createMemo((): CustomizationItem[] => {
    const items: CustomizationItem[] = []
    const filter = props.filter ?? "all"

    if (filter === "all" || filter === "agents") {
      const agents = local.agent.all ? local.agent.all() : local.agent.list()
      for (const agent of agents) {
        items.push({
          id: `agent:${agent.id}`,
          kind: "agent",
          title: `@${agent.id}`,
          description: agent.description ?? "Agente especialista",
          category: agent.mode === "subagent" ? "Agentes Especialistas (@)" : "Agentes Principais",
          footer: agent.model ? `[${agent.model.providerID}/${agent.model.id}]` : "[Agente]",
          content: agent.system,
        })
      }
    }

    if (
      filter === "all" ||
      filter === "skills" ||
      filter === "hooks" ||
      filter === "mods" ||
      filter === "settings"
    ) {
      const skills = data.location.skill.list(currentRef()) ?? []
      for (const skill of skills) {
        const isHook = skill.id.startsWith("hook-") || skill.name.startsWith("hook-")
        const isMod = skill.id.startsWith("mod-") || skill.name.startsWith("mod-")
        const isSetting = skill.id.startsWith("setting-") || skill.name.startsWith("setting-")

        if (filter === "hooks" && !isHook) continue
        if (filter === "mods" && !isMod) continue
        if (filter === "settings" && !isSetting) continue
        if (filter === "skills" && (isHook || isMod || isSetting)) continue

        const kind = isHook ? "hook" : isMod ? "mod" : isSetting ? "setting" : "skill"
        const category = isHook
          ? "Ganchos / Hooks"
          : isMod
            ? "Mods e Plugins"
            : isSetting
              ? "Presets e Modos (Settings)"
              : "Skills (@)"
        const badge = isHook ? "[Hook]" : isMod ? "[Mod/Plugin]" : isSetting ? "[Setting]" : "[Skill]"

        items.push({
          id: `skill:${skill.id}`,
          kind,
          title: `@${skill.id}`,
          description: skill.description ?? skill.name,
          category,
          footer: badge,
          content: skill.content,
        })
      }
    }

    if (filter === "all" || filter === "commands") {
      const commands = data.location.command.list(currentRef()) ?? []
      for (const cmd of commands) {
        const isLoop = cmd.name.startsWith("loop-")
        const isHookCmd = cmd.name.startsWith("hook-")
        items.push({
          id: `cmd:${cmd.name}`,
          kind: "command",
          title: `/${cmd.name}`,
          description: cmd.description ?? `Comando /${cmd.name}`,
          category: isLoop
            ? "Loops de Verificação (/loop-*)"
            : isHookCmd
              ? "Comandos de Ganchos (/hook-*)"
              : "Comandos Slash (/)",
          footer: isLoop ? "[Loop]" : isHookCmd ? "[Hook Cmd]" : "[Comando]",
        })
      }
    }

    if (filter === "all" || filter === "mcps") {
      const mcps = data.location.mcp.server.list(currentRef()) ?? []
      for (const srv of mcps) {
        items.push({
          id: `mcp:${srv.name}`,
          kind: "mcp",
          title: srv.name,
          description: `Servidor MCP (${srv.status.status})`,
          category: "Servidores MCP",
          footer: `[MCP: ${srv.status.status}]`,
        })
      }
    }

    return items
  })

  const dialogTitle = createMemo(() => {
    const count = allItems().length
    switch (props.filter) {
      case "skills":
        return `Skills Instaladas (${count})`
      case "hooks":
        return `Ganchos / Hooks (${count})`
      case "mods":
        return `Mods e Plugins (${count})`
      case "settings":
        return `Settings e Modos (${count})`
      case "commands":
        return `Comandos e Loops (${count})`
      case "agents":
        return `Agentes e Especialistas (${count})`
      case "mcps":
        return `Servidores MCP (${count})`
      default:
        return `Central de Personalizações OnethyCode (${count} itens ativos)`
    }
  })

  const options = createMemo(() =>
    allItems().map((item) => ({
      value: item.id,
      title: item.title,
      description: item.description,
      category: item.category,
      footer: item.footer,
    })),
  )

  return (
    <Show
      when={selectedDetail()}
      fallback={
        <DialogSelect
          title={dialogTitle()}
          searchInTitle
          titlePlaceholder="Buscar agentes, skills, plugins, mods, hooks, comandos ou MCPs..."
          options={options()}
          onSelect={(opt) => {
            const found = allItems().find((i) => i.id === opt.value)
            if (!found) return
            if (found.kind === "agent") {
              const agentId = found.id.replace(/^agent:/, "")
              local.agent.set(agentId)
              dialog.clear()
              toast.show({ variant: "info", message: `Agente selecionado: @${agentId}` })
              return
            }
            if (found.kind === "mcp") {
              const mcpName = found.id.replace(/^mcp:/, "")
              dialog.replace(() => <DialogMcp initialServer={mcpName} />)
              return
            }
            if (found.content) {
              setSelectedDetail(found)
              return
            }
            dialog.clear()
            toast.show({
              variant: "info",
              message: `Use ${found.title} diretamente no chat para acionar este recurso.`,
            })
          }}
        />
      }
    >
      {(detail) => (
        <DialogLayout header={<DialogHeader title={`${detail().title} — ${detail().category}`} />}>
          <box flexDirection="column" gap={1}>
            <text fg={theme.text.muted}>{detail().description}</text>
            <text fg={theme.text.base} wrapMode="word">
              {(detail().content ?? "").slice(0, 1800)}
            </text>
            <text fg={theme.text.muted}>
              Dica: Digite {detail().title} no chat para usar esta personalização. Pressione ESC para fechar.
            </text>
          </box>
        </DialogLayout>
      )}
    </Show>
  )
}

