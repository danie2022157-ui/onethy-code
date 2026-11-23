import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { ShellInfo1 } from "@opencode/client/promise"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"
import { TerminalPromptIcon } from "../icons"
import { useWorkbench } from "../state"

type OutputData = {
  output: string
  size: number
  truncated: boolean
}

function formatDuration(started: number, completed?: number) {
  const end = completed ?? Date.now()
  const ms = Math.max(0, end - started)
  if (ms < 1000) return `${ms} ms`
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(1)} s`
  const min = Math.floor(sec / 60)
  const rem = Math.round(sec % 60)
  return `${min}m ${rem}s`
}

function formatClock(ts: number, localeTag: string) {
  return new Date(ts).toLocaleTimeString(localeTag, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function OutputTab(props: { visible?: boolean }) {
  const workbench = useWorkbench()
  const platform = usePlatform()
  const { tr, intl } = useOnethyI18n()

  const formatStatusLabel = (status: ShellInfo1["status"]) => {
    if (status === "running") return tr("Running", "Executando")
    if (status === "exited") return tr("Completed", "Concluído")
    if (status === "timeout") return tr("Timeout", "Timeout")
    return tr("Terminated", "Encerrado")
  }

  const [runs, setRuns] = createSignal<readonly ShellInfo1[]>([])
  const [selectedId, setSelectedId] = createSignal<string | undefined>(undefined)
  const [listLoading, setListLoading] = createSignal(false)
  const [listError, setListError] = createSignal<string | undefined>(undefined)
  const [outputLoading, setOutputLoading] = createSignal(false)
  const [outputError, setOutputError] = createSignal<string | undefined>(undefined)
  const [outputData, setOutputData] = createSignal<OutputData | undefined>(undefined)
  const [deletingId, setDeletingId] = createSignal<string | undefined>(undefined)

  let listGen = 0
  let outputGen = 0

  const selectedRun = createMemo(() => runs().find((item) => item.id === selectedId()))

  const loadRuns = async () => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()
    if (!ctx || !location) {
      setRuns([])
      setSelectedId(undefined)
      setOutputData(undefined)
      return
    }

    const gen = ++listGen
    setListLoading(true)
    setListError(undefined)

    const result = await ctx.sdk.api.shell
      .list({ location })
      .then((res) => ({ ok: true as const, data: res.data }))
      .catch((err) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }))

    if (gen !== listGen) return
    setListLoading(false)

    if (!result.ok) {
      setListError(result.message)
      return
    }

    const sorted = [...result.data].sort((a, b) => b.time.started - a.time.started)
    setRuns(sorted)
    setSelectedId((prev) => {
      if (prev && sorted.some((item) => item.id === prev)) return prev
      return sorted[0]?.id
    })
  }

  const loadOutput = async (shellID: string) => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()
    if (!ctx || !location) return

    const gen = ++outputGen
    setOutputLoading(true)
    setOutputError(undefined)

    const result = await ctx.sdk.api.shell
      .output({ id: shellID, location, limit: 256_000 })
      .then((res) => ({ ok: true as const, data: res.data }))
      .catch((err) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }))

    if (gen !== outputGen) return
    setOutputLoading(false)

    if (!result.ok) {
      setOutputError(result.message)
      return
    }

    setOutputData({
      output: result.data.output,
      size: result.data.size,
      truncated: result.data.truncated,
    })
  }

  // Refetch runs whenever workspace, shellRevision, or tab visibility updates.
  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()
    workbench.shellRevision()
    const visible = props.visible !== false

    if (!ctx || !location) {
      setRuns([])
      setSelectedId(undefined)
      setOutputData(undefined)
      return
    }

    if (!visible) return
    void loadRuns()
  })

  // Listen to live server shell events for the active directory.
  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    const dir = workbench.activeDirectory()
    if (!ctx || !dir) return

    const stream = ctx.sdk.event.location(dir)
    const refresh = () => {
      if (props.visible === false) return
      void loadRuns()
    }
    const offCreated = stream.on("shell.created", refresh)
    const offExited = stream.on("shell.exited", refresh)
    const offDeleted = stream.on("shell.deleted", refresh)
    onCleanup(() => {
      offCreated()
      offExited()
      offDeleted()
    })
  })

  // Load selected run output and poll while running & visible.
  createEffect(() => {
    const id = selectedId()
    const run = selectedRun()
    const visible = props.visible !== false
    workbench.shellRevision()

    if (!id || !visible) {
      if (!id) setOutputData(undefined)
      return
    }

    void loadOutput(id)

    if (run?.status !== "running") return
    const timer = setInterval(() => {
      void loadOutput(id)
      void loadRuns()
    }, 1200)
    onCleanup(() => clearInterval(timer))
  })

  const handleCopy = async () => {
    const text = outputData()?.output ?? ""
    if (!text) {
      showToast({ variant: "default", title: tr("No output to copy", "Nenhuma saída para copiar") })
      return
    }
    const err = await (platform.writeClipboardText?.(text) ?? navigator.clipboard.writeText(text))
      .then(() => undefined)
      .catch((cause) => (cause instanceof Error ? cause.message : String(cause)))

    if (err) {
      showToast({
        variant: "error",
        title: tr("Failed to copy output", "Falha ao copiar saída"),
        description: err,
      })
      return
    }
    showToast({
      variant: "success",
      title: tr("Output copied to clipboard", "Saída copiada para a área de transferência"),
    })
  }

  const handleDelete = async (id: string) => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()
    if (!ctx || !location || deletingId()) return

    setDeletingId(id)
    const err = await ctx.sdk.api.shell
      .remove({ id, location })
      .then(() => undefined)
      .catch((cause) => (cause instanceof Error ? cause.message : String(cause)))
    setDeletingId(undefined)

    if (err) {
      showToast({
        variant: "error",
        title: tr("Failed to delete execution", "Falha ao excluir execução"),
        description: err,
      })
      return
    }

    const next = runs().filter((item) => item.id !== id)
    setRuns(next)
    if (selectedId() === id) {
      setSelectedId(next[0]?.id)
      if (next.length === 0) setOutputData(undefined)
    }
    workbench.bumpShellRevision()
  }

  const handleRefresh = () => {
    void loadRuns()
    const id = selectedId()
    if (id) void loadOutput(id)
  }

  return (
    <Show
      when={workbench.activeServerCtx() && workbench.activeLocation()}
      fallback={
        <div class="flex size-full flex-col items-center justify-center gap-2 px-4 text-center">
          <TerminalPromptIcon size={18} class="text-v2-icon-icon-muted" />
          <div class="text-[12px] font-medium text-v2-text-text-base">
            {tr("No active workspace", "Nenhum workspace ativo")}
          </div>
          <p class="text-[11px] text-v2-text-text-faint">
            {tr(
              "Outputs from shell commands executed in the project will appear here.",
              "As saídas de comandos shell executados no projeto aparecerão aqui.",
            )}
          </p>
        </div>
      }
    >
      <div class="flex size-full min-h-0 bg-v2-background-bg-base text-v2-text-text-base">
        {/* Left list of shell executions */}
        <div class="flex w-[260px] shrink-0 flex-col border-e border-v2-border-border-muted bg-v2-background-bg-layer-01/35">
          <div class="flex h-8 shrink-0 items-center justify-between border-b border-v2-border-border-muted px-2.5 select-none">
            <span class="text-[11px] font-medium text-v2-text-text-muted">
              {tr("Runs ({{count}})", "Execuções ({{count}})", { count: runs().length })}
            </span>
            <Tooltip placement="top" value={tr("Refresh runs", "Atualizar execuções")}>
              <button
                type="button"
                disabled={listLoading()}
                class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
                aria-label={tr("Refresh runs list", "Atualizar lista de execuções")}
                onClick={handleRefresh}
              >
                <Show when={listLoading()} fallback={<Icon name="refresh" size="small" class="size-3.5" />}>
                  <Loader width={12} height={12} />
                </Show>
              </button>
            </Tooltip>
          </div>

          <div data-slot="workbench-scroll" class="min-h-0 flex-1 overflow-y-auto p-1">
            <Show when={listError()}>
              {(msg) => <div class="p-2 text-[11px] text-v2-state-fg-danger">{msg()}</div>}
            </Show>

            <Show
              when={runs().length > 0}
              fallback={
                <Show when={!listLoading()}>
                  <div class="px-2.5 py-6 text-center text-[11.5px] text-v2-text-text-faint">
                    {tr(
                      "No shell executions recorded in this workspace.",
                      "Nenhuma execução shell registrada neste workspace.",
                    )}
                  </div>
                </Show>
              }
            >
              <For each={runs()}>
                {(run) => {
                  const isSelected = () => selectedId() === run.id
                  const isFailed = () =>
                    run.status === "timeout" ||
                    run.status === "killed" ||
                    (run.status === "exited" && run.exit !== undefined && run.exit !== 0)
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      class="group mb-0.5 flex cursor-pointer items-start justify-between gap-1.5 rounded-[6px] px-2 py-1.5 text-start transition-colors"
                      classList={{
                        "bg-v2-overlay-simple-overlay-pressed text-v2-text-text-base": isSelected(),
                        "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                          !isSelected(),
                      }}
                      onClick={() => setSelectedId(run.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          setSelectedId(run.id)
                        }
                      }}
                    >
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                          <span
                            class="size-1.5 shrink-0 rounded-full"
                            classList={{
                              "onethy-pulse-dot bg-v2-background-bg-accent": run.status === "running",
                              "bg-v2-state-fg-danger": isFailed(),
                              "bg-v2-state-fg-success": run.status === "exited" && !isFailed(),
                            }}
                          />
                          <span class="truncate font-mono text-[11.5px] text-v2-text-text-base" title={run.command}>
                            {run.command}
                          </span>
                        </div>
                        <div class="mt-0.5 flex items-center gap-1.5 ps-3 text-[10px] text-v2-text-text-faint">
                          <span>{formatStatusLabel(run.status)}</span>
                          <Show when={run.exit !== undefined}>
                            <span
                              class="font-mono"
                              classList={{
                                "text-v2-state-fg-danger": run.exit !== 0,
                                "text-v2-state-fg-success": run.exit === 0,
                              }}
                            >
                              exit {run.exit}
                            </span>
                          </Show>
                          <span>· {formatClock(run.time.started, intl())}</span>
                        </div>
                      </div>

                      <Tooltip placement="top" value={tr("Delete execution", "Excluir execução")}>
                        <button
                          type="button"
                          disabled={deletingId() === run.id}
                          class="flex size-5 shrink-0 items-center justify-center rounded text-v2-icon-icon-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-state-fg-danger disabled:opacity-40"
                          aria-label={tr("Delete execution {{command}}", "Excluir execução {{command}}", {
                            command: run.command,
                          })}
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleDelete(run.id)
                          }}
                        >
                          <Icon name="trash" size="small" class="size-3" />
                        </button>
                      </Tooltip>
                    </div>
                  )
                }}
              </For>
            </Show>
          </div>
        </div>

        {/* Right output inspector */}
        <div class="flex min-w-0 flex-1 flex-col">
          <Show
            when={selectedRun()}
            fallback={
              <div class="flex size-full items-center justify-center px-4 text-[12px] text-v2-text-text-faint">
                {tr(
                  "Select a run on the left to view its full output.",
                  "Selecione uma execução à esquerda para visualizar a saída completa.",
                )}
              </div>
            }
          >
            {(run) => {
              const isFailed = () =>
                run().status === "timeout" ||
                run().status === "killed" ||
                (run().status === "exited" && run().exit !== undefined && run().exit !== 0)

              return (
                <>
                  <div class="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01/50 px-3 select-none">
                    <div class="flex min-w-0 items-center gap-2">
                      <span
                        class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                        classList={{
                          "bg-v2-background-bg-accent/15 text-v2-text-text-accent": run().status === "running",
                          "bg-v2-state-fg-danger/15 text-v2-state-fg-danger": isFailed(),
                          "bg-v2-state-fg-success/15 text-v2-state-fg-success":
                            run().status === "exited" && !isFailed(),
                        }}
                      >
                        {formatStatusLabel(run().status)}
                        <Show when={run().exit !== undefined}>{` · exit ${run().exit}`}</Show>
                      </span>
                      <span class="truncate font-mono text-[11.5px] text-v2-text-text-base" title={run().command}>
                        {run().command}
                      </span>
                      <span class="hidden shrink-0 text-[10.5px] text-v2-text-text-faint md:inline">
                        {formatDuration(run().time.started, run().time.completed)}
                      </span>
                      <Show when={outputData()}>
                        {(data) => (
                          <span class="hidden shrink-0 font-mono text-[10px] text-v2-text-text-faint lg:inline">
                            · {formatBytes(data().size)}
                          </span>
                        )}
                      </Show>
                    </div>

                    <div class="flex shrink-0 items-center gap-1">
                      <Tooltip placement="top" value={tr("Copy output", "Copiar saída")}>
                        <button
                          type="button"
                          class="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[11px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                          aria-label={tr("Copy output", "Copiar saída")}
                          onClick={() => void handleCopy()}
                        >
                          <Icon name="outline-copy" size="small" class="size-3.5" />
                          <span class="hidden sm:inline">{tr("Copy", "Copiar")}</span>
                        </button>
                      </Tooltip>

                      <Tooltip placement="top" value={tr("Refresh output", "Atualizar saída")}>
                        <button
                          type="button"
                          disabled={outputLoading()}
                          class="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[11px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
                          aria-label={tr("Refresh output", "Atualizar saída")}
                          onClick={handleRefresh}
                        >
                          <Show when={outputLoading()} fallback={<Icon name="refresh" size="small" class="size-3.5" />}>
                            <Loader width={12} height={12} />
                          </Show>
                        </button>
                      </Tooltip>

                      <Tooltip placement="top" value={tr("Delete record", "Excluir registro")}>
                        <button
                          type="button"
                          disabled={deletingId() === run().id}
                          class="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[11px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-state-fg-danger disabled:opacity-50"
                          aria-label={tr("Delete selected execution", "Excluir execução selecionada")}
                          onClick={() => void handleDelete(run().id)}
                        >
                          <Icon name="trash" size="small" class="size-3.5" />
                        </button>
                      </Tooltip>
                    </div>
                  </div>

                  <div
                    data-slot="workbench-scroll"
                    class="min-h-0 flex-1 overflow-auto bg-v2-background-bg-deep/60 p-3"
                  >
                    <Show when={outputError()}>
                      {(msg) => <div class="mb-2 text-[11.5px] text-v2-state-fg-danger">{msg()}</div>}
                    </Show>

                    <Show when={outputData()?.truncated}>
                      <div class="mb-2 rounded border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-2.5 py-1 text-[11px] text-v2-state-fg-warning">
                        {tr(
                          "Output truncated at 256 KB. The full log remains saved at {{file}}.",
                          "Saída truncada em 256 KB. O log completo permanece salvo em {{file}}.",
                          { file: run().file },
                        )}
                      </div>
                    </Show>

                    <Show
                      when={(outputData()?.output ?? "").length > 0}
                      fallback={
                        <div class="font-mono text-[11.5px] text-v2-text-text-faint">
                          {outputLoading()
                            ? tr("Loading output...", "Carregando saída...")
                            : run().status === "running"
                              ? tr("Waiting for command output...", "Aguardando saída do comando...")
                              : tr("(no output)", "(sem saída)")}
                        </div>
                      }
                    >
                      <pre class="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.55] text-v2-text-text-base select-text">
                        {outputData()?.output}
                      </pre>
                    </Show>
                  </div>
                </>
              )
            }}
          </Show>
        </div>
      </div>
    </Show>
  )
}
