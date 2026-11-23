import { createMemo, createResource, createSignal, For, Match, Show, Switch, untrack, type Component } from "solid-js"
import type {
  AgentInfo,
  CommandInfo,
  IntegrationInfo,
  McpServer,
  PluginInfo,
  ProviderInfo,
  ServerInfo,
  SkillInfo,
} from "@opencode/client/promise"
import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { useTheme } from "@opencode/ui/theme/context"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"
import {
  AgentsIcon,
  CheckShieldIcon,
  ExtensionsBlocksIcon,
  LogsStreamIcon,
  McpPlugIcon,
  ModelsChipIcon,
  MoonModeIcon,
  OnethyLogoMark,
  SkillsSparkIcon,
  SunModeIcon,
} from "../icons"
import { useWorkbench } from "../state"

type StatusSnapshot = {
  readonly server?: ServerInfo
  readonly providers: readonly ProviderInfo[]
  readonly integrations: readonly IntegrationInfo[]
  readonly mcps: readonly McpServer[]
  readonly plugins: readonly PluginInfo[]
  readonly skills: readonly SkillInfo[]
  readonly agents: readonly AgentInfo[]
  readonly commands: readonly CommandInfo[]
  readonly fetchedAt: number
}

type ConnectionTone = "success" | "warning" | "danger" | "muted"

function connectionTone(status: string | undefined): ConnectionTone {
  if (status === "connected") return "success"
  if (status === "connecting" || status === "reconnecting") return "warning"
  if (status === "disconnected") return "danger"
  return "muted"
}

function osLabel(os: string | undefined) {
  if (os === "windows") return "Windows"
  if (os === "macos") return "macOS"
  if (os === "linux") return "Linux"
  return "Web"
}

function mcpDotClass(status: McpServer["status"]["status"]) {
  if (status === "connected") return "bg-emerald-500"
  if (status === "failed") return "bg-red-500"
  if (status === "needs_auth") return "bg-amber-500"
  if (status === "standby") return "bg-sky-500"
  return "bg-v2-icon-icon-muted opacity-60"
}

function mcpStatusToneClass(status: McpServer["status"]["status"]) {
  if (status === "connected") return "text-v2-state-fg-success"
  if (status === "failed") return "text-v2-state-fg-danger"
  if (status === "needs_auth") return "text-v2-state-fg-warning"
  return "text-v2-text-text-muted"
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export const DialogSystemStatus: Component<{ onClose: () => void }> = (props) => {
  const { tr } = useOnethyI18n()
  const workbench = useWorkbench()
  const platform = usePlatform()
  const theme = useTheme()

  const [refreshTick, setRefreshTick] = createSignal(0)
  const [reloading, setReloading] = createSignal(false)
  const [exporting, setExporting] = createSignal(false)
  const [restarting, setRestarting] = createSignal(false)

  const [snapshot] = createResource(
    () => {
      const ctx = workbench.activeServerCtx()
      const dir = workbench.activeDirectory() ?? ""
      const tick = refreshTick()
      if (!ctx) return undefined
      return `${ctx.sdk.url}\0${dir}\0${tick}`
    },
    async (): Promise<StatusSnapshot> => {
      const ctx = untrack(workbench.activeServerCtx)
      if (!ctx) {
        return {
          providers: [],
          integrations: [],
          mcps: [],
          plugins: [],
          skills: [],
          agents: [],
          commands: [],
          fetchedAt: Date.now(),
        }
      }
      const loc = untrack(workbench.activeLocation)
      const location = loc ?? ctx.data.location.default()
      const [server, providers, integrations, mcps, plugins, skills, agents, commands] = await Promise.all([
        ctx.sdk.api.server.info().catch(() => undefined),
        ctx.sdk.api.provider.list({ location }).catch(() => undefined),
        ctx.sdk.api.integration.list({ location }).catch(() => undefined),
        ctx.sdk.api.mcp.list({ location }).catch(() => undefined),
        ctx.sdk.api.plugin.list({ location }).catch(() => undefined),
        ctx.sdk.api.skill.list({ location }).catch(() => undefined),
        ctx.sdk.api.agent.list({ location }).catch(() => undefined),
        ctx.sdk.api.command.list({ location }).catch(() => undefined),
      ])

      return {
        server,
        providers: providers?.data ?? [],
        integrations: integrations?.data ?? [],
        mcps: mcps?.data ?? ctx.data.location.mcp.server.list(location) ?? [],
        plugins: plugins?.data ?? [],
        skills: skills?.data ?? ctx.data.location.skill.list(location) ?? [],
        agents: agents?.data ?? ctx.data.location.agent.list(location) ?? [],
        commands: commands?.data ?? ctx.data.location.command.list(location) ?? [],
        fetchedAt: Date.now(),
      }
    },
  )

  const colorSchemeLabel = (scheme: string) => {
    if (scheme === "system") return tr("System", "Sistema")
    if (scheme === "dark") return tr("Dark", "Escuro")
    return tr("Light", "Claro")
  }

  const connection = createMemo(() => {
    const status = workbench.activeServerCtx()?.sdk.connection.status()
    const tone = connectionTone(status)
    if (status === "connected") return { label: tr("Connected", "Conectado"), tone }
    if (status === "connecting") return { label: tr("Connecting", "Conectando"), tone }
    if (status === "reconnecting") return { label: tr("Reconnecting", "Reconectando"), tone }
    if (status === "disconnected") return { label: tr("Disconnected", "Desconectado"), tone }
    return { label: tr("No server", "Sem servidor"), tone }
  })

  const connectionError = createMemo(() => workbench.activeServerCtx()?.sdk.connection.error())

  const workspaceDir = createMemo(() => {
    const dir = workbench.activeDirectory()
    if (dir) return dir
    return workbench.activeServerCtx()?.data.location.default().directory
  })

  const mcps = createMemo<readonly McpServer[]>(() => {
    const data = snapshot()
    if (data) return data.mcps
    const ctx = workbench.activeServerCtx()
    if (!ctx) return []
    const loc = workbench.activeLocation() ?? ctx.data.location.default()
    return ctx.data.location.mcp.server.list(loc) ?? []
  })

  const mcpCounts = createMemo(() => {
    const list = mcps()
    const connected = list.filter((item) => item.status.status === "connected").length
    const failed = list.filter((item) => item.status.status === "failed").length
    const needsAuth = list.filter((item) => item.status.status === "needs_auth").length
    const standby = list.filter((item) => item.status.status === "standby").length
    const other = list.length - connected - failed - needsAuth - standby
    return { total: list.length, connected, failed, needsAuth, standby, other }
  })

  const providerCounts = createMemo(() => {
    const data = snapshot()
    if (!data) return { active: 0, total: 0, connectedIntegrations: 0 }
    const active = data.providers.filter((item) => item.activation !== "disabled").length
    const connectedIntegrations = data.integrations.filter((item) => item.connections.length > 0).length
    return { active, total: data.providers.length, connectedIntegrations }
  })

  const pluginCounts = createMemo(() => {
    const list = snapshot()?.plugins ?? []
    const active = list.filter((item) => item.state.status === "active").length
    const failed = list.filter((item) => item.state.status === "failed").length
    return { total: list.length, active, failed }
  })

  const customizations = createMemo(() => {
    const data = snapshot()
    const allSkills = data?.skills ?? []
    const hooks = allSkills.filter((item) => item.id.startsWith("hook-") || item.name.startsWith("hook-")).length
    const mods = allSkills.filter((item) => item.id.startsWith("mod-") || item.name.startsWith("mod-")).length
    const settings = allSkills.filter(
      (item) => item.id.startsWith("setting-") || item.name.startsWith("setting-"),
    ).length
    const pureSkills = Math.max(0, allSkills.length - hooks - mods - settings)
    const allCommands = data?.commands ?? []
    const loops = allCommands.filter((item) => item.name.startsWith("loop-")).length
    return {
      totalSkills: allSkills.length,
      pureSkills,
      hooks,
      mods,
      settings,
      agents: data?.agents.length ?? 0,
      commands: allCommands.length,
      loops,
    }
  })

  const platformSummary = createMemo(() => {
    if (platform.platform === "desktop") return `Desktop · ${osLabel(platform.os)}`
    return tr("Web Browser", "Navegador Web")
  })

  const handleRefresh = () => {
    setRefreshTick((count) => count + 1)
  }

  const handleReloadConfig = async () => {
    const ctx = workbench.activeServerCtx()
    if (!ctx || reloading()) return

    setReloading(true)
    const outcome = await ctx.sdk.api.location
      .reload()
      .then(() => ({ ok: true as const }))
      .catch((err) => ({ ok: false as const, message: errorMessage(err) }))
    setReloading(false)

    if (!outcome.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to reload configuration", "Falha ao recarregar configuração"),
        description: outcome.message,
      })
      return
    }

    setRefreshTick((count) => count + 1)
    showToast({
      variant: "success",
      title: tr("Configuration reloaded", "Configuração recarregada"),
      description: tr(
        "Providers, skills, plugins, and MCP servers have been refreshed.",
        "Provedores, skills, plugins e servidores MCP foram atualizados.",
      ),
    })
  }

  const handleOpenLogs = () => {
    workbench.openBottom("logs")
    props.onClose()
  }

  const handleOpenMcpPanel = () => {
    workbench.openActivity("mcp")
    props.onClose()
  }

  const handleExportDiagnostics = async () => {
    if (!platform.exportDebugLogs || exporting()) return

    setExporting(true)
    const outcome = await platform
      .exportDebugLogs()
      .then((filePath) => ({ ok: true as const, filePath }))
      .catch((err) => ({ ok: false as const, message: errorMessage(err) }))
    setExporting(false)

    if (!outcome.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to export diagnostics", "Falha ao exportar diagnóstico"),
        description: outcome.message,
      })
      return
    }

    showToast({
      variant: "success",
      title: tr("Diagnostics exported", "Diagnóstico exportado"),
      description: outcome.filePath || tr("Log bundle saved successfully.", "Pacote de logs salvo com sucesso."),
    })
  }

  const handleRestart = async () => {
    if (restarting()) return

    setRestarting(true)
    const outcome = await platform
      .restart()
      .then(() => ({ ok: true as const }))
      .catch((err) => ({ ok: false as const, message: errorMessage(err) }))
    setRestarting(false)

    if (!outcome.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to restart application", "Falha ao reiniciar aplicativo"),
        description: outcome.message,
      })
    }
  }

  return (
    <Dialog
      size="large"
      fit
      containerClass="!w-[min(calc(100vw_-_32px),760px)] !max-h-[min(calc(100vh_-_48px),700px)] !rounded-[12px] !bg-v2-background-bg-base"
      class="[font-family:var(--v2-font-family-sans)]"
    >
      <DialogHeader closeLabel={tr("Close", "Fechar")}>
        <div class="flex min-w-0 flex-1 items-start justify-between gap-3 pe-2">
          <div class="flex min-w-0 items-start gap-2.5">
            <div class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01 text-v2-text-text-accent">
              <OnethyLogoMark size={16} />
            </div>
            <DialogTitleGroup
              title={tr("Onethy Code System Status", "Status do Sistema Onethy Code")}
              description={tr(
                "Live telemetry for server, workspace, loaded customizations, and MCP servers",
                "Telemetria ao vivo do servidor, workspace, customizações carregadas e servidores MCP",
              )}
            />
          </div>

          <button
            type="button"
            class="mt-0.5 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2.5 text-[11.5px] font-medium text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
            disabled={snapshot.loading}
            onClick={handleRefresh}
          >
            <Show when={snapshot.loading} fallback={<Icon name="refresh" size="small" class="size-3.5" />}>
              <Loader width={12} height={12} />
            </Show>
            <span>{tr("Refresh", "Atualizar")}</span>
          </button>
        </div>
      </DialogHeader>

      <DialogBody class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-1 [scrollbar-width:thin]">
        {/* Connection & Server Overview */}
        <section class="rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-3.5">
          <div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span
                class="size-2 shrink-0 rounded-full"
                classList={{
                  "bg-emerald-500": connection().tone === "success",
                  "bg-amber-500": connection().tone === "warning",
                  "bg-red-500": connection().tone === "danger",
                  "bg-v2-icon-icon-muted opacity-60": connection().tone === "muted",
                }}
              />
              <span class="text-[12.5px] font-semibold text-v2-text-text-base">
                {tr("Server & Environment", "Servidor & Ambiente")}
              </span>
              <Badge variant={connection().tone === "success" ? "accent" : "neutral"}>{connection().label}</Badge>
            </div>
            <span class="font-mono text-[11px] text-v2-text-text-faint">{platformSummary()}</span>
          </div>

          <div class="grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
            <div class="flex flex-col gap-0.5 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-2.5 py-2">
              <span class="text-[10.5px] uppercase tracking-[0.04em] text-v2-text-text-faint">
                {tr("Versions", "Versões")}
              </span>
              <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11.5px] text-v2-text-text-base">
                <span>App {platform.version ?? "dev"}</span>
                <span class="text-v2-text-text-faint">·</span>
                <span>Core {snapshot()?.server?.version ?? "—"}</span>
                <Show when={snapshot()?.server?.pid}>
                  {(pid) => (
                    <>
                      <span class="text-v2-text-text-faint">·</span>
                      <span class="text-v2-text-text-muted">PID {pid()}</span>
                    </>
                  )}
                </Show>
              </div>
            </div>

            <div class="flex flex-col gap-0.5 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-2.5 py-2">
              <span class="text-[10.5px] uppercase tracking-[0.04em] text-v2-text-text-faint">
                {tr("Server Endpoint", "Endpoint do Servidor")}
              </span>
              <span
                class="truncate font-mono text-[11.5px] text-v2-text-text-base"
                title={workbench.activeServerCtx()?.sdk.url ?? ""}
              >
                {workbench.activeServerCtx()?.sdk.url ?? tr("No server connected", "Nenhum servidor conectado")}
              </span>
            </div>

            <div class="flex flex-col gap-0.5 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-2.5 py-2">
              <span class="text-[10.5px] uppercase tracking-[0.04em] text-v2-text-text-faint">
                {tr("Active Workspace", "Workspace Ativo")}
              </span>
              <span
                class="truncate font-mono text-[11.5px] text-v2-text-text-base"
                title={workspaceDir() ?? tr("No directory selected", "Nenhum diretório selecionado")}
              >
                {workspaceDir() ?? tr("No directory selected", "Nenhum diretório selecionado")}
              </span>
            </div>

            <div class="flex flex-col gap-0.5 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-2.5 py-2">
              <span class="text-[10.5px] uppercase tracking-[0.04em] text-v2-text-text-faint">
                {tr("Theme & Appearance", "Tema & Aparência")}
              </span>
              <div class="flex items-center gap-1.5 text-[11.5px] text-v2-text-text-base">
                <Show when={theme.mode() === "dark"} fallback={<SunModeIcon size={13} class="text-v2-text-text-accent" />}>
                  <MoonModeIcon size={13} class="text-v2-text-text-accent" />
                </Show>
                <span class="truncate font-medium">{theme.name(theme.themeId())}</span>
                <span class="text-v2-text-text-faint">·</span>
                <span class="text-v2-text-text-muted">
                  {theme.mode() === "dark" ? tr("Dark", "Escuro") : tr("Light", "Claro")} (
                  {colorSchemeLabel(theme.colorScheme())})
                </span>
              </div>
            </div>
          </div>

          <Show when={connectionError()}>
            {(err) => (
              <div class="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11.5px] text-v2-state-fg-danger">
                {err()}
              </div>
            )}
          </Show>
        </section>

        {/* Live Counters Grid */}
        <section class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div class="flex flex-col gap-1 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-2.5">
            <div class="flex items-center gap-1.5 text-[11px] text-v2-text-text-muted">
              <ModelsChipIcon size={13} class="shrink-0 text-v2-icon-icon-muted" />
              <span>{tr("Providers", "Provedores")}</span>
            </div>
            <div class="flex items-baseline gap-1.5">
              <span class="font-mono text-[18px] font-semibold leading-tight text-v2-text-text-base">
                {providerCounts().active}
              </span>
              <span class="text-[11px] text-v2-text-text-faint">
                {tr("active ({{count}} integr.)", "ativos ({{count}} integr.)", {
                  count: providerCounts().connectedIntegrations,
                })}
              </span>
            </div>
          </div>

          <div class="flex flex-col gap-1 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-2.5">
            <div class="flex items-center gap-1.5 text-[11px] text-v2-text-text-muted">
              <McpPlugIcon size={13} class="shrink-0 text-v2-icon-icon-muted" />
              <span>{tr("MCP Servers", "Servidores MCP")}</span>
            </div>
            <div class="flex items-baseline gap-1.5">
              <span class="font-mono text-[18px] font-semibold leading-tight text-v2-text-text-base">
                {mcpCounts().connected}/{mcpCounts().total}
              </span>
              <span class="text-[11px] text-v2-text-text-faint">{tr("connected", "conectados")}</span>
            </div>
          </div>

          <div class="flex flex-col gap-1 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-2.5">
            <div class="flex items-center gap-1.5 text-[11px] text-v2-text-text-muted">
              <ExtensionsBlocksIcon size={13} class="shrink-0 text-v2-icon-icon-muted" />
              <span>Plugins</span>
            </div>
            <div class="flex items-baseline gap-1.5">
              <span class="font-mono text-[18px] font-semibold leading-tight text-v2-text-text-base">
                {pluginCounts().total}
              </span>
              <span
                class="text-[11px]"
                classList={{
                  "text-v2-state-fg-danger": pluginCounts().failed > 0,
                  "text-v2-text-text-faint": pluginCounts().failed === 0,
                }}
              >
                {pluginCounts().failed > 0
                  ? tr("{{count}} with errors", "{{count}} com erro", { count: pluginCounts().failed })
                  : tr("{{count}} active", "{{count}} ativos", { count: pluginCounts().active })}
              </span>
            </div>
          </div>

          <div class="flex flex-col gap-1 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-2.5">
            <div class="flex items-center gap-1.5 text-[11px] text-v2-text-text-muted">
              <SkillsSparkIcon size={13} class="shrink-0 text-v2-icon-icon-muted" />
              <span>Skills</span>
            </div>
            <div class="flex items-baseline gap-1.5">
              <span class="font-mono text-[18px] font-semibold leading-tight text-v2-text-text-base">
                {customizations().totalSkills}
              </span>
              <span class="text-[11px] text-v2-text-text-faint">{customizations().pureSkills} skills</span>
            </div>
          </div>
        </section>

        {/* TUI /status Customizations Breakdown */}
        <section class="rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-3.5">
          <div class="mb-2 flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 text-[12.5px] font-semibold text-v2-text-text-base">
              <AgentsIcon size={14} class="text-v2-icon-icon-muted" />
              <span>{tr("Live Loaded Customizations", "Customizações Carregadas em Tempo Real")}</span>
            </div>
            <Show when={snapshot()?.server?.capabilities?.persistentPty}>
              <Badge variant="subtle">{tr("Persistent PTY", "PTY Persistente")}</Badge>
            </Show>
          </div>

          <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-3">
            <div class="flex items-center justify-between rounded-md bg-v2-background-bg-base px-2.5 py-1.5">
              <span class="text-v2-text-text-muted">{tr("Agents (@)", "Agentes (@)")}</span>
              <span class="font-mono font-semibold text-v2-text-text-base">{customizations().agents}</span>
            </div>
            <div class="flex items-center justify-between rounded-md bg-v2-background-bg-base px-2.5 py-1.5">
              <span class="text-v2-text-text-muted">Skills (@)</span>
              <span class="font-mono font-semibold text-v2-text-text-base">{customizations().pureSkills}</span>
            </div>
            <div class="flex items-center justify-between rounded-md bg-v2-background-bg-base px-2.5 py-1.5">
              <span class="text-v2-text-text-muted">Mods</span>
              <span class="font-mono font-semibold text-v2-text-text-base">{customizations().mods}</span>
            </div>
            <div class="flex items-center justify-between rounded-md bg-v2-background-bg-base px-2.5 py-1.5">
              <span class="text-v2-text-text-muted">Hooks</span>
              <span class="font-mono font-semibold text-v2-text-text-base">{customizations().hooks}</span>
            </div>
            <div class="flex items-center justify-between rounded-md bg-v2-background-bg-base px-2.5 py-1.5">
              <span class="text-v2-text-text-muted">{tr("Modes & Settings", "Modos & Settings")}</span>
              <span class="font-mono font-semibold text-v2-text-text-base">{customizations().settings}</span>
            </div>
            <div class="flex items-center justify-between rounded-md bg-v2-background-bg-base px-2.5 py-1.5">
              <span class="text-v2-text-text-muted">{tr("Commands (/)", "Comandos (/)")}</span>
              <span class="font-mono font-semibold text-v2-text-text-base">
                {customizations().commands}
                <Show when={customizations().loops > 0}>
                  <span class="ms-1 text-[10.5px] font-normal text-v2-text-text-faint">
                    ({customizations().loops} loops)
                  </span>
                </Show>
              </span>
            </div>
          </div>
        </section>

        {/* MCP Summary & Server List */}
        <section class="rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-3.5">
          <div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 text-[12.5px] font-semibold text-v2-text-text-base">
              <McpPlugIcon size={14} class="text-v2-icon-icon-muted" />
              <span>{tr("MCP Summary ({{count}})", "Resumo MCP ({{count}})", { count: mcpCounts().total })}</span>
            </div>

            <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span class="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-medium text-v2-state-fg-success">
                <span>{tr("Connected:", "Conectados:")}</span>
                <span class="font-mono">{mcpCounts().connected}</span>
              </span>
              <span class="inline-flex items-center gap-1 rounded-full border border-red-500/25 bg-red-500/10 px-2 py-0.5 font-medium text-v2-state-fg-danger">
                <span>{tr("Failed:", "Falha:")}</span>
                <span class="font-mono">{mcpCounts().failed}</span>
              </span>
              <span class="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 font-medium text-v2-state-fg-warning">
                <span>{tr("Auth:", "Auth:")}</span>
                <span class="font-mono">{mcpCounts().needsAuth}</span>
              </span>
              <span class="inline-flex items-center gap-1 rounded-full border border-v2-border-border-base bg-v2-background-bg-base px-2 py-0.5 font-medium text-v2-text-text-muted">
                <span>{tr("Standby:", "Standby:")}</span>
                <span class="font-mono">{mcpCounts().standby}</span>
              </span>
            </div>
          </div>

          <Show
            when={mcps().length > 0}
            fallback={
              <div class="flex items-center justify-between rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2.5 text-[12px] text-v2-text-text-muted">
                <span>
                  {tr(
                    "No MCP servers configured in this workspace.",
                    "Nenhum servidor MCP configurado neste workspace.",
                  )}
                </span>
                <button
                  type="button"
                  class="text-[11.5px] font-medium text-v2-text-text-accent hover:underline"
                  onClick={handleOpenMcpPanel}
                >
                  {tr("Open MCP Panel", "Abrir Painel MCP")}
                </button>
              </div>
            }
          >
            <div class="flex flex-col gap-1">
              <For each={mcps().slice(0, 10)}>
                {(item) => (
                  <div class="flex items-center justify-between gap-2 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-2.5 py-1.5 text-[12px]">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class={`size-2 shrink-0 rounded-full ${mcpDotClass(item.status.status)}`} />
                      <span class="truncate font-medium text-v2-text-text-base">{item.title ?? item.name}</span>
                      <Show when={item.title && item.title !== item.name}>
                        <span class="truncate font-mono text-[10.5px] text-v2-text-text-faint">{item.name}</span>
                      </Show>
                    </div>
                    <span class={`max-w-[55%] truncate text-[11px] ${mcpStatusToneClass(item.status.status)}`}>
                      <Switch fallback={item.status.status}>
                        <Match when={item.status.status === "connected"}>{tr("Connected", "Conectado")}</Match>
                        <Match when={item.status.status === "standby"}>{tr("Standby", "Standby")}</Match>
                        <Match when={item.status.status === "pending"}>{tr("Connecting", "Conectando")}</Match>
                        <Match when={item.status.status === "disabled"}>{tr("Disabled", "Desativado")}</Match>
                        <Match when={item.status.status === "failed" ? item.status : undefined}>
                          {(failed) => failed().error || tr("Connection failed", "Falha na conexão")}
                        </Match>
                        <Match when={item.status.status === "needs_auth" ? item.status : undefined}>
                          {(auth) =>
                            tr("Authentication required: {{reason}}", "Autenticação necessária: {{reason}}", {
                              reason: auth().error || tr("please sign in", "faça login"),
                            })
                          }
                        </Match>
                      </Switch>
                    </span>
                  </div>
                )}
              </For>

              <Show when={mcps().length > 10}>
                <div class="flex items-center justify-between px-1 pt-1 text-[11px] text-v2-text-text-faint">
                  <span>
                    {tr("Showing 10 of {{total}} MCP servers", "Exibindo 10 de {{total}} servidores MCP", {
                      total: mcps().length,
                    })}
                  </span>
                  <button
                    type="button"
                    class="font-medium text-v2-text-text-accent hover:underline"
                    onClick={handleOpenMcpPanel}
                  >
                    {tr("View all in MCP Panel", "Ver todos no Painel MCP")}
                  </button>
                </div>
              </Show>
            </div>
          </Show>
        </section>
      </DialogBody>

      <DialogFooter>
        <div class="flex w-full flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-1.5">
            <Button
              size="small"
              variant="neutral"
              disabled={reloading() || !workbench.activeServerCtx()}
              onClick={() => void handleReloadConfig()}
            >
              <span class="inline-flex items-center gap-1.5">
                <Show when={reloading()} fallback={<Icon name="refresh" size="small" class="size-3.5" />}>
                  <Loader width={12} height={12} />
                </Show>
                <span>{tr("Reload Config", "Recarregar Config")}</span>
              </span>
            </Button>

            <Button size="small" variant="neutral" onClick={handleOpenLogs}>
              <span class="inline-flex items-center gap-1.5">
                <LogsStreamIcon size={13} />
                <span>{tr("Open Logs", "Abrir Logs")}</span>
              </span>
            </Button>

            <Button
              size="small"
              variant="neutral"
              disabled={exporting() || !platform.exportDebugLogs}
              title={
                platform.exportDebugLogs
                  ? tr("Export diagnostic log bundle", "Exportar pacote de logs de diagnóstico")
                  : tr("Log export is available in the Desktop app", "Exportação de logs disponível no aplicativo Desktop")
              }
              onClick={() => void handleExportDiagnostics()}
            >
              <span class="inline-flex items-center gap-1.5">
                <Show when={exporting()} fallback={<CheckShieldIcon size={13} />}>
                  <Loader width={12} height={12} />
                </Show>
                <span>{tr("Export Diagnostics", "Exportar Diagnóstico")}</span>
              </span>
            </Button>

            <Button
              size="small"
              variant="ghost-danger"
              disabled={restarting()}
              onClick={() => void handleRestart()}
            >
              <span class="inline-flex items-center gap-1.5">
                <Show when={restarting()} fallback={<Icon name="refresh" size="small" class="size-3.5" />}>
                  <Loader width={12} height={12} />
                </Show>
                <span>{tr("Restart", "Reiniciar")}</span>
              </span>
            </Button>
          </div>

          <Button size="small" variant="submit" onClick={props.onClose}>
            {tr("Close", "Fechar")}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
