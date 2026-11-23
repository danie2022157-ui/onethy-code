import { batch, createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { FileSystemEntry } from "@opencode/client/promise"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { getDirectory, getFilename } from "@opencode/util/path"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { ServerConnection } from "@/runtime/server/registry"
import { SearchCodeIcon } from "../icons"
import { useWorkbench, type ShellRunResult } from "../state"

export type VimgrepMatch = {
  file: string
  line: number
  column: number
  text: string
}

type SearchMode = "content" | "files"
type SearchEngine = "rg" | "git-grep"
type ShellDialect = "posix" | "powershell" | "cmd"

type FileMatchGroup = {
  file: string
  matches: VimgrepMatch[]
}

type HighlightSegment = {
  text: string
  highlighted: boolean
}

type SearchError =
  | { kind: "raw"; message: string }
  | { kind: "invalid-regex"; detail: string }
  | { kind: "search-failed" }

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g
const VIMGREP_LINE_PATTERN = /^((?:[A-Za-z]:[/\\])?[^:\r\n]+):(\d+):(\d+):(.*)$/
const GREP_LINE_PATTERN = /^((?:[A-Za-z]:[/\\])?[^:\r\n]+):(\d+):(.*)$/
const MAX_MATCHES_DISPLAY = 600

/**
 * Parse ripgrep `--vimgrep` (`file:line:col:text`) and `git grep -n -I` (`file:line:text` or
 * `file:line:col:text`) output into structured search matches.
 */
export function parseVimgrepOutput(output: string): VimgrepMatch[] {
  if (!output) return []

  const matches: VimgrepMatch[] = []
  const lines = output.replaceAll("\r\n", "\n").split("\n")

  for (const rawLine of lines) {
    if (!rawLine) continue

    const cleanLine = rawLine.replace(ANSI_PATTERN, "")
    const vimgrep = VIMGREP_LINE_PATTERN.exec(cleanLine)

    if (vimgrep) {
      const file = normalizeSearchPath(vimgrep[1])
      const line = Number.parseInt(vimgrep[2], 10)
      const column = Number.parseInt(vimgrep[3], 10)

      if (!file || !Number.isFinite(line) || line < 1 || !Number.isFinite(column) || column < 1) continue

      matches.push({
        file,
        line,
        column,
        text: vimgrep[4],
      })
      continue
    }

    const basic = GREP_LINE_PATTERN.exec(cleanLine)
    if (!basic) continue

    const file = normalizeSearchPath(basic[1])
    const line = Number.parseInt(basic[2], 10)

    if (!file || !Number.isFinite(line) || line < 1) continue

    matches.push({
      file,
      line,
      column: 1,
      text: basic[3],
    })
  }

  return matches
}

export function SearchPanel() {
  const workbench = useWorkbench()
  const { tr } = useOnethyI18n()

  const [mode, setMode] = createSignal<SearchMode>("content")
  const [query, setQuery] = createSignal("")
  const [includeGlob, setIncludeGlob] = createSignal("")
  const [caseSensitive, setCaseSensitive] = createSignal(false)
  const [useRegex, setUseRegex] = createSignal(false)
  const [showGlobInput, setShowGlobInput] = createSignal(false)

  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<SearchError | undefined>(undefined)
  const [searchedQuery, setSearchedQuery] = createSignal("")
  const [engineUsed, setEngineUsed] = createSignal<SearchEngine | undefined>(undefined)

  const [contentMatches, setContentMatches] = createSignal<readonly VimgrepMatch[]>([])
  const [fileResults, setFileResults] = createSignal<readonly FileSystemEntry[]>([])
  const [collapsedFiles, setCollapsedFiles] = createSignal<Record<string, boolean>>({})
  const [activeKey, setActiveKey] = createSignal<string | undefined>(undefined)

  let searchInput: HTMLInputElement | undefined
  let searchGeneration = 0
  let cachedDialectKey: string | undefined
  let cachedDialect: ShellDialect | undefined

  const groupedMatches = createMemo<readonly FileMatchGroup[]>(() => {
    const groups: FileMatchGroup[] = []
    const byFile = new Map<string, FileMatchGroup>()

    for (const match of contentMatches()) {
      const existing = byFile.get(match.file)
      if (existing) {
        existing.matches.push(match)
        continue
      }

      const created: FileMatchGroup = { file: match.file, matches: [match] }
      byFile.set(match.file, created)
      groups.push(created)
    }

    return groups
  })

  const allCollapsed = createMemo(() => {
    const groups = groupedMatches()
    if (groups.length === 0) return false
    const map = collapsedFiles()
    return groups.every((group) => Boolean(map[group.file]))
  })

  const resolveDialect = async (directory: string): Promise<ShellDialect> => {
    const ctx = workbench.activeServerCtx()
    const conn = workbench.activeServer()
    if (!ctx || !conn) return isWindowsPath(directory) ? "powershell" : "posix"

    const cacheKey = `${ServerConnection.key(conn)}::${directory}`
    if (cachedDialectKey === cacheKey && cachedDialect) return cachedDialect

    const entries = await ctx.sdk.api.config.get({ location: { directory } }).catch(() => [])
    const configured = entries
      .flatMap((entry) => (entry.type === "document" && entry.info.shell ? [entry.info.shell] : []))
      .at(-1)

    if (configured) {
      cachedDialectKey = cacheKey
      cachedDialect = dialectFromShellPath(configured)
      return cachedDialect
    }

    const shells = await ctx.sdk.api.config.shells().catch(() => [])
    const first = shells[0]
    const resolved = first
      ? dialectFromShellPath(first.path || first.name)
      : isWindowsPath(directory)
        ? "powershell"
        : "posix"

    cachedDialectKey = cacheKey
    cachedDialect = resolved
    return resolved
  }

  const runContentSearch = async (rawQuery: string, generation: number) => {
    const dir = workbench.activeDirectory()
    if (!dir) return

    const dialect = await resolveDialect(dir)
    if (generation !== searchGeneration) return

    const globs = splitGlobs(includeGlob())
    const sensitive = caseSensitive()
    const regex = useRegex()

    const rgCmd = buildRgCommand({
      query: rawQuery,
      caseSensitive: sensitive,
      useRegex: regex,
      globs,
      dialect,
    })

    const rgResult = await workbench.runShellCommand(rgCmd, { cwd: dir, timeout: 20_000 })
    if (generation !== searchGeneration) return

    const rgOutcome = evaluateRgResult(rgResult)

    if (rgOutcome.kind === "ok") {
      const parsed = parseVimgrepOutput(rgResult.output).slice(0, MAX_MATCHES_DISPLAY)
      batch(() => {
        setLoading(false)
        setError(undefined)
        setSearchedQuery(rawQuery)
        setEngineUsed("rg")
        setContentMatches(parsed)
        setCollapsedFiles({})
      })
      return
    }

    if (rgOutcome.kind === "error") {
      batch(() => {
        setLoading(false)
        setError(rgOutcome.error)
        setSearchedQuery(rawQuery)
        setEngineUsed("rg")
        setContentMatches([])
      })
      return
    }

    // Fallback to `git grep -n -I` when ripgrep is unavailable or fails.
    const gitCmd = buildGitGrepCommand({
      query: rawQuery,
      caseSensitive: sensitive,
      useRegex: regex,
      globs,
      dialect,
      noIndex: false,
    })

    const gitResult = await workbench.runShellCommand(gitCmd, { cwd: dir, timeout: 20_000 })
    if (generation !== searchGeneration) return

    const effectiveGitResult =
      gitResult.exit === 128 && isNotGitRepoOutput(gitResult.output)
        ? await workbench.runShellCommand(
            buildGitGrepCommand({
              query: rawQuery,
              caseSensitive: sensitive,
              useRegex: regex,
              globs,
              dialect,
              noIndex: true,
            }),
            { cwd: dir, timeout: 20_000 },
          )
        : gitResult

    if (generation !== searchGeneration) return

    const gitOutcome = evaluateGitGrepResult(effectiveGitResult)

    batch(() => {
      setLoading(false)
      setSearchedQuery(rawQuery)
      setEngineUsed("git-grep")

      if (gitOutcome.kind === "error") {
        setError(gitOutcome.error)
        setContentMatches([])
        return
      }

      setError(undefined)
      setContentMatches(parseVimgrepOutput(effectiveGitResult.output).slice(0, MAX_MATCHES_DISPLAY))
      setCollapsedFiles({})
    })
  }

  const runFileSearch = async (rawQuery: string, generation: number) => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()
    if (!ctx || !location) return

    const result = await ctx.sdk.api.file
      .find({ location, query: rawQuery, limit: 200 })
      .then((res) => ({ ok: true as const, data: res.data }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    if (generation !== searchGeneration) return

    batch(() => {
      setLoading(false)
      setSearchedQuery(rawQuery)

      if (!result.ok) {
        setError({ kind: "raw", message: result.message })
        setFileResults([])
        return
      }

      setError(undefined)
      setFileResults(result.data)
    })
  }

  const executeSearch = async (rawQuery: string) => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()
    const trimmed = rawQuery.trim()

    if (!ctx || !location || !trimmed) {
      searchGeneration += 1
      batch(() => {
        setLoading(false)
        setError(undefined)
        setSearchedQuery("")
        setEngineUsed(undefined)
        setContentMatches([])
        setFileResults([])
      })
      return
    }

    const generation = ++searchGeneration
    setLoading(true)
    setError(undefined)

    if (mode() === "files") {
      await runFileSearch(trimmed, generation)
      return
    }

    await runContentSearch(rawQuery, generation)
  }

  // Reset panel state when active workspace changes.
  createEffect(() => {
    workbench.activeServerCtx()
    workbench.activeDirectory()
    searchGeneration += 1
    cachedDialectKey = undefined
    cachedDialect = undefined

    batch(() => {
      setLoading(false)
      setError(undefined)
      setSearchedQuery("")
      setEngineUsed(undefined)
      setContentMatches([])
      setFileResults([])
      setCollapsedFiles({})
      setActiveKey(undefined)
    })
  })

  // Debounced reactive search whenever query, mode, or search flags change.
  createEffect(() => {
    const currentMode = mode()
    const currentQuery = query()
    const currentGlob = includeGlob()
    const sensitive = caseSensitive()
    const regex = useRegex()
    const ctx = workbench.activeServerCtx()
    const dir = workbench.activeDirectory()

    // Track flags explicitly for content mode reactivity.
    void currentGlob
    void sensitive
    void regex

    if (!ctx || !dir || !currentQuery.trim()) {
      searchGeneration += 1
      batch(() => {
        setLoading(false)
        setError(undefined)
        setSearchedQuery("")
        setEngineUsed(undefined)
        setContentMatches([])
        setFileResults([])
      })
      return
    }

    const delay = currentMode === "files" ? 160 : 280
    const timer = setTimeout(() => {
      void executeSearch(currentQuery)
    }, delay)

    onCleanup(() => clearTimeout(timer))
  })

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault()
    void executeSearch(query())
  }

  const handleToggleFileGroup = (file: string) => {
    setCollapsedFiles((prev) => ({
      ...prev,
      [file]: !prev[file],
    }))
  }

  const handleToggleCollapseAll = () => {
    const groups = groupedMatches()
    if (groups.length === 0) return

    if (allCollapsed()) {
      setCollapsedFiles({})
      return
    }

    const next: Record<string, boolean> = {}
    for (const group of groups) {
      next[group.file] = true
    }
    setCollapsedFiles(next)
  }

  const handleOpenMatch = (match: VimgrepMatch) => {
    setActiveKey(`${match.file}:${match.line}:${match.column}`)
    void workbench.openFile(match.file, { line: match.line, edit: true })
  }

  const handleOpenFileEntry = (entry: FileSystemEntry) => {
    if (entry.type === "directory") return
    const normalized = normalizeSearchPath(entry.path)
    setActiveKey(normalized)
    void workbench.openFile(normalized, { edit: true })
  }

  const handleClearQuery = () => {
    setQuery("")
    searchInput?.focus()
  }

  const errorMessage = createMemo(() => {
    const current = error()
    if (!current) return undefined
    if (current.kind === "invalid-regex") {
      return tr("Invalid regular expression: {{detail}}", "Expressão regular inválida: {{detail}}", {
        detail: current.detail,
      })
    }
    if (current.kind === "search-failed") {
      return tr("Failed to run code search.", "Falha ao executar busca no código.")
    }
    return current.message
  })

  const summaryText = createMemo(() => {
    if (mode() === "files") {
      const count = fileResults().length
      if (count === 1) return tr("1 file found", "1 arquivo encontrado")
      return tr("{{count}} files found", "{{count}} arquivos encontrados", { count })
    }

    const totalMatches = contentMatches().length
    const totalFiles = groupedMatches().length
    const matchLabel = totalMatches === 1 ? tr("match", "correspondência") : tr("matches", "correspondências")
    const fileLabel = totalFiles === 1 ? tr("file", "arquivo") : tr("files", "arquivos")
    const capSuffix = totalMatches >= MAX_MATCHES_DISPLAY ? "+" : ""
    return tr(
      "{{matches}} {{matchLabel}} in {{files}} {{fileLabel}}",
      "{{matches}} {{matchLabel}} em {{files}} {{fileLabel}}",
      {
        matches: `${totalMatches}${capSuffix}`,
        matchLabel,
        files: totalFiles,
        fileLabel,
      },
    )
  })

  return (
    <Show
      when={workbench.activeServerCtx() && workbench.activeDirectory()}
      fallback={
        <div class="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
          <div class="flex size-10 items-center justify-center rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
            <SearchCodeIcon size={18} />
          </div>
          <div class="text-[12.5px] font-medium text-v2-text-text-base">
            {tr("No open project", "Nenhum projeto aberto")}
          </div>
          <p class="max-w-[210px] text-[11.5px] leading-4 text-v2-text-text-faint">
            {tr(
              "Open a directory or session to search code and files in the workspace.",
              "Abra um diretório ou sessão para pesquisar no código e nos arquivos do workspace.",
            )}
          </p>
        </div>
      }
    >
      <div class="flex min-h-0 flex-1 flex-col bg-v2-background-bg-base text-v2-text-text-base">
        {/* Mode segmented switcher */}
        <div class="shrink-0 border-b border-v2-border-border-muted px-2 py-1.5">
          <div
            role="tablist"
            aria-label={tr("Search mode", "Modo de busca")}
            class="grid grid-cols-2 gap-1 rounded-[6px] bg-v2-background-bg-layer-01 p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode() === "content"}
              class="flex h-6 items-center justify-center gap-1.5 rounded-[4px] px-2 text-[11.5px] font-medium transition-colors"
              classList={{
                "bg-v2-background-bg-base text-v2-text-text-base shadow-xs": mode() === "content",
                "text-v2-text-text-muted hover:text-v2-text-text-base": mode() !== "content",
              }}
              onClick={() => setMode("content")}
            >
              <span>{tr("Content", "Conteúdo")}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode() === "files"}
              class="flex h-6 items-center justify-center gap-1.5 rounded-[4px] px-2 text-[11.5px] font-medium transition-colors"
              classList={{
                "bg-v2-background-bg-base text-v2-text-text-base shadow-xs": mode() === "files",
                "text-v2-text-text-muted hover:text-v2-text-text-base": mode() !== "files",
              }}
              onClick={() => setMode("files")}
            >
              <span>{tr("Files", "Arquivos")}</span>
            </button>
          </div>
        </div>

        {/* Search form & toggles */}
        <form
          class="flex shrink-0 flex-col gap-1.5 border-b border-v2-border-border-muted px-2 py-2"
          onSubmit={handleSubmit}
        >
          <div class="flex h-7 items-center gap-1 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-deep px-1.5 focus-within:border-v2-border-border-focus">
            <SearchCodeIcon size={13} class="ms-0.5 shrink-0 text-v2-icon-icon-muted" />
            <input
              ref={searchInput}
              type="text"
              value={query()}
              placeholder={
                mode() === "content"
                  ? tr("Search in code...", "Buscar no código...")
                  : tr("Search files by name...", "Buscar arquivos por nome...")
              }
              aria-label={
                mode() === "content"
                  ? tr("Search content in workspace", "Buscar conteúdo no workspace")
                  : tr("Search files in workspace", "Buscar arquivos no workspace")
              }
              class="min-w-0 flex-1 bg-transparent px-1 text-[12px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query()) {
                  e.stopPropagation()
                  handleClearQuery()
                }
              }}
            />

            <Show when={loading()}>
              <Loader width={12} height={12} class="shrink-0 text-v2-icon-icon-muted" />
            </Show>

            <Show when={query().length > 0 && !loading()}>
              <button
                type="button"
                class="flex size-4 shrink-0 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                aria-label={tr("Clear search", "Limpar busca")}
                onClick={handleClearQuery}
              >
                <Icon name="outline-xmark" size="small" class="size-3" />
              </button>
            </Show>

            <Show when={mode() === "content"}>
              <div class="flex shrink-0 items-center gap-0.5 border-s border-v2-border-border-muted ps-1">
                <Tooltip placement="bottom" value={tr("Match case", "Diferenciar maiúsculas e minúsculas")}>
                  <button
                    type="button"
                    aria-label={tr("Match case", "Diferenciar maiúsculas e minúsculas")}
                    aria-pressed={caseSensitive()}
                    class="flex h-5 min-w-5 items-center justify-center rounded-[4px] px-1 font-mono text-[10.5px] font-semibold transition-colors"
                    classList={{
                      "bg-v2-background-bg-accent text-v2-text-text-inverse": caseSensitive(),
                      "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                        !caseSensitive(),
                    }}
                    onClick={() => setCaseSensitive((prev) => !prev)}
                  >
                    Aa
                  </button>
                </Tooltip>

                <Tooltip placement="bottom" value={tr("Use regular expression", "Usar expressão regular")}>
                  <button
                    type="button"
                    aria-label={tr("Use regular expression", "Usar expressão regular")}
                    aria-pressed={useRegex()}
                    class="flex h-5 min-w-5 items-center justify-center rounded-[4px] px-1 font-mono text-[10.5px] font-semibold transition-colors"
                    classList={{
                      "bg-v2-background-bg-accent text-v2-text-text-inverse": useRegex(),
                      "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                        !useRegex(),
                    }}
                    onClick={() => setUseRegex((prev) => !prev)}
                  >
                    .*
                  </button>
                </Tooltip>

                <Tooltip placement="bottom" value={tr("Filter files to include (glob)", "Filtrar arquivos a incluir (glob)")}>
                  <button
                    type="button"
                    aria-label={tr("Toggle file filter", "Alternar filtro de arquivos")}
                    aria-pressed={showGlobInput() || includeGlob().trim().length > 0}
                    class="flex size-5 items-center justify-center rounded-[4px] transition-colors"
                    classList={{
                      "bg-v2-overlay-simple-overlay-pressed text-v2-text-text-accent":
                        showGlobInput() || includeGlob().trim().length > 0,
                      "text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                        !showGlobInput() && includeGlob().trim().length === 0,
                    }}
                    onClick={() => setShowGlobInput((prev) => !prev)}
                  >
                    <FilterGlobIcon />
                  </button>
                </Tooltip>
              </div>
            </Show>
          </div>

          {/* Optional include glob filter */}
          <Show when={mode() === "content" && (showGlobInput() || includeGlob().trim().length > 0)}>
            <div class="flex h-6.5 items-center gap-1 rounded-[5px] border border-v2-border-border-muted bg-v2-background-bg-deep px-2 focus-within:border-v2-border-border-focus">
              <span class="shrink-0 text-[10.5px] text-v2-text-text-faint">{tr("Include:", "Incluir:")}</span>
              <input
                type="text"
                value={includeGlob()}
                placeholder="*.ts, src/**"
                aria-label={tr("Glob pattern of files to include", "Padrão glob de arquivos a incluir")}
                class="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                onInput={(e) => setIncludeGlob(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && includeGlob()) {
                    e.stopPropagation()
                    setIncludeGlob("")
                  }
                }}
              />
              <Show when={includeGlob().length > 0}>
                <button
                  type="button"
                  class="flex size-4 shrink-0 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                  aria-label={tr("Clear glob filter", "Limpar filtro glob")}
                  onClick={() => setIncludeGlob("")}
                >
                  <Icon name="outline-xmark" size="small" class="size-3" />
                </button>
              </Show>
            </div>
          </Show>
        </form>

        {/* Summary bar */}
        <Show when={searchedQuery().length > 0 && !errorMessage()}>
          <div class="flex shrink-0 items-center justify-between gap-1.5 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01/50 px-2.5 py-1">
            <span class="min-w-0 truncate text-[11px] text-v2-text-text-muted">{summaryText()}</span>

            <div class="flex shrink-0 items-center gap-0.5">
              <Show when={mode() === "content" && engineUsed()}>
                {(engine) => (
                  <span class="rounded bg-v2-background-bg-layer-02 px-1 py-0.5 font-mono text-[9.5px] text-v2-text-text-faint">
                    {engine() === "rg" ? "rg" : "git grep"}
                  </span>
                )}
              </Show>

              <Show when={mode() === "content" && groupedMatches().length > 0}>
                <Tooltip
                  placement="bottom"
                  value={allCollapsed() ? tr("Expand All", "Expandir Todos") : tr("Collapse All", "Recolher Todos")}
                >
                  <button
                    type="button"
                    class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                    aria-label={
                      allCollapsed()
                        ? tr("Expand all groups", "Expandir todos os grupos")
                        : tr("Collapse all groups", "Recolher todos os grupos")
                    }
                    onClick={handleToggleCollapseAll}
                  >
                    <Show when={allCollapsed()} fallback={<CollapseAllIcon />}>
                      <ExpandAllIcon />
                    </Show>
                  </button>
                </Tooltip>
              </Show>

              <Tooltip placement="bottom" value={tr("Refresh search", "Refazer busca")}>
                <button
                  type="button"
                  disabled={loading()}
                  class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
                  aria-label={tr("Refresh search", "Refazer busca")}
                  onClick={() => void executeSearch(query())}
                >
                  <Icon name="refresh" size="small" class="size-3" />
                </button>
              </Tooltip>
            </div>
          </div>
        </Show>

        {/* Results area */}
        <div data-slot="workbench-scroll" class="min-h-0 flex-1 overflow-y-auto py-1">
          <Show when={errorMessage()}>
            {(message) => (
              <div class="mx-2 my-1.5 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger px-2.5 py-2 text-[11.5px] leading-4 text-v2-state-fg-danger">
                {message()}
              </div>
            )}
          </Show>

          <Show when={!query().trim() && !loading()}>
            <div class="px-4 py-8 text-center text-[11.5px] leading-4 text-v2-text-text-faint">
              <Show
                when={mode() === "content"}
                fallback={tr(
                  "Type part of a name or path to find files in the project.",
                  "Digite parte do nome ou caminho para localizar arquivos no projeto.",
                )}
              >
                {tr(
                  "Type a term or regular expression and press Enter to search workspace code.",
                  "Digite um termo ou expressão regular e pressione Enter para buscar no código do workspace.",
                )}
              </Show>
            </div>
          </Show>

          <Show when={loading() && contentMatches().length === 0 && fileResults().length === 0}>
            <div class="flex items-center justify-center gap-2 py-8 text-[12px] text-v2-text-text-faint">
              <Loader width={14} height={14} />
              <span>
                {mode() === "content"
                  ? tr("Searching code...", "Buscando no código...")
                  : tr("Searching files...", "Buscando arquivos...")}
              </span>
            </div>
          </Show>

          {/* Content mode results */}
          <Show when={mode() === "content"}>
            <Show when={!loading() && !errorMessage() && searchedQuery().length > 0 && groupedMatches().length === 0}>
              <div class="px-4 py-8 text-center text-[12px] text-v2-text-text-faint">
                {tr('No matches found for "{{query}}".', 'Nenhuma correspondência encontrada para "{{query}}".', {
                  query: searchedQuery(),
                })}
              </div>
            </Show>

            <For each={groupedMatches()}>
              {(group) => {
                const name = getFilename(group.file) || group.file
                const parent = parentDirectory(group.file)
                const isCollapsed = () => Boolean(collapsedFiles()[group.file])

                return (
                  <div class="mb-0.5">
                    <button
                      type="button"
                      aria-expanded={!isCollapsed()}
                      class="flex h-[26px] w-full items-center gap-1.5 px-2 text-left text-[12px] select-none transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-1 focus-visible:outline-v2-border-border-focus"
                      onClick={() => handleToggleFileGroup(group.file)}
                    >
                      <Icon
                        name="outline-chevron-right"
                        size="small"
                        class="size-3.5 shrink-0 text-v2-icon-icon-muted transition-transform duration-150"
                        classList={{ "rotate-90": !isCollapsed() }}
                      />
                      <FileIcon node={{ path: group.file, type: "file" }} class="size-4 shrink-0" />
                      <div class="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
                        <span class="shrink-0 truncate font-medium text-v2-text-text-base" title={group.file}>
                          {name}
                        </span>
                        <Show when={parent}>
                          <span class="min-w-0 truncate text-[10.5px] text-v2-text-text-faint" title={group.file}>
                            {parent}
                          </span>
                        </Show>
                      </div>
                      <span class="shrink-0 rounded-full bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[10px] leading-none text-v2-text-text-muted">
                        {group.matches.length}
                      </span>
                    </button>

                    <Show when={!isCollapsed()}>
                      <div class="flex flex-col">
                        <For each={group.matches}>
                          {(match) => {
                            const rowKey = `${match.file}:${match.line}:${match.column}`
                            const segments = createMemo(() =>
                              buildHighlightedSegments(match.text, searchedQuery(), {
                                caseSensitive: caseSensitive(),
                                useRegex: useRegex(),
                                column: match.column,
                              }),
                            )

                            return (
                              <button
                                type="button"
                                class="flex min-h-[24px] w-full items-baseline gap-2 py-0.5 pe-2 ps-6 text-left transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-1 focus-visible:outline-v2-border-border-focus"
                                classList={{ "bg-v2-overlay-simple-overlay-pressed": activeKey() === rowKey }}
                                title={`${match.file}:${match.line}:${match.column}`}
                                onClick={() => handleOpenMatch(match)}
                              >
                                <span class="w-8 shrink-0 text-right font-mono text-[10.5px] text-v2-text-text-faint tabular-nums">
                                  {match.line}
                                </span>
                                <span class="min-w-0 flex-1 truncate font-mono text-[11.5px] leading-5 text-v2-text-text-muted">
                                  <For each={segments()}>
                                    {(segment) => (
                                      <Show when={segment.highlighted} fallback={segment.text}>
                                        <span class="rounded-[2px] bg-v2-background-bg-accent/25 px-[1px] font-medium text-v2-text-text-base">
                                          {segment.text}
                                        </span>
                                      </Show>
                                    )}
                                  </For>
                                </span>
                              </button>
                            )
                          }}
                        </For>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </Show>

          {/* Files mode results */}
          <Show when={mode() === "files"}>
            <Show when={!loading() && !errorMessage() && searchedQuery().length > 0 && fileResults().length === 0}>
              <div class="px-4 py-8 text-center text-[12px] text-v2-text-text-faint">
                {tr('No files found for "{{query}}".', 'Nenhum arquivo encontrado para "{{query}}".', {
                  query: searchedQuery(),
                })}
              </div>
            </Show>

            <For each={fileResults()}>
              {(entry) => {
                const normalized = normalizeSearchPath(entry.path)
                const name = getFilename(normalized) || normalized
                const parent = parentDirectory(normalized)
                const isDir = entry.type === "directory"

                return (
                  <button
                    type="button"
                    disabled={isDir}
                    class="flex h-[28px] w-full items-center gap-1.5 px-2.5 text-left text-[12.5px] select-none transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-1 focus-visible:outline-v2-border-border-focus disabled:cursor-default disabled:opacity-70"
                    classList={{ "bg-v2-overlay-simple-overlay-pressed": activeKey() === normalized }}
                    title={normalized}
                    onClick={() => handleOpenFileEntry(entry)}
                  >
                    <FileIcon node={{ path: normalized, type: entry.type }} class="size-4 shrink-0" />
                    <div class="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
                      <span class="shrink-0 truncate text-v2-text-text-base">{name}</span>
                      <Show when={parent}>
                        <span class="min-w-0 truncate text-[11px] text-v2-text-text-faint">{parent}</span>
                      </Show>
                    </div>
                  </button>
                )
              }}
            </For>
          </Show>
        </div>
      </div>
    </Show>
  )
}

function normalizeSearchPath(raw: string) {
  const unified = raw.replaceAll("\\", "/")
  if (/^[A-Za-z]:\//.test(unified)) return unified
  return unified.replace(/^\.\//, "").replace(/^\/+/, "")
}

function parentDirectory(relPath: string) {
  return getDirectory(normalizeSearchPath(relPath)).replace(/\/+$/, "")
}

function isWindowsPath(directory: string) {
  return /^[A-Za-z]:[/\\]/.test(directory) || directory.includes("\\")
}

function dialectFromShellPath(shellPath: string): ShellDialect {
  const base = shellPath
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.toLowerCase()
    .replace(/\.exe$/, "")

  if (base === "pwsh" || base === "powershell") return "powershell"
  if (base === "cmd") return "cmd"
  return "posix"
}

function quoteShellArg(value: string, dialect: ShellDialect) {
  const clean = value.replaceAll("\0", "")

  if (dialect === "powershell") {
    return `'${clean.replaceAll("'", "''")}'`
  }

  if (dialect === "cmd") {
    const singleLine = clean.replaceAll("\r", " ").replaceAll("\n", " ")
    return `"${singleLine.replaceAll('"', '\\"').replaceAll("%", "%%")}"`
  }

  return `'${clean.replaceAll("'", "'\\''")}'`
}

function splitGlobs(raw: string) {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function buildRgCommand(opts: {
  query: string
  caseSensitive: boolean
  useRegex: boolean
  globs: readonly string[]
  dialect: ShellDialect
}) {
  const args = [
    "rg",
    "--vimgrep",
    "--no-heading",
    "--color=never",
    "--max-count",
    "20",
    "--max-filesize",
    "1M",
    opts.caseSensitive ? "-s" : "-i",
  ]

  if (!opts.useRegex) args.push("-F")

  for (const glob of opts.globs) {
    args.push("-g", quoteShellArg(glob, opts.dialect))
  }

  args.push("-e", quoteShellArg(opts.query, opts.dialect), ".")
  return args.join(" ")
}

function toGitPathspec(glob: string) {
  const excluded = glob.startsWith("!")
  const raw = excluded ? glob.slice(1).trim() : glob
  const normalized = raw.replaceAll("\\", "/")
  const pattern = normalized.includes("/") ? normalized : `**/${normalized}`
  return excluded ? `:(exclude,glob)${pattern}` : `:(glob)${pattern}`
}

function buildGitGrepCommand(opts: {
  query: string
  caseSensitive: boolean
  useRegex: boolean
  globs: readonly string[]
  dialect: ShellDialect
  noIndex: boolean
}) {
  const args = ["git", "grep", "-n", "-I", "--column", "--no-color", "-m", "20"]

  if (opts.noIndex) args.push("--no-index")
  if (!opts.noIndex) args.push("--untracked")
  if (!opts.caseSensitive) args.push("-i")
  args.push(opts.useRegex ? "-E" : "-F")
  args.push("-e", quoteShellArg(opts.query, opts.dialect))

  if (opts.globs.length > 0) {
    args.push(opts.dialect === "cmd" ? "--" : "'--'")
    for (const glob of opts.globs) {
      args.push(quoteShellArg(toGitPathspec(glob), opts.dialect))
    }
  }

  return args.join(" ")
}

function evaluateRgResult(result: ShellRunResult): { kind: "ok" } | { kind: "fallback" } | { kind: "error"; error: SearchError } {
  if (result.error) return { kind: "fallback" }
  if (result.exit === 0) return { kind: "ok" }

  const trimmed = result.output.trim()
  if (result.exit === 1 && trimmed === "") return { kind: "ok" }

  if (/regex parse error/i.test(trimmed)) {
    return { kind: "error", error: { kind: "invalid-regex", detail: firstNonEmptyLine(trimmed) } }
  }

  return { kind: "fallback" }
}

function isNotGitRepoOutput(output: string) {
  return /not a git repository/i.test(output)
}

function evaluateGitGrepResult(result: ShellRunResult): { kind: "ok" } | { kind: "error"; error: SearchError } {
  if (result.error) return { kind: "error", error: { kind: "raw", message: result.error } }
  if (result.exit === 0) return { kind: "ok" }

  const trimmed = result.output.trim()
  if (result.exit === 1 && trimmed === "") return { kind: "ok" }

  const line = firstNonEmptyLine(trimmed)
  if (line) return { kind: "error", error: { kind: "raw", message: line } }

  return { kind: "error", error: { kind: "search-failed" } }
}

function firstNonEmptyLine(text: string) {
  return (
    text
      .replaceAll("\r\n", "\n")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  )
}

function compileUserRegex(pattern: string, caseSensitive: boolean): RegExp | undefined {
  try {
    return new RegExp(pattern, caseSensitive ? "g" : "gi")
  } catch {
    return undefined
  }
}

function buildHighlightedSegments(
  rawText: string,
  query: string,
  opts: { caseSensitive: boolean; useRegex: boolean; column: number },
): HighlightSegment[] {
  const leadingSpaces = rawText.length - rawText.trimStart().length
  let snippet = rawText.trimStart()
  const approxStart = Math.max(0, opts.column - 1 - leadingSpaces)

  // Keep matches far into long lines visible inside the narrow sidebar.
  if (approxStart > 44) {
    const crop = approxStart - 20
    snippet = `...${snippet.slice(crop)}`
  }

  if (snippet.length > 180) {
    snippet = `${snippet.slice(0, 180)}...`
  }

  if (!query) return [{ text: snippet, highlighted: false }]

  const ranges = findHighlightRanges(snippet, query, opts.caseSensitive, opts.useRegex)
  if (ranges.length === 0) return [{ text: snippet, highlighted: false }]

  const segments: HighlightSegment[] = []
  let cursor = 0

  for (const [start, end] of ranges) {
    if (start > cursor) {
      segments.push({ text: snippet.slice(cursor, start), highlighted: false })
    }
    segments.push({ text: snippet.slice(start, end), highlighted: true })
    cursor = end
  }

  if (cursor < snippet.length) {
    segments.push({ text: snippet.slice(cursor), highlighted: false })
  }

  return segments
}

function findHighlightRanges(text: string, query: string, caseSensitive: boolean, useRegex: boolean) {
  const ranges: Array<[number, number]> = []

  if (useRegex) {
    const regex = compileUserRegex(query, caseSensitive)
    if (!regex) return ranges

    let match = regex.exec(text)
    while (match && ranges.length < 24) {
      const length = match[0].length
      if (length === 0) {
        regex.lastIndex += 1
        match = regex.exec(text)
        continue
      }
      ranges.push([match.index, match.index + length])
      match = regex.exec(text)
    }
    return ranges
  }

  const haystack = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  if (!needle) return ranges

  let offset = 0
  while (offset < haystack.length && ranges.length < 24) {
    const found = haystack.indexOf(needle, offset)
    if (found === -1) break
    ranges.push([found, found + needle.length])
    offset = found + needle.length
  }

  return ranges
}

function FilterGlobIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M2.25 3.25h11.5L9.5 8.2v3.9l-3 1.4V8.2L2.25 3.25Z"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function CollapseAllIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M4.5 5.25 8 8.25l3.5-3M4.5 11.75 8 8.75l3.5 3"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path d="M3 2.5h10M3 13.5h10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.6" />
    </svg>
  )
}

function ExpandAllIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M4.5 6.75 8 3.75l3.5 3M4.5 9.25 8 12.25l3.5-3"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
