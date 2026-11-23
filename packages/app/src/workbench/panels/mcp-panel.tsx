import { batch, createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { McpResource, McpResourceTemplate, McpServer } from "@opencode/client/promise"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerProvider } from "@/runtime/server/current"
import type { ServerConnection } from "@/runtime/server/registry"
import { showToast } from "@/shell/notifications/toast"
import { McpPlugIcon, SearchCodeIcon } from "../icons"
import { useWorkbench } from "../state"

type McpStatusKind = McpServer["status"]["status"]

type ResourceCatalogState = {
  resources: readonly McpResource[]
  templates: readonly McpResourceTemplate[]
  loading: boolean
  loaded: boolean
  error: string | undefined
}

export function McpPanel() {
  const workbench = useWorkbench()
  const dialog = useDialog()
  const platform = usePlatform()
  const { tr } = useOnethyI18n()

  const statusLabel = (status: McpStatusKind) => {
    if (status === "connected") return tr("Connected", "Conectado")

    if (status === "standby") return tr("Standby", "Em espera")

    if (status === "pending") return tr("Connecting...", "Conectando...")

    if (status === "needs_auth") return tr("Needs authentication", "Requer autenticação")

    if (status === "failed") return tr("Failed", "Falhou")

    return tr("Disabled", "Desativado")
  }

  const actionLabel = (status: McpStatusKind, busy: boolean) => {
    if (busy) return tr("Wait", "Aguarde")

    if (status === "connected" || status === "standby") return tr("Disconnect", "Desconectar")

    if (status === "needs_auth") return tr("Authenticate", "Autenticar")

    if (status === "failed") return tr("Retry", "Tentar")

    return tr("Connect", "Conectar")
  }

  const [query, setQuery] = createSignal("")
  const [syncing, setSyncing] = createSignal(false)
  const [syncError, setSyncError] = createSignal<string | undefined>(undefined)
  const [busyServers, setBusyServers] = createStore<Record<string, boolean>>({})
  const [expandedErrors, setExpandedErrors] = createStore<Record<string, boolean>>({})
  const [resourcesOpen, setResourcesOpen] = createSignal(false)

  const [catalog, setCatalog] = createStore<ResourceCatalogState>({
    resources: [],
    templates: [],
    loading: false,
    loaded: false,
    error: undefined,
  })

  let syncGeneration = 0
  let resourceGeneration = 0

  const location = createMemo(() => {
    const ctx = workbench.activeServerCtx()

    if (!ctx) return undefined

    return workbench.activeLocation() ?? ctx.data.location.default()
  })

  const servers = createMemo<readonly McpServer[]>(() => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc) return []
    const list = ctx.data.location.mcp.server.list(loc) ?? []

    return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
  })

  const summary = createMemo(() => {
    const all = servers()
    const connected = all.filter((item) => item.status.status === "connected").length
    const standby = all.filter((item) => item.status.status === "standby").length
    const pending = all.filter((item) => item.status.status === "pending").length
    const needsAuth = all.filter((item) => item.status.status === "needs_auth").length
    const failed = all.filter((item) => item.status.status === "failed").length
    const disabled = all.filter((item) => item.status.status === "disabled").length

    return {
      total: all.length,
      connected,
      standby,
      pending,
      needsAuth,
      failed,
      disabled,
    }
  })

  const resourceCountByServer = createMemo(() => {
    const counts = new Map<string, number>()

    for (const resource of catalog.resources) {
      counts.set(resource.server, (counts.get(resource.server) ?? 0) + 1)
    }

    for (const template of catalog.templates) {
      counts.set(template.server, (counts.get(template.server) ?? 0) + 1)
    }

    return counts
  })

  const filteredServers = createMemo(() => {
    const term = query().trim().toLowerCase()

    if (!term) return servers()

    return servers().filter((srv) => {
      const statusText = statusLabel(srv.status.status).toLowerCase()
      const haystack = `${srv.name} ${srv.title ?? ""} ${srv.status.status} ${statusText}`.toLowerCase()

      return haystack.includes(term)
    })
  })

  const filteredResources = createMemo(() => {
    const term = query().trim().toLowerCase()

    if (!term) return catalog.resources

    return catalog.resources.filter((res) =>
      `${res.server} ${res.name} ${res.uri} ${res.description ?? ""} ${res.mimeType ?? ""}`
        .toLowerCase()
        .includes(term),
    )
  })

  const filteredTemplates = createMemo(() => {
    const term = query().trim().toLowerCase()

    if (!term) return catalog.templates

    return catalog.templates.filter((tpl) =>
      `${tpl.server} ${tpl.name} ${tpl.uriTemplate} ${tpl.description ?? ""} ${tpl.mimeType ?? ""}`
        .toLowerCase()
        .includes(term),
    )
  })

  const totalResourceItems = createMemo(() => catalog.resources.length + catalog.templates.length)

  const loadResources = async () => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc) return

    const generation = ++resourceGeneration
    setCatalog("loading", true)
    setCatalog("error", undefined)

    const outcome = await ctx.sdk.api.mcp.resource
      .catalog({ location: loc })
      .then((res) => ({ ok: true as const, data: res.data }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    if (generation !== resourceGeneration) return

    batch(() => {
      setCatalog("loading", false)
      setCatalog("loaded", true)

      if (!outcome.ok) {
        setCatalog("error", outcome.message)

        return
      }

      setCatalog("resources", outcome.data.resources)
      setCatalog("templates", outcome.data.templates)
      setCatalog("error", undefined)
    })
  }

  const syncAll = async (opts?: { force?: boolean }) => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc) return

    const generation = ++syncGeneration
    setSyncing(true)
    setSyncError(undefined)

    if (opts?.force) {
      ctx.data.location.mcp.server.invalidate(loc)
      ctx.data.location.mcp.resource.invalidate(loc)
    }

    const serverOutcome = await ctx.data.location.mcp.server
      .sync(loc)
      .then(() => ({ ok: true as const }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    await Promise.all([
      ctx.data.location.mcp.resource.sync(loc).catch(() => undefined),
      loadResources(),
    ])

    if (generation !== syncGeneration) return

    batch(() => {
      setSyncing(false)
      setSyncError(serverOutcome.ok ? undefined : serverOutcome.message)
    })
  }

  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc) {
      syncGeneration += 1
      resourceGeneration += 1
      batch(() => {
        setSyncing(false)
        setSyncError(undefined)
        setCatalog({ resources: [], templates: [], loading: false, loaded: false, error: undefined })
      })

      return
    }

    void syncAll()
  })

  const openConnectDialog = async (integrationID?: string) => {
    const conn = workbench.activeServer()

    if (!conn) return

    const { DialogConnectProvider, useProviderConnectController } = await import("@/providers/connect/dialog")
    const dir = workbench.activeDirectory()

    function ScopedConnectDialog(props: { serverConn: ServerConnection.Any }) {
      const controller = useProviderConnectController()

      if (integrationID) controller.select(integrationID)

      return (
        <ServerProvider conn={props.serverConn}>
          <DialogConnectProvider
            directory={dir}
            controller={controller}
            standalone={Boolean(integrationID)}
            onConnected={() => void syncAll({ force: true })}
          />
        </ServerProvider>
      )
    }

    void dialog.show(
      () => <ScopedConnectDialog serverConn={conn} />,
      () => void syncAll({ force: true }),
    )
  }

  const handleServerAction = async (srv: McpServer, mode: "connect" | "disconnect") => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc || busyServers[srv.name]) return

    if (mode === "connect" && srv.status.status === "needs_auth" && srv.integrationID) {
      await openConnectDialog(srv.integrationID)

      return
    }

    setBusyServers(srv.name, true)

    const request =
      mode === "disconnect"
        ? ctx.sdk.api.experimental.mcp.disconnect({ server: srv.name, location: loc })
        : ctx.sdk.api.experimental.mcp.connect({ server: srv.name, location: loc })

    const outcome = await request
      .then(() => ({ ok: true as const }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    ctx.data.location.mcp.server.invalidate(loc)
    ctx.data.location.mcp.resource.invalidate(loc)

    await Promise.all([
      ctx.data.location.mcp.server.sync(loc).catch(() => undefined),
      ctx.data.location.mcp.resource.sync(loc).catch(() => undefined),
      loadResources(),
    ])

    setBusyServers(srv.name, false)

    if (!outcome.ok) {
      showToast({
        variant: "error",
        title:
          mode === "disconnect"
            ? tr("Failed to disconnect {{name}}", "Falha ao desconectar {{name}}", { name: srv.name })
            : tr("Failed to connect {{name}}", "Falha ao conectar {{name}}", { name: srv.name }),
        description: outcome.message,
      })

      return
    }

    const updated = ctx.data.location.mcp.server.list(loc)?.find((item) => item.name === srv.name)

    if (mode === "connect" && updated?.status.status === "failed") {
      setExpandedErrors(srv.name, true)
      showToast({
        variant: "error",
        title: tr("Error connecting {{name}}", "Erro ao conectar {{name}}", { name: srv.name }),
        description: updated.status.error,
      })

      return
    }

    if (mode === "connect" && updated?.status.status === "needs_auth" && updated.integrationID) {
      await openConnectDialog(updated.integrationID)

      return
    }

    showToast({
      variant: "success",
      title:
        mode === "disconnect"
          ? tr("{{name}} disconnected", "{{name}} desconectado", { name: srv.name })
          : tr("{{name}} connected", "{{name}} conectado", { name: srv.name }),
    })
  }

  const copyText = async (text: string, label: string) => {
    const writer = platform.writeClipboardText
      ? platform.writeClipboardText(text)
      : navigator.clipboard.writeText(text)

    const ok = await writer.then(() => true).catch(() => false)

    if (!ok) {
      showToast({
        variant: "error",
        title: tr("Could not copy {{label}}", "Não foi possível copiar {{label}}", { label }),
      })

      return
    }

    showToast({
      variant: "success",
      title: tr("{{label}} copied", "{{label}} copiado", { label }),
    })
  }

  const toggleResources = () => {
    const next = !resourcesOpen()
    setResourcesOpen(next)

    if (next && !catalog.loaded && !catalog.loading) {
      void loadResources()
    }
  }

  return (
    <Show
      when={workbench.activeServerCtx()}
      fallback={
        <div class="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
          <div class="flex size-10 items-center justify-center rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
            <McpPlugIcon size={18} />
          </div>
          <div class="text-[12.5px] font-medium text-v2-text-text-base">
            {tr("No active server", "Nenhum servidor ativo")}
          </div>
          <p class="max-w-[210px] text-[11.5px] leading-4 text-v2-text-text-faint">
            {tr(
              "Connect to an Onethy server to inspect and manage MCP servers.",
              "Conecte-se a um servidor Onethy para inspecionar e gerenciar servidores MCP.",
            )}
          </p>
        </div>
      }
    >
      <div class="flex min-h-0 flex-1 flex-col bg-v2-background-bg-base text-v2-text-text-base">
        {/* Summary bar & toolbar */}
        <div class="flex shrink-0 items-center justify-between gap-1.5 border-b border-v2-border-border-muted px-2.5 py-1.5">
          <div class="flex min-w-0 items-center gap-1.5">
            <span
              class={`size-2 shrink-0 rounded-full ${
                summary().failed > 0
                  ? "bg-v2-state-fg-danger"
                  : summary().needsAuth > 0
                    ? "bg-v2-state-fg-warning"
                    : summary().connected > 0
                      ? "bg-v2-state-fg-success"
                      : "bg-v2-icon-icon-muted opacity-50"
              }`}
              aria-hidden="true"
            />
            <span class="truncate text-[11.5px] font-semibold text-v2-text-text-base">
              {tr("{{connected}}/{{total}} active", "{{connected}}/{{total}} ativos", {
                connected: summary().connected,
                total: summary().total,
              })}
            </span>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <button
              type="button"
              class="inline-flex h-6 items-center gap-1 rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2 text-[11px] font-medium text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover"
              onClick={() => void openConnectDialog()}
            >
              <Icon name="plus" size="small" class="size-3" />
              <span>{tr("Connect", "Conectar")}</span>
            </button>

            <Tooltip placement="bottom" value={tr("Refresh MCP servers", "Atualizar servidores MCP")}>
              <button
                type="button"
                class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
                aria-label={tr("Refresh MCP servers", "Atualizar servidores MCP")}
                disabled={syncing()}
                onClick={() => void syncAll({ force: true })}
              >
                <Show when={syncing()} fallback={<Icon name="refresh" size="small" class="size-3.5" />}>
                  <Loader width={13} height={13} />
                </Show>
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Detailed status pills when servers exist */}
        <Show when={summary().total > 0}>
          <div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01/50 px-2.5 py-1.5 text-[10.5px] text-v2-text-text-muted">
            <StatusPill
              dotClass="bg-v2-state-fg-success"
              label={tr("{{count}} connected", "{{count}} conectados", { count: summary().connected })}
            />
            <Show when={summary().standby > 0}>
              <StatusPill
                dotClass="bg-v2-state-fg-info"
                label={tr("{{count}} standby", "{{count}} espera", { count: summary().standby })}
              />
            </Show>
            <Show when={summary().pending > 0}>
              <StatusPill
                dotClass="bg-v2-state-fg-warning onethy-pulse-dot"
                label={tr("{{count}} connecting", "{{count}} conectando", { count: summary().pending })}
              />
            </Show>
            <Show when={summary().needsAuth > 0}>
              <StatusPill
                dotClass="bg-v2-state-fg-warning"
                label={tr("{{count}} auth", "{{count}} auth", { count: summary().needsAuth })}
              />
            </Show>
            <Show when={summary().failed > 0}>
              <StatusPill
                dotClass="bg-v2-state-fg-danger"
                label={tr("{{count}} failed", "{{count}} falha", { count: summary().failed })}
              />
            </Show>
            <Show when={summary().disabled > 0}>
              <StatusPill
                dotClass="bg-v2-icon-icon-muted opacity-45"
                label={tr("{{count}} off", "{{count}} off", { count: summary().disabled })}
              />
            </Show>
          </div>
        </Show>

        {/* Search input */}
        <Show when={summary().total > 0 || totalResourceItems() > 0}>
          <div class="shrink-0 border-b border-v2-border-border-muted px-2 py-1.5">
            <div class="flex h-7 items-center gap-1.5 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 focus-within:border-v2-border-border-focus">
              <SearchCodeIcon size={13} class="shrink-0 text-v2-icon-icon-muted" />
              <input
                type="text"
                value={query()}
                placeholder={tr("Filter servers or resources...", "Filtrar servidores ou recursos...")}
                aria-label={tr("Filter MCP servers and resources", "Filtrar servidores e recursos MCP")}
                class="min-w-0 flex-1 bg-transparent text-[12px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query()) {
                    e.stopPropagation()
                    setQuery("")
                  }
                }}
              />
              <Show when={query().length > 0}>
                <button
                  type="button"
                  class="flex size-4 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                  aria-label={tr("Clear filter", "Limpar filtro")}
                  onClick={() => setQuery("")}
                >
                  <Icon name="outline-xmark" size="small" class="size-3" />
                </button>
              </Show>
            </div>
          </div>
        </Show>

        {/* Scrollable content */}
        <div data-slot="workbench-scroll" class="min-h-0 flex-1 overflow-y-auto">
          <Show when={syncError()}>
            {(message) => (
              <div class="mx-2 mt-2 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger px-2.5 py-2 text-[11.5px] text-v2-state-fg-danger">
                {message()}
              </div>
            )}
          </Show>

          <Show
            when={servers().length > 0}
            fallback={
              <Show
                when={!syncing()}
                fallback={
                  <div class="flex items-center justify-center gap-2 py-8 text-[12px] text-v2-text-text-faint">
                    <Loader width={14} height={14} />
                    <span>{tr("Syncing MCP servers...", "Sincronizando servidores MCP...")}</span>
                  </div>
                }
              >
                <div class="flex flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
                  <div class="flex size-10 items-center justify-center rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
                    <McpPlugIcon size={18} />
                  </div>
                  <div class="text-[12.5px] font-medium text-v2-text-text-base">
                    {tr("No MCP servers configured", "Nenhum servidor MCP configurado")}
                  </div>
                  <p class="max-w-[215px] text-[11.5px] leading-4 text-v2-text-text-faint">
                    {tr(
                      "Connect external tools, databases, and APIs via Model Context Protocol.",
                      "Conecte ferramentas externas, bancos de dados e APIs via Model Context Protocol.",
                    )}
                  </p>
                  <button
                    type="button"
                    class="mt-1 inline-flex items-center gap-1.5 rounded-[6px] bg-v2-background-bg-accent px-3 py-1.5 text-[11.5px] font-medium text-v2-text-text-inverse transition-opacity hover:opacity-90"
                    onClick={() => void openConnectDialog()}
                  >
                    <Icon name="plus" size="small" class="size-3.5" />
                    <span>{tr("Connect MCP", "Conectar MCP")}</span>
                  </button>
                </div>
              </Show>
            }
          >
            <div class="flex flex-col gap-1 p-2">
              <Show when={filteredServers().length === 0}>
                <div class="px-3 py-6 text-center text-[11.5px] text-v2-text-text-faint">
                  {tr('No MCP servers match "{{query}}".', 'Nenhum servidor MCP corresponde a "{{query}}".', {
                    query: query().trim(),
                  })}
                </div>
              </Show>

              <For each={filteredServers()}>
                {(srv) => {
                  const status = () => srv.status
                  const busy = () => Boolean(busyServers[srv.name]) || status().status === "pending"

                  const errorDetail = () => {
                    const current = status()

                    if (current.status === "failed" || current.status === "needs_auth") return current.error

                    return undefined
                  }

                  const hasErrorBox = () => Boolean(errorDetail())
                  const errorExpanded = () => Boolean(expandedErrors[srv.name])
                  const resCount = () => resourceCountByServer().get(srv.name) ?? 0

                  const isConnectedOrStandby = () =>
                    status().status === "connected" || status().status === "standby"

                  return (
                    <div class="rounded-[7px] border border-v2-border-border-muted bg-v2-background-bg-layer-01/60 transition-colors hover:border-v2-border-border-base">
                      <div class="flex items-start gap-2 px-2.5 py-2">
                        <span
                          class={`mt-1.5 size-2 shrink-0 rounded-full ${statusDotClass(status().status)}`}
                          title={statusLabel(status().status)}
                          aria-hidden="true"
                        />

                        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div class="flex items-center gap-1.5 min-w-0">
                            <span
                              class="truncate text-[12px] font-medium text-v2-text-text-base"
                              title={srv.title ? `${srv.title} (${srv.name})` : srv.name}
                            >
                              {srv.title || srv.name}
                            </span>
                            <Show when={resCount() > 0}>
                              <span
                                class="shrink-0 rounded bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[9.5px] text-v2-text-text-muted"
                                title={
                                  resCount() === 1
                                    ? tr("1 exposed resource", "1 recurso exposto")
                                    : tr("{{count}} exposed resources", "{{count}} recursos expostos", {
                                        count: resCount(),
                                      })
                                }
                              >
                                {resCount()}
                              </span>
                            </Show>
                          </div>

                          <div class="flex items-center gap-1.5 text-[10.5px]">
                            <span class={statusTextClass(status().status)}>{statusLabel(status().status)}</span>
                            <Show when={srv.title && srv.title !== srv.name}>
                              <span class="truncate font-mono text-v2-text-text-faint">{srv.name}</span>
                            </Show>
                          </div>
                        </div>

                        <div class="flex shrink-0 items-center gap-1">
                          <Show when={status().status === "failed"}>
                            <Tooltip placement="top" value={tr("Disable server", "Desativar servidor")}>
                              <button
                                type="button"
                                disabled={busy()}
                                aria-label={tr("Disable {{name}}", "Desativar {{name}}", { name: srv.name })}
                                class="flex size-6 items-center justify-center rounded-[5px] border border-v2-border-border-base text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
                                onClick={() => void handleServerAction(srv, "disconnect")}
                              >
                                <Icon name="close" size="small" class="size-3" />
                              </button>
                            </Tooltip>
                          </Show>

                          <button
                            type="button"
                            disabled={busy()}
                            class="inline-flex h-6 items-center gap-1 rounded-[5px] border px-2 text-[10.5px] font-medium transition-colors disabled:opacity-50"
                            classList={{
                              "border-v2-border-border-base bg-v2-background-bg-base text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                                isConnectedOrStandby(),
                              "border-v2-state-border-warning bg-v2-state-bg-warning text-v2-state-fg-warning hover:opacity-90":
                                status().status === "needs_auth",
                              "border-v2-state-border-danger bg-v2-state-bg-danger text-v2-state-fg-danger hover:opacity-90":
                                status().status === "failed",
                              "border-v2-border-border-base bg-v2-background-bg-layer-02 text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover":
                                status().status === "disabled" || status().status === "pending",
                            }}
                            onClick={() =>
                              void handleServerAction(srv, isConnectedOrStandby() ? "disconnect" : "connect")
                            }
                          >
                            <Show when={busy()}>
                              <Loader width={11} height={11} />
                            </Show>
                            <span>{actionLabel(status().status, busy())}</span>
                          </button>
                        </div>
                      </div>

                      <Show when={hasErrorBox()}>
                        <div class="border-t border-v2-border-border-muted/80 px-2.5 py-1.5">
                          <button
                            type="button"
                            class="flex w-full items-center justify-between gap-1 text-left text-[10.5px] font-medium text-v2-text-text-muted hover:text-v2-text-text-base"
                            aria-expanded={errorExpanded()}
                            onClick={() => setExpandedErrors(srv.name, !errorExpanded())}
                          >
                            <span class="inline-flex items-center gap-1">
                              <Icon
                                name="outline-chevron-right"
                                size="small"
                                class="size-3 transition-transform duration-150"
                                classList={{ "rotate-90": errorExpanded() }}
                              />
                              <span>
                                {errorExpanded()
                                  ? tr("Hide details", "Ocultar detalhes")
                                  : tr("View error details", "Ver detalhes do erro")}
                              </span>
                            </span>
                            <Show when={status().status === "failed"}>
                              <Icon name="circle-xmark" size="small" class="size-3 text-v2-state-fg-danger" />
                            </Show>
                            <Show when={status().status === "needs_auth"}>
                              <Icon
                                name="outline-hexagonal-warning"
                                size="small"
                                class="size-3 text-v2-state-fg-warning"
                              />
                            </Show>
                          </button>

                          <Show when={errorExpanded()}>
                            <div class="mt-1.5 flex flex-col gap-1.5">
                              <pre class="max-h-36 overflow-y-auto rounded-[5px] border border-v2-border-border-muted bg-v2-background-bg-deep p-2 font-mono text-[10.5px] leading-4 whitespace-pre-wrap break-words text-v2-state-fg-danger">
                                {errorDetail()}
                              </pre>
                              <div class="flex justify-end">
                                <button
                                  type="button"
                                  class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                                  onClick={() => void copyText(errorDetail() ?? "", tr("Error", "Erro"))}
                                >
                                  <Icon name="outline-copy" size="small" class="size-3" />
                                  <span>{tr("Copy error", "Copiar erro")}</span>
                                </button>
                              </div>
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>

          {/* Expandable MCP Resources section */}
          <div class="mt-1 border-t border-v2-border-border-muted">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
              aria-expanded={resourcesOpen()}
              onClick={toggleResources}
            >
              <span class="inline-flex items-center gap-1.5">
                <Icon
                  name="outline-chevron-right"
                  size="small"
                  class="size-3.5 transition-transform duration-150"
                  classList={{ "rotate-90": resourcesOpen() }}
                />
                <span>{tr("MCP Resources", "Recursos MCP")}</span>
              </span>
              <span class="rounded-full bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-v2-text-text-muted">
                {totalResourceItems()}
              </span>
            </button>

            <Show when={resourcesOpen()}>
              <div class="flex flex-col gap-1.5 px-2 pb-3">
                <Show when={catalog.loading}>
                  <div class="flex items-center gap-2 px-2 py-2 text-[11.5px] text-v2-text-text-faint">
                    <Loader width={12} height={12} />
                    <span>{tr("Loading resources...", "Carregando recursos...")}</span>
                  </div>
                </Show>

                <Show when={catalog.error}>
                  {(err) => (
                    <div class="rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger px-2 py-1.5 text-[11px] text-v2-state-fg-danger">
                      {err()}
                    </div>
                  )}
                </Show>

                <Show
                  when={
                    !catalog.loading &&
                    !catalog.error &&
                    filteredResources().length === 0 &&
                    filteredTemplates().length === 0
                  }
                >
                  <div class="px-2 py-3 text-center text-[11.5px] text-v2-text-text-faint">
                    {totalResourceItems() === 0
                      ? tr(
                          "No MCP resources exposed by connected servers.",
                          "Nenhum recurso MCP exposto pelos servidores conectados.",
                        )
                      : tr("No resources match the filter.", "Nenhum recurso corresponde ao filtro.")}
                  </div>
                </Show>

                <For each={filteredResources()}>
                  {(res) => (
                    <div class="rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01/50 p-2">
                      <div class="flex items-start justify-between gap-1.5">
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-1.5">
                            <span class="truncate text-[11.5px] font-medium text-v2-text-text-base">{res.name}</span>
                            <span class="shrink-0 rounded bg-v2-background-bg-layer-02 px-1 py-0.5 font-mono text-[9.5px] text-v2-text-text-muted">
                              {res.server}
                            </span>
                          </div>
                          <div class="mt-0.5 truncate font-mono text-[10px] text-v2-text-text-faint" title={res.uri}>
                            {res.uri}
                          </div>
                          <Show when={res.description}>
                            <p class="mt-1 line-clamp-2 text-[10.5px] leading-3.5 text-v2-text-text-muted">
                              {res.description}
                            </p>
                          </Show>
                        </div>

                        <div class="flex shrink-0 items-center gap-0.5">
                          <Tooltip placement="top" value={tr("Insert URI into chat", "Inserir URI no chat")}>
                            <button
                              type="button"
                              class="flex size-5 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                              aria-label={tr("Insert {{name}} into chat", "Inserir {{name}} no chat", {
                                name: res.name,
                              })}
                              onClick={() => {
                                workbench.insertComposerText(`${res.uri} `)
                                showToast({
                                  variant: "default",
                                  title: tr(
                                    "Resource {{name}} inserted into chat",
                                    "Recurso {{name}} inserido no chat",
                                    { name: res.name },
                                  ),
                                })
                              }}
                            >
                              <Icon name="plus" size="small" class="size-3" />
                            </button>
                          </Tooltip>
                          <Tooltip placement="top" value={tr("Copy URI", "Copiar URI")}>
                            <button
                              type="button"
                              class="flex size-5 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                              aria-label={tr("Copy URI for {{name}}", "Copiar URI de {{name}}", { name: res.name })}
                              onClick={() => void copyText(res.uri, "URI")}
                            >
                              <Icon name="outline-copy" size="small" class="size-3" />
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  )}
                </For>

                <For each={filteredTemplates()}>
                  {(tpl) => (
                    <div class="rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01/50 p-2">
                      <div class="flex items-start justify-between gap-1.5">
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-1.5">
                            <span class="truncate text-[11.5px] font-medium text-v2-text-text-base">{tpl.name}</span>
                            <span class="shrink-0 rounded bg-v2-background-bg-layer-02 px-1 py-0.5 font-mono text-[9.5px] text-v2-text-text-muted">
                              {tpl.server}
                            </span>
                            <span class="shrink-0 rounded border border-v2-border-border-base px-1 py-0.5 text-[9px] text-v2-text-text-faint">
                              template
                            </span>
                          </div>
                          <div
                            class="mt-0.5 truncate font-mono text-[10px] text-v2-text-text-faint"
                            title={tpl.uriTemplate}
                          >
                            {tpl.uriTemplate}
                          </div>
                          <Show when={tpl.description}>
                            <p class="mt-1 line-clamp-2 text-[10.5px] leading-3.5 text-v2-text-text-muted">
                              {tpl.description}
                            </p>
                          </Show>
                        </div>

                        <Tooltip placement="top" value={tr("Copy URI template", "Copiar template URI")}>
                          <button
                            type="button"
                            class="flex size-5 shrink-0 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                            aria-label={tr("Copy template {{name}}", "Copiar template {{name}}", { name: tpl.name })}
                            onClick={() => void copyText(tpl.uriTemplate, tr("URI template", "Template URI"))}
                          >
                            <Icon name="outline-copy" size="small" class="size-3" />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}

function StatusPill(props: { dotClass: string; label: string }) {
  return (
    <span class="inline-flex items-center gap-1">
      <span class={`size-1.5 rounded-full ${props.dotClass}`} aria-hidden="true" />
      <span>{props.label}</span>
    </span>
  )
}

function statusDotClass(status: McpStatusKind) {
  if (status === "connected") return "bg-v2-state-fg-success"

  if (status === "standby") return "bg-v2-state-fg-info"

  if (status === "pending") return "bg-v2-state-fg-warning onethy-pulse-dot"

  if (status === "needs_auth") return "bg-v2-state-fg-warning"

  if (status === "failed") return "bg-v2-state-fg-danger"

  return "bg-v2-icon-icon-muted opacity-45"
}

function statusTextClass(status: McpStatusKind) {
  if (status === "connected") return "text-v2-state-fg-success"

  if (status === "standby") return "text-v2-state-fg-info"

  if (status === "pending") return "text-v2-state-fg-warning"

  if (status === "needs_auth") return "text-v2-state-fg-warning"

  if (status === "failed") return "text-v2-state-fg-danger"

  return "text-v2-text-text-faint"
}
