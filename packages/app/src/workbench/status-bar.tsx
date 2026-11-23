import { createMemo, createResource, Show, untrack } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { useTheme } from "@opencode/ui/theme/context"
import { useDialog } from "@opencode/ui/context/dialog"
import { getFilename } from "@opencode/util/path"
import { useFusion } from "@/providers/models/fusion"
import { BoltIcon } from "@/providers/models/fusion-icons"
import { ModelsProvider } from "@/providers/models/models"
import { LocalProvider } from "@/providers/models/selection"
import { ServerProvider } from "@/runtime/server/current"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { LocationProvider } from "@/workspaces/location"
import { showToast } from "@/shell/notifications/toast"
import { useWorkbench } from "./state"
import {
  AgentsIcon,
  GitBranchIcon,
  McpPlugIcon,
  MoonModeIcon,
  OnethyLogoMark,
  PanelBottomIcon,
  SunModeIcon,
} from "./icons"

export function WorkbenchStatusBar() {
  const workbench = useWorkbench()
  const theme = useTheme()
  const dialog = useDialog()
  const fusion = useFusion()
  const { tr, locale } = useOnethyI18n()

  const projectName = createMemo(() => {
    const dir = workbench.activeDirectory()
    if (!dir) return tr("No workspace", "Sem workspace")
    return getFilename(dir) || dir
  })

  const [vcsInfo] = createResource(
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
      if (!ctx || !dir) return { branch: undefined, changes: 0 }
      const loc = { directory: dir }
      const [info, status] = await Promise.all([
        ctx.sdk.api.vcs.get({ location: loc }).catch(() => undefined),
        ctx.sdk.api.vcs.status({ location: loc }).catch(() => undefined),
      ])
      return {
        branch: info?.data.branch.current ?? info?.data.branch.default,
        changes: status?.data.length ?? 0,
      }
    },
  )

  const mcpSummary = createMemo(() => {
    const ctx = workbench.activeServerCtx()
    if (!ctx) return { connected: 0, total: 0, issues: 0 }
    const loc = workbench.activeLocation() ?? ctx.data.location.default()
    const servers = ctx.data.location.mcp.server.list(loc) ?? []
    const connected = servers.filter((srv) => srv.status.status === "connected").length
    const issues = servers.filter(
      (srv) => srv.status.status === "failed" || srv.status.status === "needs_auth",
    ).length
    return { connected, total: servers.length, issues }
  })

  const errorCount = createMemo(() => workbench.problems().filter((p) => p.severity === "error").length)
  const warningCount = createMemo(() => workbench.problems().filter((p) => p.severity === "warning").length)

  const isRunning = createMemo(() => {
    const ctx = workbench.activeServerCtx()
    const id = workbench.activeSessionID()
    if (!ctx || !id) return false
    return ctx.data.session.status(id) === "running"
  })

  const activeModelLabel = createMemo(() => {
    if (fusion.enabled()) return `Auto · ${fusion.tierLabel(undefined, locale())}`
    const model = workbench.activeModel()
    if (!model) return tr("Select model", "Selecionar modelo")
    return model.name || model.modelID
  })

  const activeProviderLabel = createMemo(() => {
    if (fusion.enabled()) return "Omni Fusion"
    return workbench.activeModel()?.providerID ?? ""
  })

  const openStatusDialog = async () => {
    const { DialogSystemStatus } = await import("./dialogs/status-dialog")
    void dialog.show(() => <DialogSystemStatus onClose={() => dialog.close()} />)
  }

  const openFusionDialog = async () => {
    const conn = workbench.activeServer()
    const dir = workbench.activeDirectory()
    if (!conn || !dir) {
      showToast({
        variant: "error",
        title: tr(
          "Select an active workspace to configure Omni Fusion",
          "Selecione um workspace ativo para configurar o Omni Fusion",
        ),
      })
      return
    }
    const { DialogFusionModels } = await import("@/providers/models/fusion-dialog")
    void dialog.show(() => (
      <ServerProvider conn={conn}>
        <ModelsProvider directory={dir}>
          <LocationProvider directory={dir}>
            <LocalProvider>
              <DialogFusionModels onClose={() => dialog.close()} />
            </LocalProvider>
          </LocationProvider>
        </ModelsProvider>
      </ServerProvider>
    ))
  }

  const toggleColorMode = () => {
    theme.setColorScheme(theme.mode() === "dark" ? "light" : "dark")
  }

  return (
    <footer
      data-slot="workbench-status-bar"
      aria-label={tr("Onethy Code Status Bar", "Barra de Status do Onethy Code")}
      class="z-20 flex shrink-0 items-center justify-between gap-2 px-2 select-none"
    >
      <div class="flex min-w-0 items-center gap-0.5 overflow-hidden">
        <Tooltip placement="top" value={tr("Onethy Code System Status (/status)", "Status do Sistema Onethy Code (/status)")}>
          <button
            type="button"
            data-slot="workbench-status-item"
            class="font-medium text-v2-text-text-accent"
            onClick={() => void openStatusDialog()}
          >
            <OnethyLogoMark size={13} />
            <span class="max-w-[140px] truncate text-v2-text-text-base">{projectName()}</span>
          </button>
        </Tooltip>

        <Show when={vcsInfo()?.branch}>
          <Tooltip placement="top" value={tr("Git & Worktrees (Ctrl+Shift+G)", "Git & Worktrees (Ctrl+Shift+G)")}>
            <button
              type="button"
              data-slot="workbench-status-item"
              onClick={() => workbench.openActivity("git")}
            >
              <GitBranchIcon size={12} />
              <span class="max-w-[120px] truncate">{vcsInfo()?.branch}</span>
              <Show when={(vcsInfo()?.changes ?? 0) > 0}>
                <span class="rounded bg-v2-background-bg-layer-02 px-1 py-0.5 text-[10px] font-medium text-v2-text-text-accent">
                  {vcsInfo()?.changes}
                </span>
              </Show>
            </button>
          </Tooltip>
        </Show>

        <Tooltip placement="top" value={tr("Problems & Diagnostics (Ctrl+Shift+M)", "Problemas e Diagnósticos (Ctrl+Shift+M)")}>
          <button
            type="button"
            data-slot="workbench-status-item"
            onClick={() => workbench.toggleBottom("problems")}
          >
            <Icon
              name="circle-xmark"
              size="small"
              class={errorCount() > 0 ? "text-v2-state-fg-danger" : "text-v2-icon-icon-muted"}
            />
            <span class={errorCount() > 0 ? "text-v2-state-fg-danger font-medium" : ""}>{errorCount()}</span>
            <Icon
              name="outline-hexagonal-warning"
              size="small"
              class={warningCount() > 0 ? "text-v2-state-fg-warning" : "text-v2-icon-icon-muted"}
            />
            <span class={warningCount() > 0 ? "text-v2-state-fg-warning font-medium" : ""}>{warningCount()}</span>
          </button>
        </Tooltip>

        <Tooltip placement="top" value={tr("Agents, Subagents & Approvals (Ctrl+Shift+A)", "Agentes, Subagentes e Aprovações (Ctrl+Shift+A)")}>
          <button
            type="button"
            data-slot="workbench-status-item"
            onClick={() => workbench.openActivity("agents")}
          >
            <Show when={isRunning()} fallback={<AgentsIcon size={12} />}>
              <span class="onethy-pulse-dot inline-block size-2 rounded-full bg-v2-background-bg-accent" />
            </Show>
            <span class="truncate">
              {workbench.activeAgent() ? `@${workbench.activeAgent()}` : tr("Agent", "Agente")}
              {isRunning() ? tr(" · running", " · executando") : ""}
            </span>
          </button>
        </Tooltip>
      </div>

      <div class="flex shrink-0 items-center gap-0.5">
        <Show when={workbench.contextPercent() !== undefined}>
          <Tooltip placement="top" value={tr("Session Context Window Usage", "Uso da Janela de Contexto da Sessão")}>
            <span data-slot="workbench-status-item" class="cursor-default">
              <span>{tr("Context", "Contexto")}</span>
              <span class="font-mono font-medium text-v2-text-text-base">{Math.round(workbench.contextPercent() ?? 0)}%</span>
            </span>
          </Tooltip>
        </Show>

        <Tooltip placement="top" value={tr("Manage MCP Servers", "Gerenciar Servidores MCP")}>
          <button
            type="button"
            data-slot="workbench-status-item"
            onClick={() => workbench.openActivity("mcp")}
          >
            <McpPlugIcon
              size={12}
              class={
                mcpSummary().issues > 0
                  ? "text-v2-state-fg-danger"
                  : mcpSummary().connected > 0
                    ? "text-v2-state-fg-success"
                    : "text-v2-icon-icon-muted"
              }
            />
            <span>
              MCP {mcpSummary().connected}/{mcpSummary().total}
            </span>
          </button>
        </Tooltip>

        <Tooltip placement="top" value={tr("Active Model & Omni Fusion (Auto Mode)", "Modelo Ativo & Omni Fusion (Auto Mode)")}>
          <button
            type="button"
            data-slot="workbench-status-item"
            class={fusion.enabled() ? "text-v2-text-text-accent" : ""}
            onClick={() => void openFusionDialog()}
          >
            <Show when={fusion.enabled()}>
              <BoltIcon class="size-3 text-v2-text-text-accent" />
            </Show>
            <span class="max-w-[170px] truncate font-medium">{activeModelLabel()}</span>
            <Show when={activeProviderLabel()}>
              <span class="hidden text-[10px] opacity-65 sm:inline">· {activeProviderLabel()}</span>
            </Show>
          </button>
        </Tooltip>

        <Tooltip placement="top" value={tr("Toggle Bottom Panel (Ctrl+`)", "Alternar Painel Inferior (Ctrl+`)")}>
          <button
            type="button"
            data-slot="workbench-status-item"
            class={workbench.bottomOpen() ? "text-v2-text-text-accent" : ""}
            aria-pressed={workbench.bottomOpen()}
            onClick={() => workbench.toggleBottom()}
          >
            <PanelBottomIcon size={12} />
            <span class="hidden md:inline">{tr("Panel", "Painel")}</span>
          </button>
        </Tooltip>

        <Tooltip
          placement="top"
          value={tr(
            "Switch to {{target}} mode · Theme: {{theme}}",
            "Alternar para modo {{target}} · Tema: {{theme}}",
            {
              target: theme.mode() === "dark" ? tr("light (Porcelain)", "claro (Porcelain)") : tr("dark (Obsidian)", "escuro (Obsidian)"),
              theme: theme.name(theme.themeId()),
            },
          )}
        >
          <button
            type="button"
            data-slot="workbench-status-item"
            aria-label={tr("Toggle light/dark mode", "Alternar tema claro/escuro")}
            onClick={toggleColorMode}
          >
            <Show when={theme.mode() === "dark"} fallback={<MoonModeIcon size={12} />}>
              <SunModeIcon size={12} />
            </Show>
            <span class="hidden lg:inline">{theme.mode() === "dark" ? tr("Dark", "Escuro") : tr("Light", "Claro")}</span>
          </button>
        </Tooltip>
      </div>
    </footer>
  )
}
