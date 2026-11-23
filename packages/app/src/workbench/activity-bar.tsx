import { createMemo, createResource, For, Show, untrack, type Component } from "solid-js"
import { Tooltip } from "@opencode/ui/tooltip"
import { useDialog } from "@opencode/ui/context/dialog"
import { useSettingsDialog } from "@/settings/command"
import { ServerProvider } from "@/runtime/server/current"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { showToast } from "@/shell/notifications/toast"
import { useWorkbench, type ActivityView } from "./state"
import {
  AgentsIcon,
  ExplorerIcon,
  ExtensionsBlocksIcon,
  GitBranchIcon,
  McpPlugIcon,
  MemoryDbIcon,
  ModelsChipIcon,
  SearchCodeIcon,
  SessionsIcon,
  SettingsGearIcon,
  SkillsSparkIcon,
} from "./icons"

type ActivityItem = {
  id: ActivityView
  en: string
  pt: string
  shortcut: string
  icon: Component<{ class?: string; size?: number }>
}

const ITEMS: readonly ActivityItem[] = [
  { id: "explorer", en: "Explorer", pt: "Explorer", shortcut: "Ctrl+Shift+E", icon: ExplorerIcon },
  { id: "search", en: "Global Search", pt: "Busca Global", shortcut: "Ctrl+Shift+F", icon: SearchCodeIcon },
  { id: "git", en: "Git & Worktrees", pt: "Git & Worktrees", shortcut: "Ctrl+Shift+G", icon: GitBranchIcon },
  { id: "agents", en: "Agents & Approvals", pt: "Agentes & Aprovações", shortcut: "Ctrl+Shift+A", icon: AgentsIcon },
  { id: "sessions", en: "Sessions & Projects", pt: "Sessões & Projetos", shortcut: "Ctrl+Shift+S", icon: SessionsIcon },
  { id: "mcp", en: "MCP Servers", pt: "Servidores MCP", shortcut: "Ctrl+Shift+P", icon: McpPlugIcon },
  { id: "skills", en: "Skills & Customizations", pt: "Skills & Customizações", shortcut: "Ctrl+Shift+K", icon: SkillsSparkIcon },
  { id: "extensions", en: "Extensions & Plugins", pt: "Extensões & Plugins", shortcut: "Ctrl+Shift+X", icon: ExtensionsBlocksIcon },
  { id: "models", en: "Models & Omni Fusion", pt: "Modelos & Omni Fusion", shortcut: "Ctrl+Shift+L", icon: ModelsChipIcon },
]

export function ActivityBar() {
  const workbench = useWorkbench()
  const dialog = useDialog()
  const openSettings = useSettingsDialog()
  const { tr } = useOnethyI18n()

  const [gitCount] = createResource(
    () => {
      const ctx = workbench.activeServerCtx()
      const dir = workbench.activeDirectory()
      const rev = workbench.gitRevision()
      if (!ctx || !dir) return undefined
      return `${ctx.sdk.url}\0${dir}\0${rev}`
    },
    async () => {
      const ctx = untrack(workbench.activeServerCtx)
      const dir = untrack(workbench.activeDirectory)
      if (!ctx || !dir) return 0
      const res = await ctx.sdk.api.vcs.status({ location: { directory: dir } }).catch(() => undefined)
      return res?.data.length ?? 0
    },
  )

  const [pendingPermissions] = createResource(
    () => {
      const ctx = workbench.activeServerCtx()
      const dir = workbench.activeDirectory()
      const session = workbench.activeSessionID() ?? ""
      if (!ctx || !dir) return undefined
      return `${ctx.sdk.url}\0${dir}\0${session}`
    },
    async () => {
      const ctx = untrack(workbench.activeServerCtx)
      const dir = untrack(workbench.activeDirectory)
      if (!ctx || !dir) return 0
      const res = await ctx.sdk.api.permission.request.list({ location: { directory: dir } }).catch(() => undefined)
      return res?.data.length ?? 0
    },
  )

  const mcpAlertCount = createMemo(() => {
    const ctx = workbench.activeServerCtx()
    if (!ctx) return 0
    const loc = workbench.activeLocation() ?? ctx.data.location.default()
    const list = ctx.data.location.mcp.server.list(loc) ?? []
    return list.filter((srv) => srv.status.status === "failed" || srv.status.status === "needs_auth").length
  })

  const openMemoryBank = async () => {
    const conn = workbench.activeServer()
    if (!conn) {
      showToast({
        variant: "error",
        title: tr("No connected server to open Memory Bank", "Nenhum servidor conectado para abrir o Memory Bank"),
      })
      return
    }
    const dir = workbench.activeDirectory()
    const { DialogMemoryBank } = await import("@/memory-bank/dialog")
    void dialog.show(() => (
      <ServerProvider conn={conn}>
        <DialogMemoryBank directory={dir} onClose={() => dialog.close()} />
      </ServerProvider>
    ))
  }

  const badgeFor = (id: ActivityView) => {
    if (id === "git") {
      const count = gitCount() ?? 0
      return count > 0 ? { text: count > 99 ? "99+" : String(count), tone: "accent" as const } : undefined
    }
    if (id === "agents") {
      const count = pendingPermissions() ?? 0
      return count > 0 ? { text: String(count), tone: "warning" as const } : undefined
    }
    if (id === "mcp") {
      const count = mcpAlertCount()
      return count > 0 ? { text: String(count), tone: "danger" as const } : undefined
    }
    return undefined
  }

  return (
    <nav
      data-slot="workbench-activity-bar"
      aria-label={tr("Onethy Code Activity Bar", "Barra de Atividades do Onethy Code")}
      class="flex shrink-0 flex-col items-center justify-between py-2 select-none"
    >
      <div class="flex flex-col items-center gap-1">
        <For each={ITEMS}>
          {(item) => {
            const IconComp = item.icon
            const isActive = () => workbench.sidebarOpen() && workbench.activity() === item.id
            const badge = () => badgeFor(item.id)
            const label = () => tr(item.en, item.pt)

            return (
              <Tooltip
                placement="right"
                value={
                  <span class="flex items-center gap-2">
                    <span>{label()}</span>
                    <span class="opacity-65 text-[10px]">{item.shortcut}</span>
                  </span>
                }
              >
                <button
                  type="button"
                  data-slot="workbench-activity-item"
                  data-activity={item.id}
                  data-active={isActive() ? "true" : "false"}
                  aria-label={label()}
                  aria-pressed={isActive()}
                  onClick={() => workbench.toggleSidebar(item.id)}
                >
                  <IconComp size={17} />
                  <Show when={badge()}>
                    {(b) => (
                      <span
                        class="pointer-events-none absolute -end-0.5 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none"
                        classList={{
                          "bg-v2-background-bg-accent text-v2-text-text-inverse": b().tone === "accent",
                          "bg-v2-state-fg-warning text-v2-text-text-inverse": b().tone === "warning",
                          "bg-v2-state-fg-danger text-v2-text-text-inverse": b().tone === "danger",
                        }}
                      >
                        {b().text}
                      </span>
                    )}
                  </Show>
                </button>
              </Tooltip>
            )
          }}
        </For>
      </div>

      <div class="flex flex-col items-center gap-1 border-t border-v2-border-border-muted pt-2">
        <Tooltip placement="right" value={tr("Memory Bank (/memory)", "Memory Bank (/memory)")}>
          <button
            type="button"
            data-slot="workbench-activity-item"
            aria-label="Memory Bank"
            onClick={() => void openMemoryBank()}
          >
            <MemoryDbIcon size={17} />
          </button>
        </Tooltip>

        <Tooltip placement="right" value={tr("Settings (Ctrl+,)", "Configurações (Ctrl+,)")}>
          <button
            type="button"
            data-slot="workbench-activity-item"
            aria-label={tr("Settings", "Configurações")}
            onClick={() => openSettings()}
          >
            <SettingsGearIcon size={17} />
          </button>
        </Tooltip>
      </div>
    </nav>
  )
}
