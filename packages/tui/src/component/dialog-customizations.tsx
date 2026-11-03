import { createMemo, createSignal, Show } from "solid-js"
import { useData } from "../context/data"
import { useLocal } from "../context/local"
import { useLocation } from "../context/location"
import { DialogSelect } from "../ui/dialog-select"
import { DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { DialogMcp } from "./dialog-mcp"
import { DialogAutoCustomizations } from "./dialog-auto-customizations"

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

    if (filter === "all" || filter === "settings" || filter === "agents") {
      items.push({
        id: "cfg:auto-customizations",
        kind: "setting",
        title: "⚙️ Configure Auto-Resource Management...",
        description: `Status: ${local.customizations.summary()} · Choose which skills, agents, MCPs, hooks and mods the AI uses automatically`,
        category: "⚡ Auto-Orchestration",
        footer: "[Configure]",
      })
    }

    if (filter === "all" || filter === "agents") {
      const agents = local.agent.all ? local.agent.all() : local.agent.list()
      for (const agent of agents) {
        items.push({
          id: `agent:${agent.id}`,
          kind: "agent",
          title: `@${agent.id}`,
          description: agent.description ?? "Specialist agent",
          category: agent.mode === "subagent" ? "Specialist Agents (@)" : "Primary Agents",
          footer: agent.model ? `[${agent.model.providerID}/${agent.model.id}]` : "[Agent]",
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
          ? "Hooks"
          : isMod
            ? "Mods and Plugins"
            : isSetting
              ? "Presets and Settings"
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
          description: cmd.description ?? `Command /${cmd.name}`,
          category: isLoop
            ? "Verification Loops (/loop-*)"
            : isHookCmd
              ? "Hook Commands (/hook-*)"
              : "Slash Commands (/)",
          footer: isLoop ? "[Loop]" : isHookCmd ? "[Hook Cmd]" : "[Command]",
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
          description: `MCP Server (${srv.status.status})`,
          category: "MCP Servers",
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
        return `Installed Skills (${count})`
      case "hooks":
        return `Hooks (${count})`
      case "mods":
        return `Mods and Plugins (${count})`
      case "settings":
        return `Settings and Modes (${count})`
      case "commands":
        return `Commands and Loops (${count})`
      case "agents":
        return `Agents and Specialists (${count})`
      case "mcps":
        return `MCP Servers (${count})`
      default:
        return `OnethyCode Customizations Hub (${count} active items)`
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
          titlePlaceholder="Search agents, skills, plugins, mods, hooks, commands or MCPs..."
          options={options()}
          onSelect={(opt) => {
            const found = allItems().find((i) => i.id === opt.value)
            if (!found) return
            if (found.id === "cfg:auto-customizations") {
              dialog.replace(() => <DialogAutoCustomizations />)
              return
            }
            if (found.kind === "agent") {
              const agentId = found.id.replace(/^agent:/, "")
              local.agent.set(agentId)
              dialog.clear()
              toast.show({ variant: "info", message: `Agent selected: @${agentId}` })
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
              message: `Use ${found.title} directly in the prompt to activate this resource.`,
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
              Tip: Type {detail().title} in prompt to use this customization. Press ESC to close.
            </text>
          </box>
        </DialogLayout>
      )}
    </Show>
  )
}

