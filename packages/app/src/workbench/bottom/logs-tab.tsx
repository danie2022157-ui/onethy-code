import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"
import { LogsStreamIcon, PlayRunIcon, SearchCodeIcon, StopSquareIcon } from "../icons"

type LogSource = "all" | "server" | "cli" | "tui"
type LogLevel = "all" | "ERROR" | "WARN" | "INFO" | "DEBUG"

const SOURCE_VALUES: readonly LogSource[] = ["all", "server", "cli", "tui"]

const LEVEL_VALUES: readonly LogLevel[] = ["all", "ERROR", "WARN", "INFO", "DEBUG"]

function lineColorClass(line: string) {
  if (line.includes("level=ERROR")) return "text-v2-state-fg-danger"
  if (line.includes("level=WARN")) return "text-v2-state-fg-warning"
  if (line.includes("level=DEBUG")) return "text-v2-text-text-faint"
  return "text-v2-text-text-base"
}

function truncateLine(line: string) {
  return line.length > 700 ? `${line.slice(0, 700)}…` : line
}

export function LogsTab(props: { visible: boolean }) {
  const platform = usePlatform()
  const { tr } = useOnethyI18n()

  const sourceLabel = (value: LogSource) => {
    if (value === "all") return tr("Source: All", "Origem: Todas")
    if (value === "server") return tr("Source: Server", "Origem: Server")
    if (value === "cli") return tr("Source: CLI", "Origem: CLI")
    return tr("Source: TUI", "Origem: TUI")
  }

  const levelLabel = (value: LogLevel) => {
    if (value === "all") return tr("Level: All", "Nível: Todos")
    return value
  }

  const [source, setSource] = createSignal<LogSource>("all")
  const [level, setLevel] = createSignal<LogLevel>("all")
  const [search, setSearch] = createSignal("")
  const [paused, setPaused] = createSignal(false)
  const [lines, setLines] = createSignal<readonly string[]>([])
  const [filePath, setFilePath] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [exporting, setExporting] = createSignal(false)

  let scrollBox: HTMLDivElement | undefined
  let inFlight = false
  let requestGen = 0
  let disposed = false

  onCleanup(() => {
    disposed = true
  })

  const canReadLogs = createMemo(() => Boolean(platform.readLogs))

  const fetchLogs = async (opts?: { force?: boolean }) => {
    const read = platform.readLogs
    if (!read || disposed) return
    if (inFlight && !opts?.force) return

    inFlight = true
    const gen = ++requestGen
    if (lines().length === 0) setLoading(true)

    const result = await read({
      source: source(),
      level: level(),
      search: search().trim() || undefined,
      lines: 250,
    })
      .then((res) => ({ ok: true as const, data: res }))
      .catch((err) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }))

    inFlight = false
    if (disposed || gen !== requestGen) return
    setLoading(false)

    if (!result.ok) {
      setError(result.message)
      return
    }

    const wasNearBottom =
      !scrollBox || scrollBox.scrollHeight - scrollBox.scrollTop - scrollBox.clientHeight < 36

    setFilePath(result.data.file)
    setLines(result.data.lines)
    setError(undefined)

    if (wasNearBottom && !paused()) {
      requestAnimationFrame(() => {
        if (scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight
      })
    }
  }

  // Poll every 1.5s ONLY when visible is true and not paused; refresh on filter/visibility changes.
  createEffect(() => {
    const visible = props.visible
    const isPaused = paused()
    const currentSource = source()
    const currentLevel = level()
    const currentSearch = search()

    if (!visible || !platform.readLogs) return

    // Read filter signals so changes immediately refresh the view.
    void currentSource
    void currentLevel

    const debounceMs = currentSearch ? 140 : 0
    const initialTimer = setTimeout(() => {
      void fetchLogs({ force: true })
    }, debounceMs)

    if (isPaused) {
      onCleanup(() => clearTimeout(initialTimer))
      return
    }

    const pollTimer = setInterval(() => {
      void fetchLogs()
    }, 1500)

    onCleanup(() => {
      clearTimeout(initialTimer)
      clearInterval(pollTimer)
    })
  })

  const handleCopy = async () => {
    const content = lines().join("\n")
    if (!content) {
      showToast({ variant: "default", title: tr("No logs to copy", "Nenhum log para copiar") })
      return
    }
    const err = await (platform.writeClipboardText?.(content) ?? navigator.clipboard.writeText(content))
      .then(() => undefined)
      .catch((cause) => (cause instanceof Error ? cause.message : String(cause)))

    if (err) {
      showToast({ variant: "error", title: tr("Failed to copy logs", "Falha ao copiar logs"), description: err })
      return
    }
    showToast({
      variant: "success",
      title: tr("Filtered logs copied", "Logs filtrados copiados"),
      description: tr("Known secrets were redacted.", "Segredos conhecidos foram ocultados."),
    })
  }

  const handleExportBundle = async () => {
    const exporter = platform.exportDebugLogs
    if (!exporter || exporting()) return

    setExporting(true)
    const result = await exporter()
      .then((exportedPath) => ({ ok: true as const, path: exportedPath }))
      .catch((err) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }))
    setExporting(false)

    if (!result.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to export debug bundle", "Falha ao exportar bundle de debug"),
        description: result.message,
      })
      return
    }

    showToast({
      variant: "success",
      title: tr("Diagnostic bundle exported", "Bundle de diagnóstico exportado"),
      description: result.path,
    })
  }

  const displayLines = createMemo(() => lines().map(truncateLine))

  return (
    <Show
      when={canReadLogs()}
      fallback={
        <div class="flex size-full flex-col items-center justify-center gap-2 px-4 text-center">
          <LogsStreamIcon size={18} class="text-v2-icon-icon-muted" />
          <div class="text-[12px] font-medium text-v2-text-text-base">
            {tr(
              "Local log reading is available in the Desktop app",
              "Leitura local de logs disponível no aplicativo Desktop",
            )}
          </div>
          <p class="max-w-[360px] text-[11px] text-v2-text-text-faint">
            {tr(
              "In the web client without a native file bridge, use the CLI with onethy debug logs or Desktop mode.",
              "No cliente web sem ponte nativa de arquivos, utilize a CLI com onethy debug logs ou o modo Desktop.",
            )}
          </p>
        </div>
      }
    >
      <div class="flex size-full min-h-0 flex-col bg-v2-background-bg-base text-v2-text-text-base">
        {/* Toolbar matching TUI /logs filters & actions */}
        <div class="flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01/50 px-2.5 py-1 select-none">
          <div class="flex flex-wrap items-center gap-1.5">
            <select
              aria-label={tr("Filter log source", "Filtrar origem dos logs")}
              value={source()}
              class="h-6 rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 text-[11px] text-v2-text-text-base outline-none focus:border-v2-border-border-focus"
              onChange={(e) => setSource(e.currentTarget.value as LogSource)}
            >
              <For each={SOURCE_VALUES}>
                {(item) => <option value={item}>{sourceLabel(item)}</option>}
              </For>
            </select>

            <select
              aria-label={tr("Filter log level", "Filtrar nível dos logs")}
              value={level()}
              class="h-6 rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 text-[11px] text-v2-text-text-base outline-none focus:border-v2-border-border-focus"
              onChange={(e) => setLevel(e.currentTarget.value as LogLevel)}
            >
              <For each={LEVEL_VALUES}>
                {(item) => <option value={item}>{levelLabel(item)}</option>}
              </For>
            </select>

            <div class="flex h-6 w-[180px] items-center gap-1.5 rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 focus-within:border-v2-border-border-focus">
              <SearchCodeIcon size={12} class="shrink-0 text-v2-icon-icon-muted" />
              <input
                type="text"
                value={search()}
                placeholder={tr("Filter logs...", "Filtrar nos logs...")}
                aria-label={tr("Search text in logs", "Buscar texto nos logs")}
                class="min-w-0 flex-1 bg-transparent text-[11px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                onInput={(e) => setSearch(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && search()) {
                    e.stopPropagation()
                    setSearch("")
                  }
                }}
              />
              <Show when={search().length > 0}>
                <button
                  type="button"
                  class="flex size-3.5 items-center justify-center rounded text-v2-icon-icon-muted hover:text-v2-text-text-base"
                  aria-label={tr("Clear log search", "Limpar busca de logs")}
                  onClick={() => setSearch("")}
                >
                  <Icon name="outline-xmark" size="small" class="size-3" />
                </button>
              </Show>
            </div>

            <div class="flex items-center gap-1.5 ps-1 text-[10.5px] text-v2-text-text-muted">
              <span
                class="size-1.5 rounded-full"
                classList={{
                  "onethy-pulse-dot bg-v2-state-fg-success": props.visible && !paused(),
                  "bg-v2-text-text-faint": !props.visible || paused(),
                }}
              />
              <span>{paused() ? tr("Paused", "Pausado") : tr("Live", "Ao vivo")}</span>
            </div>
          </div>

          <div class="flex items-center gap-1">
            <Tooltip
              placement="top"
              value={
                paused()
                  ? tr("Resume auto-refresh (1.5s)", "Retomar atualização automática (1,5s)")
                  : tr("Pause auto-refresh", "Pausar atualização automática")
              }
            >
              <button
                type="button"
                class="flex h-6 items-center gap-1 rounded-[5px] border border-v2-border-border-muted px-2 text-[11px] font-medium transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                classList={{
                  "text-v2-state-fg-warning": paused(),
                  "text-v2-text-text-base": !paused(),
                }}
                onClick={() => setPaused((v) => !v)}
              >
                <Show when={paused()} fallback={<StopSquareIcon size={11} />}>
                  <PlayRunIcon size={11} />
                </Show>
                <span>{paused() ? tr("Resume", "Retomar") : tr("Pause", "Pausar")}</span>
              </button>
            </Tooltip>

            <Tooltip placement="top" value={tr("Refresh now", "Atualizar agora")}>
              <button
                type="button"
                disabled={loading()}
                class="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[11px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
                aria-label={tr("Refresh logs", "Atualizar logs")}
                onClick={() => void fetchLogs({ force: true })}
              >
                <Show when={loading()} fallback={<Icon name="refresh" size="small" class="size-3.5" />}>
                  <Loader width={12} height={12} />
                </Show>
              </button>
            </Tooltip>

            <Tooltip
              placement="top"
              value={tr("Copy filtered logs (secrets redacted)", "Copiar logs filtrados (segredos ocultados)")}
            >
              <button
                type="button"
                class="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[11px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                aria-label={tr("Copy logs", "Copiar logs")}
                onClick={() => void handleCopy()}
              >
                <Icon name="outline-copy" size="small" class="size-3.5" />
                <span class="hidden md:inline">{tr("Copy", "Copiar")}</span>
              </button>
            </Tooltip>

            <Show when={platform.exportDebugLogs}>
              <Tooltip placement="top" value={tr("Export full diagnostic bundle", "Exportar pacote completo de diagnóstico")}>
                <button
                  type="button"
                  disabled={exporting()}
                  class="flex h-6 items-center gap-1 rounded-[5px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[11px] font-medium text-v2-text-text-base hover:border-v2-border-border-base hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-50"
                  onClick={() => void handleExportBundle()}
                >
                  <Show when={exporting()} fallback={<Icon name="download" size="small" class="size-3" />}>
                    <Loader width={11} height={11} />
                  </Show>
                  <span class="hidden sm:inline">{tr("Export Bundle", "Exportar Bundle")}</span>
                </button>
              </Tooltip>
            </Show>
          </div>
        </div>

        {/* Log lines stream */}
        <div
          ref={scrollBox}
          data-slot="workbench-scroll"
          class="min-h-0 flex-1 overflow-auto bg-v2-background-bg-deep/60 px-3 py-2 font-mono text-[11px] leading-[1.55] select-text"
        >
          <Show when={error()}>
            {(msg) => <div class="mb-2 text-v2-state-fg-danger">{msg()}</div>}
          </Show>

          <Show
            when={displayLines().length > 0}
            fallback={
              <div class="py-4 text-v2-text-text-faint">
                {loading()
                  ? tr("Loading logs...", "Carregando logs...")
                  : tr(
                      "No logs match the current filter. For DEBUG: set ONETHY_DEBUG=1 and restart the service.",
                      "Nenhum log correspondente ao filtro atual. Para DEBUG: defina ONETHY_DEBUG=1 e reinicie o serviço.",
                    )}
              </div>
            }
          >
            <For each={displayLines()}>
              {(line) => (
                <div class={`whitespace-pre-wrap break-all ${lineColorClass(line)}`}>{line}</div>
              )}
            </For>
          </Show>
        </div>

        {/* Footer metadata */}
        <div class="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-v2-border-border-muted bg-v2-background-bg-layer-01/40 px-3 text-[10px] text-v2-text-text-faint select-none">
          <span class="truncate font-mono" title={filePath()}>
            {filePath() || tr("Waiting for log file...", "Aguardando arquivo de log...")}
          </span>
          <span class="shrink-0">
            {lines().length === 1
              ? tr(
                  "1 line · Known secrets redacted; review before sharing.",
                  "1 linha · Segredos conhecidos ocultados; revise antes de compartilhar.",
                )
              : tr(
                  "{{count}} lines · Known secrets redacted; review before sharing.",
                  "{{count}} linhas · Segredos conhecidos ocultados; revise antes de compartilhar.",
                  { count: lines().length },
                )}
          </span>
        </div>
      </div>
    </Show>
  )
}
