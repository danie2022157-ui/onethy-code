import { createMemo, createSignal, For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { showToast } from "@/shell/notifications/toast"
import { CheckShieldIcon } from "../icons"
import { useWorkbench, type DiagnosticProblem } from "../state"

type SeverityFilter = "all" | "error" | "warning"

type CheckPreset = {
  id: string
  command: string
}

type CheckSummary =
  | { kind: "failed" }
  | { kind: "diagnostics"; count: number }
  | { kind: "exit"; code: number }
  | { kind: "clean" }

const CHECK_PRESETS: readonly CheckPreset[] = [
  { id: "typecheck", command: "bun run typecheck" },
  { id: "check", command: "bun run check" },
  { id: "lint", command: "bun run lint" },
  { id: "build", command: "bun run build" },
  { id: "tsc", command: "npx tsc --noEmit" },
  { id: "custom", command: "" },
]

const ANSI_ESCAPE = /\x1b\[[0-9;]*[a-zA-Z]/g

// Matches TypeScript/MSBuild style: path/to/file.ts(12,4): error TS2322: Message
const PAREN_DIAGNOSTIC = /^\s*([^\s:(][^:(\r\n]*?)\((\d+),(\d+)\):\s*(error|warning|warn|info)\s*(?:([A-Za-z0-9_-]+):\s*)?(.+)$/i

// Matches colon style with col: path/to/file.ts:12:4 - error TS2322: Message
const COLON_COL_DIAGNOSTIC =
  /^\s*([A-Za-z]:[\\/][^:\r\n]+|[^:\s][^:\r\n]*?):(\d+):(\d+)\s*(?:-|–|:)?\s*(error|warning|warn|info)\s*(?:([A-Za-z0-9_-]+):\s*)?(.+)$/i

// Matches colon style without col: path/to/file.ts:12 - error TS2322: Message
const COLON_LINE_DIAGNOSTIC =
  /^\s*([A-Za-z]:[\\/][^:\r\n]+|[^:\s][^:\r\n]*?):(\d+)\s*(?:-|–|:)\s*(error|warning|warn|info)\s*(?:([A-Za-z0-9_-]+):\s*)?(.+)$/i

function normalizeSeverity(raw: string): DiagnosticProblem["severity"] {
  const lower = raw.toLowerCase()
  if (lower === "error") return "error"
  if (lower === "warning" || lower === "warn") return "warning"
  return "info"
}

function normalizeDiagnosticFile(raw: string) {
  return raw.trim().replaceAll("\\", "/").replace(/^\.\//, "")
}

export function parseDiagnosticOutput(output: string): DiagnosticProblem[] {
  if (!output) return []

  const clean = output.replace(ANSI_ESCAPE, "")
  const lines = clean.split(/\r?\n/)
  const results: DiagnosticProblem[] = []
  const seen = new Set<string>()

  for (const rawLine of lines) {
    const lineText = rawLine.trimEnd()
    if (!lineText) continue

    const parenMatch = PAREN_DIAGNOSTIC.exec(lineText)
    if (parenMatch) {
      const file = normalizeDiagnosticFile(parenMatch[1])
      const line = Number(parenMatch[2])
      const column = Number(parenMatch[3])
      const severity = normalizeSeverity(parenMatch[4])
      const code = parenMatch[5]?.trim()
      const message = parenMatch[6].trim()
      const key = `${file}:${line}:${column}:${severity}:${message}`
      if (!seen.has(key)) {
        seen.add(key)
        results.push({
          id: `diag:${results.length}:${file}:${line}:${column}`,
          severity,
          source: code || "Diagnóstico",
          message,
          file,
          line,
          column,
        })
      }
      continue
    }

    const colonColMatch = COLON_COL_DIAGNOSTIC.exec(lineText)
    if (colonColMatch) {
      const file = normalizeDiagnosticFile(colonColMatch[1])
      const line = Number(colonColMatch[2])
      const column = Number(colonColMatch[3])
      const severity = normalizeSeverity(colonColMatch[4])
      const code = colonColMatch[5]?.trim()
      const message = colonColMatch[6].trim()
      const key = `${file}:${line}:${column}:${severity}:${message}`
      if (!seen.has(key)) {
        seen.add(key)
        results.push({
          id: `diag:${results.length}:${file}:${line}:${column}`,
          severity,
          source: code || "Diagnóstico",
          message,
          file,
          line,
          column,
        })
      }
      continue
    }

    const colonLineMatch = COLON_LINE_DIAGNOSTIC.exec(lineText)
    if (colonLineMatch) {
      const file = normalizeDiagnosticFile(colonLineMatch[1])
      const line = Number(colonLineMatch[2])
      const severity = normalizeSeverity(colonLineMatch[3])
      const code = colonLineMatch[4]?.trim()
      const message = colonLineMatch[5].trim()
      const key = `${file}:${line}:0:${severity}:${message}`
      if (!seen.has(key)) {
        seen.add(key)
        results.push({
          id: `diag:${results.length}:${file}:${line}:0`,
          severity,
          source: code || "Diagnóstico",
          message,
          file,
          line,
        })
      }
    }
  }

  return results
}

function toWorkspaceRelativePath(file: string, workspaceDir: string | undefined) {
  const normalizedFile = file.replaceAll("\\", "/")
  if (!workspaceDir) return normalizedFile
  const normalizedDir = workspaceDir.replaceAll("\\", "/").replace(/\/+$/, "")
  if (!normalizedDir) return normalizedFile
  if (normalizedFile.toLowerCase().startsWith(`${normalizedDir.toLowerCase()}/`)) {
    return normalizedFile.slice(normalizedDir.length + 1)
  }
  return normalizedFile
}

export function ProblemsTab() {
  const workbench = useWorkbench()
  const { tr } = useOnethyI18n()

  const [filter, setFilter] = createSignal<SeverityFilter>("all")
  const [presetId, setPresetId] = createSignal<string>(CHECK_PRESETS[0].id)
  const [customCommand, setCustomCommand] = createSignal("bun run typecheck")
  const [running, setRunning] = createSignal(false)
  const [lastCheckSummary, setLastCheckSummary] = createSignal<CheckSummary | undefined>(undefined)

  const presetLabel = (preset: CheckPreset) =>
    preset.id === "custom" ? tr("Custom command...", "Comando personalizado...") : preset.command

  const lastCheckSummaryText = createMemo(() => {
    const summary = lastCheckSummary()
    if (!summary) return undefined
    if (summary.kind === "failed") return tr("Failed to run check", "Falha ao executar verificação")
    if (summary.kind === "diagnostics") {
      return summary.count === 1
        ? tr("1 diagnostic found", "1 diagnóstico encontrado")
        : tr("{{count}} diagnostics found", "{{count}} diagnósticos encontrados", { count: summary.count })
    }
    if (summary.kind === "exit") {
      return tr("Failed (exit {{code}})", "Falhou (exit {{code}})", { code: summary.code })
    }
    return tr("No issues found", "Nenhum problema encontrado")
  })

  const activeCommand = createMemo(() => {
    if (presetId() === "custom") return customCommand().trim()
    return CHECK_PRESETS.find((item) => item.id === presetId())?.command ?? "bun run typecheck"
  })

  const allProblems = () => workbench.problems()
  const errorCount = createMemo(() => allProblems().filter((p) => p.severity === "error").length)
  const warningCount = createMemo(() => allProblems().filter((p) => p.severity === "warning").length)

  const filteredProblems = createMemo(() => {
    const mode = filter()
    if (mode === "all") return allProblems()
    return allProblems().filter((item) => item.severity === mode)
  })

  const runProjectCheck = async () => {
    const command = activeCommand()
    if (!command || running()) return

    if (!workbench.activeServerCtx() || !workbench.activeDirectory()) {
      showToast({
        variant: "error",
        title: tr("No active workspace", "Nenhum workspace ativo"),
        description: tr("Open a project to run the check.", "Abra um projeto para executar a verificação."),
      })
      return
    }

    setRunning(true)
    setLastCheckSummary(undefined)
    const result = await workbench.runShellCommand(command, { timeout: 120_000 })
    setRunning(false)

    if (result.error) {
      workbench.setCustomProblems([
        {
          id: `check-err:${Date.now()}`,
          severity: "error",
          source: command,
          message: result.error,
          actionLabel: tr("View in Output", "Ver no Output"),
          onAction: () => workbench.openBottom("output"),
        },
      ])
      setLastCheckSummary({ kind: "failed" })
      return
    }

    const parsed = parseDiagnosticOutput(result.output)
    if (parsed.length > 0) {
      workbench.setCustomProblems(parsed)
      setLastCheckSummary({ kind: "diagnostics", count: parsed.length })
      return
    }

    if (result.exit !== undefined && result.exit !== 0) {
      const firstLine =
        result.output
          .replace(ANSI_ESCAPE, "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0) ??
        tr("Command exited with code {{code}}", "Comando finalizado com código {{code}}", { code: result.exit })

      workbench.setCustomProblems([
        {
          id: `check-exit:${Date.now()}`,
          severity: "error",
          source: command,
          message: firstLine,
          actionLabel: tr("View in Output", "Ver no Output"),
          onAction: () => workbench.openBottom("output"),
        },
      ])
      setLastCheckSummary({ kind: "exit", code: result.exit })
      return
    }

    workbench.setCustomProblems([])
    setLastCheckSummary({ kind: "clean" })
    showToast({
      variant: "success",
      title: tr("Check completed", "Verificação concluída"),
      description: tr("{{command}} finished with no issues.", "{{command}} finalizou sem problemas.", { command }),
    })
  }

  const handleOpenProblem = (problem: DiagnosticProblem) => {
    if (problem.file) {
      const target = toWorkspaceRelativePath(problem.file, workbench.activeDirectory())
      void workbench.openFile(target, { line: problem.line, edit: true })
      return
    }
    problem.onAction?.()
  }

  const handleClear = () => {
    workbench.setCustomProblems([])
    setLastCheckSummary(undefined)
  }

  return (
    <div class="flex size-full min-h-0 flex-col bg-v2-background-bg-base text-v2-text-text-base">
      {/* Filter & project check toolbar */}
      <div class="flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01/50 px-2.5 py-1 select-none">
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11px] font-medium transition-colors"
            classList={{
              "bg-v2-overlay-simple-overlay-pressed text-v2-text-text-base": filter() === "all",
              "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                filter() !== "all",
            }}
            onClick={() => setFilter("all")}
          >
            <span>{tr("All", "Todos")}</span>
            <span class="rounded bg-v2-background-bg-layer-02 px-1 py-0.5 font-mono text-[10px] leading-none">
              {allProblems().length}
            </span>
          </button>

          <button
            type="button"
            class="flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11px] font-medium transition-colors"
            classList={{
              "bg-v2-overlay-simple-overlay-pressed text-v2-state-fg-danger": filter() === "error",
              "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                filter() !== "error",
            }}
            onClick={() => setFilter("error")}
          >
            <Icon
              name="circle-xmark"
              size="small"
              class={errorCount() > 0 ? "size-3 text-v2-state-fg-danger" : "size-3 text-v2-icon-icon-muted"}
            />
            <span>{tr("Errors", "Erros")}</span>
            <span class="font-mono text-[10px]">{errorCount()}</span>
          </button>

          <button
            type="button"
            class="flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11px] font-medium transition-colors"
            classList={{
              "bg-v2-overlay-simple-overlay-pressed text-v2-state-fg-warning": filter() === "warning",
              "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                filter() !== "warning",
            }}
            onClick={() => setFilter("warning")}
          >
            <Icon
              name="outline-hexagonal-warning"
              size="small"
              class={warningCount() > 0 ? "size-3 text-v2-state-fg-warning" : "size-3 text-v2-icon-icon-muted"}
            />
            <span>{tr("Warnings", "Avisos")}</span>
            <span class="font-mono text-[10px]">{warningCount()}</span>
          </button>

          <Show when={lastCheckSummaryText()}>
            {(summary) => (
              <span class="hidden ps-1 text-[11px] text-v2-text-text-faint xl:inline">· {summary()}</span>
            )}
          </Show>
        </div>

        <div class="flex items-center gap-1.5">
          <select
            aria-label={tr("Project check command", "Comando de verificação do projeto")}
            value={presetId()}
            disabled={running()}
            class="h-6 rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 font-mono text-[11px] text-v2-text-text-base outline-none focus:border-v2-border-border-focus"
            onChange={(e) => setPresetId(e.currentTarget.value)}
          >
            <For each={CHECK_PRESETS}>
              {(preset) => <option value={preset.id}>{presetLabel(preset)}</option>}
            </For>
          </select>

          <Show when={presetId() === "custom"}>
            <input
              type="text"
              value={customCommand()}
              disabled={running()}
              placeholder={tr("Command (e.g., bun run typecheck)", "Comando (ex.: bun run typecheck)")}
              aria-label={tr("Custom check command", "Comando personalizado de verificação")}
              class="h-6 w-[200px] rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 font-mono text-[11px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint focus:border-v2-border-border-focus"
              onInput={(e) => setCustomCommand(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void runProjectCheck()
                }
              }}
            />
          </Show>

          <button
            type="button"
            disabled={running() || !activeCommand() || !workbench.activeDirectory()}
            class="flex h-6 items-center gap-1.5 rounded-[5px] bg-v2-background-bg-accent px-2.5 text-[11px] font-medium text-v2-text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-50"
            onClick={() => void runProjectCheck()}
          >
            <Show when={running()} fallback={<CheckShieldIcon size={12} />}>
              <Loader width={11} height={11} />
            </Show>
            <span>{running() ? tr("Checking...", "Verificando...") : tr("Check Project", "Verificar Projeto")}</span>
          </button>

          <Tooltip placement="top" value={tr("Clear check diagnostics", "Limpar diagnósticos de verificação")}>
            <button
              type="button"
              class="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[11px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
              aria-label={tr("Clear diagnostics", "Limpar diagnósticos")}
              onClick={handleClear}
            >
              <Icon name="trash" size="small" class="size-3.5" />
              <span class="hidden sm:inline">{tr("Clear", "Limpar")}</span>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Diagnostic items list */}
      <div data-slot="workbench-scroll" class="min-h-0 flex-1 overflow-y-auto py-1">
        <Show
          when={filteredProblems().length > 0}
          fallback={
            <div class="flex size-full flex-col items-center justify-center gap-2 px-4 text-center">
              <CheckShieldIcon size={18} class="text-v2-state-fg-success" />
              <div class="text-[12px] font-medium text-v2-text-text-base">
                {allProblems().length === 0
                  ? tr("No problems detected in workspace", "Nenhum problema detectado no workspace")
                  : tr("No diagnostics match the current filter", "Nenhum diagnóstico corresponde ao filtro atual")}
              </div>
              <p class="max-w-[360px] text-[11px] text-v2-text-text-faint">
                {tr(
                  "Click Check Project to run typecheck or linter and jump straight to each line.",
                  "Clique em Verificar Projeto para executar o typecheck ou linter e navegar direto para cada linha.",
                )}
              </p>
            </div>
          }
        >
          <For each={filteredProblems()}>
            {(problem) => {
              const clickable = () => Boolean(problem.file || problem.onAction)
              const locationText = () => {
                if (!problem.file) return ""
                const rel = toWorkspaceRelativePath(problem.file, workbench.activeDirectory())
                if (problem.line === undefined) return rel
                if (problem.column === undefined) return `${rel}:${problem.line}`
                return `${rel}:${problem.line}:${problem.column}`
              }

              return (
                <div
                  role={clickable() ? "button" : undefined}
                  tabIndex={clickable() ? 0 : undefined}
                  class="flex items-start justify-between gap-3 border-b border-v2-border-border-muted/40 px-3 py-1.5 text-[12px] transition-colors"
                  classList={{
                    "cursor-pointer hover:bg-v2-overlay-simple-overlay-hover": clickable(),
                  }}
                  onClick={() => handleOpenProblem(problem)}
                  onKeyDown={(e) => {
                    if (!clickable()) return
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      handleOpenProblem(problem)
                    }
                  }}
                >
                  <div class="flex min-w-0 flex-1 items-start gap-2">
                    <span class="mt-0.5 shrink-0">
                      <Show when={problem.severity === "error"}>
                        <Icon name="circle-xmark" size="small" class="size-3.5 text-v2-state-fg-danger" />
                      </Show>
                      <Show when={problem.severity === "warning"}>
                        <Icon name="outline-hexagonal-warning" size="small" class="size-3.5 text-v2-state-fg-warning" />
                      </Show>
                      <Show when={problem.severity === "info"}>
                        <Icon name="info" size="small" class="size-3.5 text-v2-state-fg-info" />
                      </Show>
                    </span>

                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span class="break-words text-v2-text-text-base">{problem.message}</span>
                        <span class="shrink-0 rounded bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[10px] text-v2-text-text-muted">
                          {problem.source === "Diagnóstico" ? tr("Diagnostic", "Diagnóstico") : problem.source}
                        </span>
                      </div>
                      <Show when={locationText()}>
                        <div class="mt-0.5 truncate font-mono text-[11px] text-v2-text-text-faint">
                          {locationText()}
                        </div>
                      </Show>
                    </div>
                  </div>

                  <Show when={problem.actionLabel && problem.onAction}>
                    <button
                      type="button"
                      class="shrink-0 rounded-[5px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-2 py-0.5 text-[11px] font-medium text-v2-text-text-base hover:border-v2-border-border-base hover:bg-v2-overlay-simple-overlay-hover"
                      onClick={(e) => {
                        e.stopPropagation()
                        problem.onAction?.()
                      }}
                    >
                      {problem.actionLabel === "Ver no Output" || problem.actionLabel === "View in Output"
                        ? tr("View in Output", "Ver no Output")
                        : problem.actionLabel}
                    </button>
                  </Show>
                </div>
              )
            }}
          </For>
        </Show>
      </div>
    </div>
  )
}
