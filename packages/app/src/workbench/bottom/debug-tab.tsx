import { createEffect, createSignal, For, Show } from "solid-js"
import type { DebugHeapDumpOutput, LocationPublicRef, ServerInfo } from "@opencode/client/promise"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"
import { BugDebugIcon, PlayRunIcon, TerminalPromptIcon } from "../icons"
import { useWorkbench } from "../state"

type CommandHistoryEntry = {
  id: string
  command: string
  output: string
  exit?: number
  status?: "running" | "exited" | "timeout" | "killed"
  error?: string
  timestamp: number
}

function formatMegabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(ts: number, localeTag: string) {
  return new Date(ts).toLocaleTimeString(localeTag, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function DebugTab(props: { visible?: boolean }) {
  const workbench = useWorkbench()
  const platform = usePlatform()
  const { tr, intl } = useOnethyI18n()

  const [serverInfo, setServerInfo] = createSignal<ServerInfo | undefined>(undefined)
  const [locations, setLocations] = createSignal<readonly LocationPublicRef[]>([])
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)

  const [heapDump, setHeapDump] = createSignal<DebugHeapDumpOutput | undefined>(undefined)
  const [dumping, setDumping] = createSignal(false)
  const [reloading, setReloading] = createSignal(false)
  const [restarting, setRestarting] = createSignal(false)
  const [evictingDir, setEvictingDir] = createSignal<string | undefined>(undefined)

  const [commandInput, setCommandInput] = createSignal("")
  const [runningCmd, setRunningCmd] = createSignal(false)
  const [history, setHistory] = createSignal<readonly CommandHistoryEntry[]>([])
  const [historyCursor, setHistoryCursor] = createSignal(-1)

  let refreshGen = 0

  const loadDiagnostics = async () => {
    const ctx = workbench.activeServerCtx()
    if (!ctx) {
      setServerInfo(undefined)
      setLocations([])
      return
    }

    const gen = ++refreshGen
    setLoading(true)
    setError(undefined)

    const [infoRes, locRes] = await Promise.all([
      ctx.sdk.api.server
        .info()
        .then((data) => ({ ok: true as const, data }))
        .catch((err) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) })),
      ctx.sdk.api.debug.location
        .list()
        .then((data) => ({ ok: true as const, data }))
        .catch((err) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) })),
    ])

    if (gen !== refreshGen) return
    setLoading(false)

    if (infoRes.ok) setServerInfo(infoRes.data)
    if (!infoRes.ok) setError(infoRes.message)

    if (locRes.ok) {
      setLocations(locRes.data)
      return
    }
    if (infoRes.ok) setError(locRes.message)
  }

  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    const visible = props.visible !== false
    if (!ctx) {
      setServerInfo(undefined)
      setLocations([])
      return
    }
    if (!visible) return
    void loadDiagnostics()
  })

  const handleEvictLocation = async (directory: string) => {
    const ctx = workbench.activeServerCtx()
    if (!ctx || evictingDir()) return

    setEvictingDir(directory)
    const err = await ctx.sdk.api.debug.location
      .evict({ location: { directory } })
      .then(() => undefined)
      .catch((cause) => (cause instanceof Error ? cause.message : String(cause)))
    setEvictingDir(undefined)

    if (err) {
      showToast({
        variant: "error",
        title: tr("Failed to evict location", "Falha ao liberar localização"),
        description: err,
      })
      return
    }

    showToast({
      variant: "success",
      title: tr("Location evicted from cache", "Localização liberada do cache"),
      description: directory,
    })
    void loadDiagnostics()
  }

  const handleHeapDump = async () => {
    const ctx = workbench.activeServerCtx()
    if (!ctx || dumping()) return

    setDumping(true)
    const res = await ctx.sdk.api.debug
      .heapDump({ directory: workbench.activeDirectory() })
      .then((data) => ({ ok: true as const, data }))
      .catch((err) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }))
    setDumping(false)

    if (!res.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to generate Heap Dump", "Falha ao gerar Heap Dump"),
        description: res.message,
      })
      return
    }

    setHeapDump(res.data)
    showToast({
      variant: "success",
      title: tr("Heap Dump generated", "Heap Dump gerado"),
      description: res.data.path,
    })
  }

  const handleReloadConfig = async () => {
    const ctx = workbench.activeServerCtx()
    if (!ctx || reloading()) return

    setReloading(true)
    const err = await ctx.sdk.api.location
      .reload()
      .then(() => undefined)
      .catch((cause) => (cause instanceof Error ? cause.message : String(cause)))
    setReloading(false)

    if (err) {
      showToast({
        variant: "error",
        title: tr("Failed to reload configuration", "Falha ao recarregar configuração"),
        description: err,
      })
      return
    }

    showToast({
      variant: "success",
      title: tr("Configuration reloaded on server", "Configurações recarregadas no servidor"),
    })
    void loadDiagnostics()
  }

  const handleRestart = async () => {
    if (restarting()) return
    setRestarting(true)
    const err = await platform
      .restart()
      .then(() => undefined)
      .catch((cause) => (cause instanceof Error ? cause.message : String(cause)))
    setRestarting(false)

    if (err) {
      showToast({
        variant: "error",
        title: tr("Failed to restart app", "Falha ao reiniciar aplicativo"),
        description: err,
      })
    }
  }

  const handleRunCommand = async (event: SubmitEvent) => {
    event.preventDefault()
    const command = commandInput().trim()
    if (!command || runningCmd()) return

    setRunningCmd(true)
    setCommandInput("")
    setHistoryCursor(-1)

    const result = await workbench.runShellCommand(command)
    setRunningCmd(false)

    const entry: CommandHistoryEntry = {
      id: `cmd:${Date.now()}`,
      command,
      output: result.output,
      exit: result.exit,
      status: result.status,
      error: result.error,
      timestamp: Date.now(),
    }
    setHistory((prev) => [entry, ...prev].slice(0, 30))
  }

  const handleCommandKeyDown = (event: KeyboardEvent) => {
    const entries = history()
    if (entries.length === 0) return

    if (event.key === "ArrowUp") {
      event.preventDefault()
      const next = Math.min(entries.length - 1, historyCursor() + 1)
      setHistoryCursor(next)
      setCommandInput(entries[next].command)
      return
    }

    if (event.key === "ArrowDown") {
      event.preventDefault()
      const next = historyCursor() - 1
      if (next < 0) {
        setHistoryCursor(-1)
        setCommandInput("")
        return
      }
      setHistoryCursor(next)
      setCommandInput(entries[next].command)
    }
  }

  return (
    <Show
      when={workbench.activeServerCtx()}
      fallback={
        <div class="flex size-full flex-col items-center justify-center gap-2 px-4 text-center">
          <BugDebugIcon size={18} class="text-v2-icon-icon-muted" />
          <div class="text-[12px] font-medium text-v2-text-text-base">
            {tr("No server connected", "Nenhum servidor conectado")}
          </div>
          <p class="text-[11px] text-v2-text-text-faint">
            {tr(
              "Connect to an Onethy Code server to inspect runtime, locations, and run commands.",
              "Conecte-se a um servidor Onethy Code para inspecionar runtime, localizações e executar comandos.",
            )}
          </p>
        </div>
      }
    >
      {(ctx) => (
        <div class="flex size-full min-h-0 flex-col bg-v2-background-bg-base text-v2-text-text-base">
          {/* Action bar */}
          <div class="flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01/50 px-2.5 py-1 select-none">
            <div class="flex items-center gap-2 text-[11px] text-v2-text-text-muted">
              <span class="font-medium text-v2-text-text-base">
                {tr("Server Diagnostics", "Diagnósticos do Servidor")}
              </span>
              <Show when={serverInfo()}>
                {(info) => (
                  <span class="rounded bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[10px] text-v2-text-text-muted">
                    v{info().version} · PID {info().pid}
                  </span>
                )}
              </Show>
              <span class="hidden text-[10.5px] text-v2-text-text-faint md:inline">
                {tr("Connection: {{status}}", "Conexão: {{status}}", { status: ctx().sdk.connection.status() })}
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-1">
              <Tooltip placement="top" value={tr("Reload server diagnostics", "Recarregar diagnósticos do servidor")}>
                <button
                  type="button"
                  disabled={loading()}
                  class="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[11px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
                  aria-label={tr("Refresh diagnostics", "Atualizar diagnósticos")}
                  onClick={() => void loadDiagnostics()}
                >
                  <Show when={loading()} fallback={<Icon name="refresh" size="small" class="size-3.5" />}>
                    <Loader width={12} height={12} />
                  </Show>
                </button>
              </Tooltip>

              <button
                type="button"
                disabled={dumping()}
                class="flex h-6 items-center gap-1 rounded-[5px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[11px] font-medium text-v2-text-text-base hover:border-v2-border-border-base hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-50"
                onClick={() => void handleHeapDump()}
              >
                <Show when={dumping()} fallback={<BugDebugIcon size={12} />}>
                  <Loader width={11} height={11} />
                </Show>
                <span>Heap Dump</span>
              </button>

              <button
                type="button"
                disabled={reloading()}
                class="flex h-6 items-center gap-1 rounded-[5px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[11px] font-medium text-v2-text-text-base hover:border-v2-border-border-base hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-50"
                onClick={() => void handleReloadConfig()}
              >
                <Show when={reloading()} fallback={<Icon name="outline-rotate-clockwise" size="small" class="size-3" />}>
                  <Loader width={11} height={11} />
                </Show>
                <span>{tr("Reload Config", "Recarregar Config")}</span>
              </button>

              <button
                type="button"
                disabled={restarting()}
                class="flex h-6 items-center gap-1 rounded-[5px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[11px] font-medium text-v2-state-fg-warning hover:border-v2-border-border-base hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-50"
                onClick={() => void handleRestart()}
              >
                <Show when={restarting()} fallback={<Icon name="reset" size="small" class="size-3" />}>
                  <Loader width={11} height={11} />
                </Show>
                <span>{tr("Restart", "Reiniciar")}</span>
              </button>
            </div>
          </div>

          {/* Two-column body: Diagnostics left + Quick command console right */}
          <div class="grid min-h-0 flex-1 grid-cols-1 divide-y divide-v2-border-border-muted overflow-hidden lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            {/* Left column: Server info + Heap dump + Loaded locations */}
            <div data-slot="workbench-scroll" class="min-h-0 overflow-y-auto p-3">
              <Show when={error()}>
                {(msg) => (
                  <div class="mb-2.5 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2.5 py-1.5 text-[11px] text-v2-state-fg-danger">
                    {msg()}
                  </div>
                )}
              </Show>

              {/* Server Info */}
              <div class="mb-3 rounded-md border border-v2-border-border-muted bg-v2-background-bg-layer-01/40 p-2.5">
                <div class="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-v2-text-text-muted">
                  {tr("Server Runtime", "Runtime do Servidor")}
                </div>
                <Show
                  when={serverInfo()}
                  fallback={
                    <div class="text-[11px] text-v2-text-text-faint">
                      {loading()
                        ? tr("Querying /api/info...", "Consultando /api/info...")
                        : tr("No information available.", "Sem informações disponíveis.")}
                    </div>
                  }
                >
                  {(info) => (
                    <dl class="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 text-[11px]">
                      <dt class="text-v2-text-text-faint">{tr("Version", "Versão")}</dt>
                      <dd class="truncate font-mono text-v2-text-text-base">{info().version}</dd>
                      <dt class="text-v2-text-text-faint">PID</dt>
                      <dd class="font-mono text-v2-text-text-base">{info().pid}</dd>
                      <Show when={info().hostname}>
                        <dt class="text-v2-text-text-faint">Host</dt>
                        <dd class="truncate font-mono text-v2-text-text-base">{info().hostname}</dd>
                      </Show>
                      <dt class="text-v2-text-text-faint">Endpoints</dt>
                      <dd class="truncate font-mono text-v2-text-text-base" title={info().urls.join(", ")}>
                        {info().urls.join(", ") || ctx().sdk.url}
                      </dd>
                      <dt class="text-v2-text-text-faint">Tmp</dt>
                      <dd class="truncate font-mono text-v2-text-text-muted" title={info().paths.tmp}>
                        {info().paths.tmp}
                      </dd>
                      <dt class="text-v2-text-text-faint">{tr("Persistent PTY", "PTY Persistente")}</dt>
                      <dd class="font-mono text-v2-text-text-base">
                        {info().capabilities?.persistentPty ? tr("enabled", "habilitado") : tr("default", "padrão")}
                      </dd>
                    </dl>
                  )}
                </Show>
              </div>

              {/* Heap Dump Snapshot Result */}
              <Show when={heapDump()}>
                {(dump) => (
                  <div class="mb-3 rounded-md border border-v2-border-border-muted bg-v2-background-bg-layer-01/40 p-2.5">
                    <div class="mb-1.5 flex items-center justify-between">
                      <span class="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-v2-text-text-muted">
                        {tr("Last Heap Dump (PID {{pid}})", "Último Heap Dump (PID {{pid}})", { pid: dump().pid })}
                      </span>
                      <button
                        type="button"
                        class="text-[10.5px] text-v2-text-text-faint hover:text-v2-text-text-base"
                        onClick={() => setHeapDump(undefined)}
                      >
                        {tr("Hide", "Ocultar")}
                      </button>
                    </div>
                    <div class="mb-1.5 truncate font-mono text-[11px] text-v2-text-text-accent" title={dump().path}>
                      {dump().path}
                    </div>
                    <div class="grid grid-cols-2 gap-1.5 font-mono text-[10.5px] text-v2-text-text-muted sm:grid-cols-4">
                      <div>RSS: {formatMegabytes(dump().memory.rss)}</div>
                      <div>Heap: {formatMegabytes(dump().memory.heapUsed)} / {formatMegabytes(dump().memory.heapTotal)}</div>
                      <div>External: {formatMegabytes(dump().memory.external)}</div>
                      <div>Buffers: {formatMegabytes(dump().memory.arrayBuffers)}</div>
                    </div>
                  </div>
                )}
              </Show>

              {/* Active locations */}
              <div class="rounded-md border border-v2-border-border-muted bg-v2-background-bg-layer-01/40 p-2.5">
                <div class="mb-1.5 flex items-center justify-between">
                  <span class="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-v2-text-text-muted">
                    {tr("Loaded Locations ({{count}})", "Localizações Carregadas ({{count}})", {
                      count: locations().length,
                    })}
                  </span>
                </div>
                <Show
                  when={locations().length > 0}
                  fallback={
                    <div class="text-[11px] text-v2-text-text-faint">
                      {tr("No active locations in memory.", "Nenhuma localização ativa em memória.")}
                    </div>
                  }
                >
                  <div class="flex flex-col gap-1">
                    <For each={locations()}>
                      {(loc) => {
                        const isCurrent = () => workbench.activeDirectory() === loc.directory
                        return (
                          <div class="flex items-center justify-between gap-2 rounded-[5px] border border-v2-border-border-muted/60 bg-v2-background-bg-base px-2 py-1">
                            <div class="flex min-w-0 items-center gap-1.5">
                              <span
                                class="size-1.5 shrink-0 rounded-full"
                                classList={{
                                  "bg-v2-state-fg-success": isCurrent(),
                                  "bg-v2-icon-icon-muted": !isCurrent(),
                                }}
                              />
                              <span class="truncate font-mono text-[11px] text-v2-text-text-base" title={loc.directory}>
                                {loc.directory}
                              </span>
                            </div>
                            <button
                              type="button"
                              disabled={evictingDir() === loc.directory}
                              class="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-state-fg-danger disabled:opacity-40"
                              onClick={() => void handleEvictLocation(loc.directory)}
                            >
                              {evictingDir() === loc.directory ? tr("Evicting...", "Liberando...") : tr("Evict", "Liberar")}
                            </button>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </div>
            </div>

            {/* Right column: Quick workspace command console */}
            <div class="flex min-h-0 flex-col bg-v2-background-bg-deep/50">
              <div class="flex h-7 shrink-0 items-center justify-between border-b border-v2-border-border-muted px-3 select-none">
                <div class="flex items-center gap-1.5 text-[11px] font-medium text-v2-text-text-muted">
                  <TerminalPromptIcon size={12} />
                  <span>{tr("Quick Workspace Console", "Console Rápido do Workspace")}</span>
                </div>
                <Show when={history().length > 0}>
                  <button
                    type="button"
                    class="text-[10.5px] text-v2-text-text-faint hover:text-v2-text-text-base"
                    onClick={() => setHistory([])}
                  >
                    {tr("Clear history", "Limpar histórico")}
                  </button>
                </Show>
              </div>

              <div data-slot="workbench-scroll" class="min-h-0 flex-1 overflow-y-auto p-2.5">
                <Show
                  when={history().length > 0}
                  fallback={
                    <div class="flex h-full items-center justify-center text-center text-[11px] text-v2-text-text-faint">
                      {tr(
                        "Run quick commands in the active workspace (e.g., git status -sb, bun --version).",
                        "Execute comandos rápidos no workspace ativo (ex.: git status -sb, bun --version).",
                      )}
                    </div>
                  }
                >
                  <div class="flex flex-col gap-2">
                    <For each={history()}>
                      {(item) => {
                        const failed = () => Boolean(item.error) || (item.exit !== undefined && item.exit !== 0)
                        return (
                          <div class="rounded-md border border-v2-border-border-muted bg-v2-background-bg-base p-2">
                            <div class="mb-1 flex items-center justify-between gap-2 text-[11px]">
                              <span class="truncate font-mono font-medium text-v2-text-text-base">
                                $ {item.command}
                              </span>
                              <div class="flex shrink-0 items-center gap-1.5 text-[10px]">
                                <Show when={item.exit !== undefined}>
                                  <span
                                    class="font-mono"
                                    classList={{
                                      "text-v2-state-fg-danger": failed(),
                                      "text-v2-state-fg-success": !failed(),
                                    }}
                                  >
                                    exit {item.exit}
                                  </span>
                                </Show>
                                <span class="text-v2-text-text-faint">{formatTime(item.timestamp, intl())}</span>
                              </div>
                            </div>
                            <Show when={item.error}>
                              {(msg) => <div class="font-mono text-[11px] text-v2-state-fg-danger">{msg()}</div>}
                            </Show>
                            <Show when={item.output}>
                              <pre class="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.45] text-v2-text-text-muted select-text">
                                {item.output}
                              </pre>
                            </Show>
                            <Show when={!item.error && !item.output}>
                              <div class="font-mono text-[10.5px] text-v2-text-text-faint">
                                {tr("(no output)", "(sem saída)")}
                              </div>
                            </Show>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </div>

              <form
                class="flex shrink-0 items-center gap-1.5 border-t border-v2-border-border-muted bg-v2-background-bg-base px-2.5 py-1.5"
                onSubmit={(e) => void handleRunCommand(e)}
              >
                <span class="font-mono text-[12px] font-semibold text-v2-text-text-accent select-none">&gt;</span>
                <input
                  type="text"
                  value={commandInput()}
                  disabled={runningCmd() || !workbench.activeDirectory()}
                  placeholder={
                    workbench.activeDirectory()
                      ? tr("Run command in workspace... (Enter)", "Executar comando no workspace... (Enter)")
                      : tr("Open a workspace to run commands", "Abra um workspace para executar comandos")
                  }
                  aria-label={tr("Quick workspace command", "Comando rápido do workspace")}
                  class="h-6 min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                  onInput={(e) => setCommandInput(e.currentTarget.value)}
                  onKeyDown={handleCommandKeyDown}
                />
                <button
                  type="submit"
                  disabled={runningCmd() || !commandInput().trim() || !workbench.activeDirectory()}
                  class="flex h-6 shrink-0 items-center gap-1 rounded-[5px] bg-v2-background-bg-accent px-2.5 text-[11px] font-medium text-v2-text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-45"
                >
                  <Show when={runningCmd()} fallback={<PlayRunIcon size={11} />}>
                    <Loader width={11} height={11} />
                  </Show>
                  <span>{tr("Run", "Executar")}</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
