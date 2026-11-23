import { createMemo, For, Show, type Component } from "solid-js"
import { useDialog } from "@opencode/ui/context/dialog"
import { Tooltip } from "@opencode/ui/tooltip"
import { getFilename } from "@opencode/util/path"
import { useFusion } from "@/providers/models/fusion"
import { BoltIcon } from "@/providers/models/fusion-icons"
import { ModelsProvider } from "@/providers/models/models"
import { LocalProvider } from "@/providers/models/selection"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { ServerProvider } from "@/runtime/server/current"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useCommand } from "@/shell/commands/command"
import { showToast } from "@/shell/notifications/toast"
import { useTabs } from "@/shell/tabs/tabs"
import {
  ExplorerIcon,
  MemoryDbIcon,
  OnethyLogoMark,
  SessionsIcon,
  TerminalPromptIcon,
} from "@/workbench/icons"
import { useWorkbench } from "@/workbench/state"
import { LocationProvider } from "@/workspaces/location"

type QuickAction = {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly accent?: boolean
  readonly icon: Component<{ class?: string; size?: number }>
  readonly onSelect: () => void
}

type ShortcutPill = {
  readonly keys: string
  readonly label: string
  readonly onSelect: () => void
}

function ProviderConnectIcon(props: { class?: string; size?: number }) {
  const size = () => props.size ?? 16
  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={props.class}
      aria-hidden="true"
    >
      <circle cx="5.75" cy="8" r="2.75" stroke="currentColor" stroke-width="1.35" />
      <path
        d="M8.5 8h5.25M11.75 8v2M13.75 8v1.5"
        stroke="currentColor"
        stroke-width="1.35"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function FusionQuickIcon(props: { class?: string; size?: number }) {
  return <BoltIcon class={props.class ?? "size-4 shrink-0"} />
}

export const WelcomeDashboard: Component<{ class?: string }> = (props) => {
  const { tr, locale } = useOnethyI18n()
  const workbench = useWorkbench()
  const fusion = useFusion()
  const dialog = useDialog()
  const tabs = useTabs()
  const command = useCommand()
  const servers = useServers()
  const global = useGlobal()

  const activeServer = createMemo(
    () => workbench.activeServer() ?? servers.visible.find((item) => servers.current(item)) ?? servers.visible[0],
  )

  const activeServerCtx = createMemo(() => {
    const existing = workbench.activeServerCtx()
    if (existing) return existing
    const conn = activeServer()
    if (!conn) return undefined
    return global.ensureServerCtx(conn)
  })

  const activeDirectory = createMemo(() => {
    const dir = workbench.activeDirectory()
    if (dir) return dir
    const ctx = activeServerCtx()
    if (!ctx) return undefined
    const project = ctx.projects.last() ?? ctx.projects.used()[0] ?? ctx.projects.list()[0]
    if (project?.worktree) return project.worktree
    return ctx.data.location.default().directory
  })

  const workspaceName = createMemo(() => {
    const dir = activeDirectory()
    if (!dir) return tr("No active workspace", "Sem workspace ativo")
    return getFilename(dir) || dir
  })

  const connectionStatus = createMemo(() => activeServerCtx()?.sdk.connection.status())

  const openNewSession = async () => {
    const conn = activeServer()
    const dir = activeDirectory()
    if (!conn || !dir) {
      showToast({
        variant: "error",
        title: tr("No project available", "Nenhum projeto disponível"),
        description: tr(
          "Add or select a project from the list below to start a new session.",
          "Adicione ou selecione um projeto na lista abaixo para iniciar uma nova sessão.",
        ),
      })
      return
    }

    global.ensureServerCtx(conn).projects.touch(dir)
    await tabs.newDraft({ server: ServerConnection.key(conn), directory: dir })
  }

  const openConnectProvider = async () => {
    const conn = activeServer()
    if (!conn) {
      showToast({
        variant: "error",
        title: tr("No server connected", "Nenhum servidor conectado"),
        description: tr(
          "Connect to an Onethy Code server to configure providers.",
          "Conecte-se a um servidor Onethy Code para configurar provedores.",
        ),
      })
      return
    }

    const dir = activeDirectory()
    const { DialogConnectProvider } = await import("@/providers/connect/dialog")
    void dialog.show(() => (
      <ServerProvider conn={conn}>
        <ModelsProvider directory={dir}>
          <DialogConnectProvider directory={dir} onDone={() => dialog.close()} />
        </ModelsProvider>
      </ServerProvider>
    ))
  }

  const openFusionDialog = async () => {
    const conn = activeServer()
    const dir = activeDirectory()
    if (!conn || !dir) {
      showToast({
        variant: "error",
        title: tr("No server or workspace connected", "Nenhum servidor ou workspace conectado"),
        description: tr(
          "Select an active workspace to configure Omni Fusion.",
          "Selecione um workspace ativo para configurar o Omni Fusion.",
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

  const openMemoryBank = async () => {
    const conn = activeServer()
    if (!conn) {
      showToast({
        variant: "error",
        title: tr("No server connected", "Nenhum servidor conectado"),
        description: tr(
          "Connect to a server to open the Memory Bank.",
          "Conecte-se a um servidor para abrir o Memory Bank.",
        ),
      })
      return
    }

    const dir = activeDirectory()
    const { DialogMemoryBank } = await import("@/memory-bank/dialog")
    void dialog.show(() => (
      <ServerProvider conn={conn}>
        <DialogMemoryBank directory={dir} onClose={() => dialog.close()} />
      </ServerProvider>
    ))
  }

  const shortcuts = createMemo<readonly ShortcutPill[]>(() => [
    { keys: "Ctrl+K", label: tr("Commands", "Comandos"), onSelect: () => command.trigger("commands.search") },
    { keys: "Ctrl+B", label: tr("Sidebar", "Sidebar"), onSelect: () => workbench.toggleSidebar() },
    { keys: "Ctrl+`", label: tr("Terminal", "Terminal"), onSelect: () => workbench.toggleBottom() },
    { keys: "Ctrl+Shift+F", label: tr("Search", "Buscar"), onSelect: () => workbench.openActivity("search") },
  ])

  const actions = createMemo<readonly QuickAction[]>(() => [
    {
      id: "new-session",
      label: tr("New Session", "Nova Sessão"),
      hint: tr("Start chat in workspace", "Iniciar chat no workspace"),
      accent: true,
      icon: SessionsIcon,
      onSelect: () => void openNewSession(),
    },
    {
      id: "explorer",
      label: tr("Explore Files", "Explorar Arquivos"),
      hint: tr("Open project tree", "Abrir árvore do projeto"),
      icon: ExplorerIcon,
      onSelect: () => workbench.openActivity("explorer"),
    },
    {
      id: "connect-provider",
      label: tr("Connect Provider", "Conectar Provedor"),
      hint: tr("API keys and OAuth", "Chaves de API e OAuth"),
      icon: ProviderConnectIcon,
      onSelect: () => void openConnectProvider(),
    },
    {
      id: "omni-fusion",
      label: "Omni Fusion",
      hint: tr("Automatic routing", "Roteamento automático"),
      icon: FusionQuickIcon,
      onSelect: () => void openFusionDialog(),
    },
    {
      id: "memory-bank",
      label: "Memory Bank",
      hint: tr("Persistent context", "Contexto persistente"),
      icon: MemoryDbIcon,
      onSelect: () => void openMemoryBank(),
    },
    {
      id: "terminal",
      label: tr("Integrated Terminal", "Terminal Integrado"),
      hint: tr("Shell in bottom panel", "Shell no painel inferior"),
      icon: TerminalPromptIcon,
      onSelect: () => workbench.openBottom("terminal"),
    },
  ])

  return (
    <section
      data-slot="home-welcome-dashboard"
      aria-label={tr("Onethy Code Welcome Dashboard", "Painel de Boas-vindas Onethy Code")}
      class={`mx-auto w-full max-w-[1080px] px-3 pt-4 pb-1 lg:px-6 ${props.class ?? ""}`}
    >
      <div class="rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-3.5 shadow-[var(--v2-elevation-subtle)]">
        {/* Top Row: Brand, Active Workspace Pill, Omni Fusion Badge & Shortcuts */}
        <div class="flex flex-wrap items-center justify-between gap-2.5">
          <div class="flex min-w-0 flex-wrap items-center gap-2.5">
            <div class="flex items-center gap-2.5">
              <div class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-v2-border-border-base bg-v2-background-bg-base text-v2-text-text-accent">
                <OnethyLogoMark size={17} />
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-[14px] font-semibold leading-tight tracking-[-0.01em] text-v2-text-text-base">
                  Onethy Code
                </span>
                <span class="text-[11px] leading-tight text-v2-text-text-faint">
                  {tr("Agentic IDE · Code, MCP & Automation", "IDE Agêntica · Código, MCP & Automação")}
                </span>
              </div>
            </div>

            <div class="hidden h-5 w-px bg-v2-border-border-muted sm:block" aria-hidden="true" />

            {/* Active Workspace Pill */}
            <Tooltip
              placement="bottom"
              value={activeDirectory() ?? tr("Select a project below", "Selecione um projeto abaixo")}
            >
              <button
                type="button"
                class="inline-flex max-w-[240px] items-center gap-1.5 rounded-full border border-v2-border-border-base bg-v2-background-bg-base px-2.5 py-1 text-[11.5px] text-v2-text-text-base transition-colors hover:border-v2-border-border-strong hover:bg-v2-overlay-simple-overlay-hover"
                onClick={() => workbench.openActivity("explorer")}
              >
                <span
                  class="size-1.5 shrink-0 rounded-full"
                  classList={{
                    "bg-emerald-500": connectionStatus() === "connected",
                    "bg-amber-500": connectionStatus() === "connecting" || connectionStatus() === "reconnecting",
                    "bg-v2-icon-icon-muted opacity-60":
                      connectionStatus() !== "connected" &&
                      connectionStatus() !== "connecting" &&
                      connectionStatus() !== "reconnecting",
                  }}
                />
                <span class="truncate font-medium">{workspaceName()}</span>
              </button>
            </Tooltip>

            {/* Omni Fusion Status Badge */}
            <Tooltip
              placement="bottom"
              value={
                fusion.enabled()
                  ? tr(
                      "Omni Fusion active ({{tier}}) — click to configure model pool",
                      "Omni Fusion ativo ({{tier}}) — clique para configurar o pool de modelos",
                      { tier: fusion.tierLabel(fusion.tier(), locale()) },
                    )
                  : tr(
                      "Omni Fusion disabled — click to enable automatic routing",
                      "Omni Fusion desativado — clique para ativar roteamento automático",
                    )
              }
            >
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors"
                classList={{
                  "border-emerald-500/35 bg-emerald-500/12 text-v2-state-fg-success hover:bg-emerald-500/18":
                    fusion.enabled(),
                  "border-v2-border-border-base bg-v2-background-bg-base text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover":
                    !fusion.enabled(),
                }}
                onClick={() => void openFusionDialog()}
              >
                <BoltIcon class="size-3 shrink-0" />
                <span>
                  <Show when={fusion.enabled()} fallback="Omni Fusion · OFF">
                    Omni Fusion · {fusion.tierLabel(fusion.tier(), locale())}
                  </Show>
                </span>
              </button>
            </Tooltip>
          </div>

          {/* Interactive Keyboard Shortcut Pills */}
          <div
            class="hidden flex-wrap items-center gap-1.5 md:flex"
            aria-label={tr("Quick keyboard shortcuts", "Atalhos rápidos do teclado")}
          >
            <For each={shortcuts()}>
              {(item) => (
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-2 py-1 text-[11px] text-v2-text-text-muted transition-colors hover:border-v2-border-border-base hover:text-v2-text-text-base"
                  onClick={item.onSelect}
                >
                  <kbd class="font-mono text-[10.5px] font-medium text-v2-text-text-base">{item.keys}</kbd>
                  <span class="text-v2-text-text-faint">{item.label}</span>
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Quick Actions Bar */}
        <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <For each={actions()}>
            {(action) => {
              const IconComp = action.icon
              return (
                <button
                  type="button"
                  class="group flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-start transition-colors"
                  classList={{
                    "border-v2-border-border-base bg-v2-background-bg-accent text-v2-text-text-inverse hover:opacity-92":
                      Boolean(action.accent),
                    "border-v2-border-border-muted bg-v2-background-bg-base text-v2-text-text-base hover:border-v2-border-border-base hover:bg-v2-overlay-simple-overlay-hover":
                      !action.accent,
                  }}
                  onClick={action.onSelect}
                >
                  <div
                    class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
                    classList={{
                      "bg-black/15 text-v2-text-text-inverse": Boolean(action.accent),
                      "bg-v2-background-bg-layer-01 text-v2-text-text-accent group-hover:bg-v2-background-bg-layer-02":
                        !action.accent,
                    }}
                  >
                    <IconComp size={15} />
                  </div>
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-[12px] font-medium leading-tight">{action.label}</span>
                    <span
                      class="truncate text-[10.5px] leading-tight"
                      classList={{
                        "text-v2-text-text-inverse/80": Boolean(action.accent),
                        "text-v2-text-text-faint": !action.accent,
                      }}
                    >
                      {action.hint}
                    </span>
                  </div>
                </button>
              )
            }}
          </For>
        </div>
      </div>
    </section>
  )
}
