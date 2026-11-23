import { batch, createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { FileSystemEntry, VcsFileStatus } from "@opencode/client/promise"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { getDirectory, getFilename } from "@opencode/util/path"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"
import { ExplorerIcon, SearchCodeIcon } from "../icons"
import { useWorkbench } from "../state"

type VcsBadge = "M" | "A" | "D" | "U"
type Translate = ReturnType<typeof useOnethyI18n>["tr"]
type CreateError = { kind: "invalid-path" } | { kind: "raw"; message: string }

type TreeState = {
  entries: Record<string, FileSystemEntry[]>
  expanded: Record<string, boolean>
  loading: Record<string, boolean>
  errors: Record<string, string | undefined>
}

const BADGE_PRIORITY: Record<VcsBadge, number> = {
  M: 4,
  D: 3,
  A: 2,
  U: 1,
}

export function ExplorerPanel() {
  const workbench = useWorkbench()
  const platform = usePlatform()
  const { tr } = useOnethyI18n()

  const canReveal = createMemo(() => platform.platform === "desktop" && Boolean(platform.revealPath))

  const [tree, setTree] = createStore<TreeState>({
    entries: {},
    expanded: {},
    loading: {},
    errors: {},
  })

  const [vcsRows, setVcsRows] = createSignal<readonly VcsFileStatus[]>([])
  const [refreshing, setRefreshing] = createSignal(false)
  const [filterQuery, setFilterQuery] = createSignal("")
  const [filterResults, setFilterResults] = createSignal<readonly FileSystemEntry[]>([])
  const [filterLoading, setFilterLoading] = createSignal(false)
  const [filterError, setFilterError] = createSignal<string | undefined>(undefined)
  const [selectedDir, setSelectedDir] = createSignal("")
  const [activeFile, setActiveFile] = createSignal<string | undefined>(undefined)
  const [creatingFile, setCreatingFile] = createSignal(false)
  const [newFilePath, setNewFilePath] = createSignal("")
  const [createError, setCreateError] = createSignal<CreateError | undefined>(undefined)
  const [creatingBusy, setCreatingBusy] = createSignal(false)

  const createErrorMessage = createMemo(() => {
    const err = createError()

    if (!err) return undefined

    if (err.kind === "invalid-path") {
      return tr(
        "Enter a valid relative path (e.g. src/new.ts).",
        "Informe um caminho relativo válido (ex.: src/novo.ts).",
      )
    }

    return err.message
  })

  let newFileInput: HTMLInputElement | undefined
  let workspaceGeneration = 0
  let vcsGeneration = 0
  let findGeneration = 0

  const rootName = createMemo(() => {
    const dir = workbench.activeDirectory()

    if (!dir) return ""

    return getFilename(dir) || dir
  })

  const vcsByFile = createMemo(() => {
    const statusByFile = new Map<string, VcsBadge>()

    for (const row of vcsRows()) {
      const normalized = normalizeRelativePath(row.file)

      if (!normalized) continue
      statusByFile.set(normalized, badgeForStatus(row.status))
    }

    return statusByFile
  })

  const vcsByFolder = createMemo(() => {
    const statusByFolder = new Map<string, VcsBadge>()

    for (const [file, badge] of vcsByFile().entries()) {
      for (const ancestor of ancestorDirectories(file)) {
        const current = statusByFolder.get(ancestor)

        if (!current || BADGE_PRIORITY[badge] > BADGE_PRIORITY[current]) {
          statusByFolder.set(ancestor, badge)
        }
      }
    }

    return statusByFolder
  })

  const isFiltering = createMemo(() => filterQuery().trim().length > 0)

  const loadDirectory = async (dirPath: string, opts?: { force?: boolean }) => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()

    if (!ctx || !location) return

    const dir = normalizeRelativePath(dirPath)

    if (!opts?.force && tree.entries[dir] !== undefined) return

    const generation = workspaceGeneration
    setTree("loading", dir, true)
    setTree("errors", dir, undefined)

    const result = await ctx.sdk.api.file
      .list({ location, path: dir })
      .then((res) => ({ ok: true as const, data: res.data }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    if (generation !== workspaceGeneration) return

    batch(() => {
      setTree("loading", dir, false)

      if (!result.ok) {
        setTree("errors", dir, result.message)

        return
      }

      setTree("entries", dir, sortEntries(result.data ?? []))
      setTree("errors", dir, undefined)
    })
  }

  const loadVcsStatus = async () => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()

    if (!ctx || !location) {
      setVcsRows([])

      return
    }

    const generation = ++vcsGeneration

    const res = await ctx.sdk.api.vcs.status({ location }).catch(() => undefined)

    if (generation !== vcsGeneration) return

    setVcsRows(res?.data ?? [])
  }

  const runFileFilter = async (query: string) => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()
    const trimmed = query.trim()

    if (!ctx || !location || !trimmed) {
      setFilterResults([])
      setFilterLoading(false)
      setFilterError(undefined)

      return
    }

    const generation = ++findGeneration
    setFilterLoading(true)
    setFilterError(undefined)

    const result = await ctx.sdk.api.file
      .find({ location, query: trimmed, limit: 150 })
      .then((res) => ({ ok: true as const, data: res.data }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    if (generation !== findGeneration) return

    batch(() => {
      setFilterLoading(false)

      if (!result.ok) {
        setFilterResults([])
        setFilterError(result.message)

        return
      }

      setFilterResults(result.data)
      setFilterError(undefined)
    })
  }

  // Reset tree and load root whenever active server or workspace directory changes.
  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    const dir = workbench.activeDirectory()
    workspaceGeneration += 1
    findGeneration += 1

    batch(() => {
      setTree("entries", reconcile({}))
      setTree("expanded", reconcile({}))
      setTree("loading", reconcile({}))
      setTree("errors", reconcile({}))
      setSelectedDir("")
      setActiveFile(undefined)
      setFilterQuery("")
      setFilterResults([])
      setFilterLoading(false)
      setFilterError(undefined)
      setCreatingFile(false)
      setNewFilePath("")
      setCreateError(undefined)
    })

    if (!ctx || !dir) return

    void loadDirectory("", { force: true })
  })

  // Keep VCS badges synced with active workspace and gitRevision updates.
  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()
    workbench.gitRevision()

    if (!ctx || !location) {
      setVcsRows([])

      return
    }

    void loadVcsStatus()
  })

  // Debounced workspace file filter via file.find.
  createEffect(() => {
    const query = filterQuery()
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()

    if (!ctx || !location || !query.trim()) {
      findGeneration += 1
      setFilterResults([])
      setFilterLoading(false)
      setFilterError(undefined)

      return
    }

    const timer = setTimeout(() => {
      void runFileFilter(query)
    }, 160)

    onCleanup(() => clearTimeout(timer))
  })

  const handleRefresh = async () => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()

    if (!ctx || !location) return

    setRefreshing(true)

    const expandedDirs = Object.keys(tree.expanded).filter((dir) => Boolean(tree.expanded[dir]))
    const tasks: Promise<void>[] = [
      loadVcsStatus(),
      loadDirectory("", { force: true }),
      ...expandedDirs.map((dir) => loadDirectory(dir, { force: true })),
    ]

    if (isFiltering()) {
      tasks.push(runFileFilter(filterQuery()))
    }

    await Promise.all(tasks)
    setRefreshing(false)
  }

  const handleCollapseAll = () => {
    batch(() => {
      setTree("expanded", reconcile({}))
      setSelectedDir("")
    })
  }

  const handleToggleNewFile = () => {
    if (creatingFile()) {
      setCreatingFile(false)
      setCreateError(undefined)

      return
    }

    const base = selectedDir()

    batch(() => {
      setCreatingFile(true)
      setCreateError(undefined)
      setNewFilePath(base ? `${base}/` : "")
    })

    queueMicrotask(() => {
      newFileInput?.focus()
      const end = newFileInput?.value.length ?? 0
      newFileInput?.setSelectionRange(end, end)
    })
  }

  const handleCreateFile = async (event: SubmitEvent) => {
    event.preventDefault()

    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()

    if (!ctx || !location || creatingBusy()) return

    const target = sanitizeNewFilePath(newFilePath())

    if (!target) {
      setCreateError({ kind: "invalid-path" })

      return
    }

    setCreatingBusy(true)
    setCreateError(undefined)

    const result = await ctx.sdk.api.experimental.file
      .write({
        location,
        path: target,
        payload: new Uint8Array(),
      })
      .then(() => ({ ok: true as const }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    setCreatingBusy(false)

    if (!result.ok) {
      setCreateError({ kind: "raw", message: result.message })

      return
    }

    const ancestors = ancestorDirectories(target)
    const parent = parentDirectory(target)

    batch(() => {
      setCreatingFile(false)
      setNewFilePath("")
      setCreateError(undefined)
      setActiveFile(target)

      for (const ancestor of ancestors) {
        setTree("expanded", ancestor, true)
      }
    })

    await Promise.all([
      loadDirectory("", { force: true }),
      ...ancestors.map((dir) => loadDirectory(dir, { force: true })),
      parent ? loadDirectory(parent, { force: true }) : Promise.resolve(),
      loadVcsStatus(),
    ])

    workbench.bumpGitRevision()
    void workbench.openFile(target, { edit: true })
  }

  const handleToggleDirectory = (entry: FileSystemEntry) => {
    const dir = normalizeRelativePath(entry.path)
    const nextExpanded = !tree.expanded[dir]

    batch(() => {
      setSelectedDir(dir)
      setTree("expanded", dir, nextExpanded)
    })

    if (nextExpanded) {
      void loadDirectory(dir)
    }
  }

  const handleOpenFile = (path: string, edit: boolean) => {
    const normalized = normalizeRelativePath(path)
    setActiveFile(normalized)
    setSelectedDir(parentDirectory(normalized))
    void workbench.openFile(normalized, { edit })
  }

  const handleAddContext = (event: MouseEvent, path: string) => {
    event.stopPropagation()
    workbench.insertComposerText(`@${normalizeRelativePath(path)} `)
  }

  const handleRevealPath = async (event: MouseEvent, path: string) => {
    event.stopPropagation()

    const dir = workbench.activeDirectory()

    if (!dir || !platform.revealPath) return

    const absolute = joinWorkspacePath(dir, path)

    const outcome = await platform
      .revealPath(absolute)
      .then((revealed) => ({ ok: true as const, revealed }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    if (!outcome.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to reveal file", "Falha ao revelar arquivo"),
        description: outcome.message,
      })

      return
    }

    if (!outcome.revealed) {
      showToast({
        variant: "error",
        title: tr("Path not found", "Caminho não encontrado"),
        description: path,
      })
    }
  }

  const renderFileActions = (entry: FileSystemEntry) => (
    <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
      <Tooltip placement="top" value={tr("Add to Context (@)", "Adicionar ao Contexto (@)")}>
        <button
          type="button"
          class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
          aria-label={tr("Add {{path}} to context", "Adicionar {{path}} ao contexto", { path: entry.path })}
          onClick={(e) => handleAddContext(e, entry.path)}
        >
          <MentionAtIcon />
        </button>
      </Tooltip>

      <Show when={canReveal()}>
        <Tooltip placement="top" value={tr("Reveal in Explorer", "Revelar no Explorador")}>
          <button
            type="button"
            class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
            aria-label={tr("Reveal {{path}} in explorer", "Revelar {{path}} no explorador", { path: entry.path })}
            onClick={(e) => void handleRevealPath(e, entry.path)}
          >
            <Icon name="outline-arrow-to-corner-top-right" size="small" class="size-3.5" />
          </button>
        </Tooltip>
      </Show>
    </div>
  )

  const TreeLevel = (props: { dir: string; depth: number }) => {
    const entries = () => tree.entries[props.dir] ?? []
    const isLoading = () => Boolean(tree.loading[props.dir])
    const error = () => tree.errors[props.dir]

    return (
      <>
        <Show when={isLoading() && entries().length === 0}>
          <div
            class="flex items-center gap-2 py-1.5 text-[11.5px] text-v2-text-text-faint"
            style={{ "padding-inline-start": `${10 + props.depth * 14}px` }}
          >
            <Loader width={12} height={12} class="shrink-0 text-v2-icon-icon-muted" />
            <span>{tr("Loading...", "Carregando...")}</span>
          </div>
        </Show>

        <Show when={error()}>
          {(message) => (
            <div
              class="px-2 py-1 text-[11px] text-v2-state-fg-danger"
              style={{ "padding-inline-start": `${10 + props.depth * 14}px` }}
            >
              {message()}
            </div>
          )}
        </Show>

        <For each={entries()}>
          {(entry) => {
            const normalized = normalizeRelativePath(entry.path)
            const name = getFilename(normalized) || normalized
            const isDir = entry.type === "directory"
            const isExpanded = () => isDir && Boolean(tree.expanded[normalized])
            const isDirLoading = () => isDir && Boolean(tree.loading[normalized])
            const isSelected = () =>
              isDir ? selectedDir() === normalized : activeFile() === normalized
            const badge = () => (isDir ? vcsByFolder().get(normalized) : vcsByFile().get(normalized))

            return (
              <div>
                <div
                  role="treeitem"
                  aria-expanded={isDir ? isExpanded() : undefined}
                  aria-selected={isSelected()}
                  tabIndex={0}
                  class="group/row relative flex h-[26px] cursor-pointer items-center gap-1.5 pe-2 text-[12.5px] select-none transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-1 focus-visible:outline-v2-border-border-focus"
                  classList={{
                    "bg-v2-overlay-simple-overlay-pressed text-v2-text-text-base": isSelected(),
                    "text-v2-text-text-base": !isSelected(),
                  }}
                  style={{ "padding-inline-start": `${8 + props.depth * 14}px` }}
                  onClick={() => {
                    if (isDir) {
                      handleToggleDirectory(entry)

                      return
                    }

                    handleOpenFile(entry.path, false)
                  }}
                  onDblClick={() => {
                    if (isDir) return
                    handleOpenFile(entry.path, true)
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return
                    e.preventDefault()

                    if (isDir) {
                      handleToggleDirectory(entry)

                      return
                    }

                    handleOpenFile(entry.path, e.key === "Enter")
                  }}
                >
                  <Show when={props.depth > 0}>
                    <span
                      aria-hidden="true"
                      class="pointer-events-none absolute inset-y-0 w-px bg-v2-border-border-muted/60"
                      style={{ "inset-inline-start": `${14 + (props.depth - 1) * 14}px` }}
                    />
                  </Show>

                  <Show
                    when={isDir}
                    fallback={<span class="size-3.5 shrink-0" aria-hidden="true" />}
                  >
                    <Icon
                      name="outline-chevron-right"
                      size="small"
                      class="size-3.5 shrink-0 text-v2-icon-icon-muted transition-transform duration-150"
                      classList={{ "rotate-90": isExpanded() }}
                    />
                  </Show>

                  <FileIcon
                    node={{ path: normalized, type: entry.type }}
                    expanded={isExpanded()}
                    class="size-4 shrink-0"
                  />

                  <span
                    class="min-w-0 flex-1 truncate leading-5"
                    classList={{
                      "text-v2-state-fg-warning": !isDir && badge() === "M",
                      "text-v2-state-fg-success": !isDir && badge() === "A",
                      "text-v2-state-fg-danger line-through": !isDir && badge() === "D",
                      "text-v2-state-fg-info": !isDir && badge() === "U",
                    }}
                    title={normalized}
                  >
                    {name}
                  </span>

                  <Show when={isDirLoading()}>
                    <Loader width={11} height={11} class="shrink-0 text-v2-icon-icon-muted" />
                  </Show>

                  <Show when={!isDir}>{renderFileActions(entry)}</Show>

                  <Show when={badge()}>
                    {(b) => (
                      <span
                        class={`shrink-0 font-mono text-[10.5px] font-semibold leading-none ${badgeToneClass(b())}`}
                        title={badgeLabel(b(), tr)}
                        aria-label={badgeLabel(b(), tr)}
                      >
                        {b()}
                      </span>
                    )}
                  </Show>
                </div>

                <Show when={isExpanded()}>
                  <div role="group">
                    <TreeLevel dir={normalized} depth={props.depth + 1} />
                  </div>
                </Show>
              </div>
            )
          }}
        </For>
      </>
    )
  }

  return (
    <Show
      when={workbench.activeServerCtx() && workbench.activeDirectory()}
      fallback={
        <div class="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
          <div class="flex size-10 items-center justify-center rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
            <ExplorerIcon size={18} />
          </div>
          <div class="text-[12.5px] font-medium text-v2-text-text-base">
            {tr("No project open", "Nenhum projeto aberto")}
          </div>
          <p class="max-w-[210px] text-[11.5px] leading-4 text-v2-text-text-faint">
            {tr(
              "Open a directory or session to browse the workspace file tree.",
              "Abra um diretório ou sessão para navegar pela árvore de arquivos do workspace.",
            )}
          </p>
        </div>
      }
    >
      <div class="flex min-h-0 flex-1 flex-col bg-v2-background-bg-base text-v2-text-text-base">
        {/* Workspace bar & actions */}
        <div class="flex shrink-0 items-center justify-between gap-1.5 border-b border-v2-border-border-muted px-2.5 py-1.5">
          <div class="flex min-w-0 items-center gap-1.5" title={workbench.activeDirectory()}>
            <Icon name="folder" size="small" class="size-3.5 shrink-0 text-v2-icon-icon-muted" />
            <span class="truncate text-[11.5px] font-semibold text-v2-text-text-base">{rootName()}</span>
            <Show when={vcsRows().length > 0}>
              <span
                class="shrink-0 rounded-full bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-v2-text-text-muted"
                title={
                  vcsRows().length === 1
                    ? tr("1 version control change", "1 alteração no controle de versão")
                    : tr("{{count}} version control changes", "{{count}} alterações no controle de versão", {
                        count: vcsRows().length,
                      })
                }
              >
                {vcsRows().length}
              </span>
            </Show>
          </div>

          <div class="flex shrink-0 items-center gap-0.5">
            <Tooltip placement="bottom" value={tr("New File", "Novo Arquivo")}>
              <button
                type="button"
                class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                classList={{ "bg-v2-overlay-simple-overlay-pressed text-v2-text-text-base": creatingFile() }}
                aria-label={tr("New File", "Novo Arquivo")}
                aria-pressed={creatingFile()}
                onClick={handleToggleNewFile}
              >
                <NewFileIcon />
              </button>
            </Tooltip>

            <Tooltip placement="bottom" value={tr("Collapse All", "Recolher Tudo")}>
              <button
                type="button"
                class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                aria-label={tr("Collapse All", "Recolher Tudo")}
                onClick={handleCollapseAll}
              >
                <CollapseAllIcon />
              </button>
            </Tooltip>

            <Tooltip placement="bottom" value={tr("Refresh", "Atualizar")}>
              <button
                type="button"
                class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
                aria-label={tr("Refresh Explorer", "Atualizar Explorer")}
                disabled={refreshing()}
                onClick={() => void handleRefresh()}
              >
                <Show when={refreshing()} fallback={<Icon name="refresh" size="small" class="size-3.5" />}>
                  <Loader width={13} height={13} />
                </Show>
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Filter input */}
        <div class="shrink-0 border-b border-v2-border-border-muted px-2 py-1.5">
          <div class="flex h-7 items-center gap-1.5 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 focus-within:border-v2-border-border-focus">
            <SearchCodeIcon size={13} class="shrink-0 text-v2-icon-icon-muted" />
            <input
              type="text"
              value={filterQuery()}
              placeholder={tr("Filter files...", "Filtrar arquivos...")}
              aria-label={tr("Filter workspace files", "Filtrar arquivos do workspace")}
              class="min-w-0 flex-1 bg-transparent text-[12px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
              onInput={(e) => setFilterQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && filterQuery()) {
                  e.stopPropagation()
                  setFilterQuery("")
                }
              }}
            />
            <Show when={filterLoading()}>
              <Loader width={12} height={12} class="shrink-0 text-v2-icon-icon-muted" />
            </Show>
            <Show when={filterQuery().length > 0 && !filterLoading()}>
              <button
                type="button"
                class="flex size-4 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                aria-label={tr("Clear filter", "Limpar filtro")}
                onClick={() => setFilterQuery("")}
              >
                <Icon name="outline-xmark" size="small" class="size-3" />
              </button>
            </Show>
          </div>
        </div>

        {/* Inline New File creator */}
        <Show when={creatingFile()}>
          <form
            class="shrink-0 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01 px-2 py-2"
            onSubmit={(e) => void handleCreateFile(e)}
          >
            <div class="mb-1 flex items-center justify-between text-[11px] font-medium text-v2-text-text-muted">
              <span>{tr("New File", "Novo Arquivo")}</span>
              <span class="text-[10px] text-v2-text-text-faint">{tr("Enter to create", "Enter para criar")}</span>
            </div>
            <div class="flex items-center gap-1">
              <input
                ref={newFileInput}
                type="text"
                value={newFilePath()}
                disabled={creatingBusy()}
                placeholder={tr("path/to/file.ts", "caminho/do/arquivo.ts")}
                aria-label={tr("New file path", "Caminho do novo arquivo")}
                class="h-7 min-w-0 flex-1 rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 font-mono text-[11.5px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint focus:border-v2-border-border-focus"
                onInput={(e) => {
                  setNewFilePath(e.currentTarget.value)
                  setCreateError(undefined)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation()
                    setCreatingFile(false)
                    setCreateError(undefined)
                  }
                }}
              />
              <Tooltip placement="bottom" value={tr("Create file", "Criar arquivo")}>
                <button
                  type="submit"
                  disabled={creatingBusy()}
                  class="flex size-7 shrink-0 items-center justify-center rounded-[5px] bg-v2-background-bg-accent text-v2-text-text-inverse hover:opacity-90 disabled:opacity-50"
                  aria-label={tr("Confirm file creation", "Confirmar criação do arquivo")}
                >
                  <Show when={creatingBusy()} fallback={<Icon name="check" size="small" class="size-3.5" />}>
                    <Loader width={12} height={12} />
                  </Show>
                </button>
              </Tooltip>
              <Tooltip placement="bottom" value={tr("Cancel", "Cancelar")}>
                <button
                  type="button"
                  disabled={creatingBusy()}
                  class="flex size-7 shrink-0 items-center justify-center rounded-[5px] border border-v2-border-border-base text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                  aria-label={tr("Cancel file creation", "Cancelar criação de arquivo")}
                  onClick={() => {
                    setCreatingFile(false)
                    setCreateError(undefined)
                  }}
                >
                  <Icon name="outline-xmark" size="small" class="size-3.5" />
                </button>
              </Tooltip>
            </div>
            <Show when={createErrorMessage()}>
              {(message) => <div class="mt-1 text-[11px] text-v2-state-fg-danger">{message()}</div>}
            </Show>
          </form>
        </Show>

        {/* File tree or filtered search results */}
        <div
          data-slot="workbench-scroll"
          role="tree"
          aria-label={tr("Project files", "Arquivos do projeto")}
          class="min-h-0 flex-1 overflow-y-auto py-1"
        >
          <Show
            when={isFiltering()}
            fallback={
              <Show
                when={!tree.loading[""] || (tree.entries[""]?.length ?? 0) > 0}
                fallback={
                  <div class="flex items-center justify-center gap-2 py-8 text-[12px] text-v2-text-text-faint">
                    <Loader width={14} height={14} />
                    <span>{tr("Loading files...", "Carregando arquivos...")}</span>
                  </div>
                }
              >
                <Show
                  when={(tree.entries[""]?.length ?? 0) > 0 || Boolean(tree.errors[""])}
                  fallback={
                    <div class="px-4 py-8 text-center text-[12px] text-v2-text-text-faint">
                      {tr("Empty directory.", "Diretório vazio.")}
                    </div>
                  }
                >
                  <TreeLevel dir="" depth={0} />
                </Show>
              </Show>
            }
          >
            <Show when={filterError()}>
              {(message) => (
                <div class="mx-2 my-1 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger px-2.5 py-1.5 text-[11.5px] text-v2-state-fg-danger">
                  {message()}
                </div>
              )}
            </Show>

            <Show when={!filterLoading() && !filterError() && filterResults().length === 0}>
              <div class="px-4 py-8 text-center text-[12px] text-v2-text-text-faint">
                {tr('No files found for "{{query}}".', 'Nenhum arquivo encontrado para "{{query}}".', {
                  query: filterQuery().trim(),
                })}
              </div>
            </Show>

            <Show when={filterResults().length > 0}>
              <div class="px-2.5 pb-1 text-[10.5px] text-v2-text-text-faint">
                {filterResults().length === 1
                  ? tr("1 item", "1 item")
                  : tr("{{count}} items", "{{count}} itens", { count: filterResults().length })}
              </div>
            </Show>

            <For each={filterResults()}>
              {(entry) => {
                const normalized = normalizeRelativePath(entry.path)
                const name = getFilename(normalized) || normalized
                const parent = parentDirectory(normalized)
                const isDir = entry.type === "directory"
                const badge = () => (isDir ? vcsByFolder().get(normalized) : vcsByFile().get(normalized))

                return (
                  <div
                    role="treeitem"
                    tabIndex={0}
                    class="group/row flex h-[28px] cursor-pointer items-center gap-1.5 px-2.5 text-[12.5px] select-none transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-1 focus-visible:outline-v2-border-border-focus"
                    classList={{ "bg-v2-overlay-simple-overlay-pressed": activeFile() === normalized }}
                    onClick={() => {
                      if (isDir) {
                        setFilterQuery("")
                        setTree("expanded", normalized, true)
                        void loadDirectory(normalized)

                        return
                      }

                      handleOpenFile(entry.path, false)
                    }}
                    onDblClick={() => {
                      if (isDir) return
                      handleOpenFile(entry.path, true)
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return
                      e.preventDefault()

                      if (isDir) {
                        setFilterQuery("")
                        setTree("expanded", normalized, true)
                        void loadDirectory(normalized)

                        return
                      }

                      handleOpenFile(entry.path, e.key === "Enter")
                    }}
                  >
                    <FileIcon node={{ path: normalized, type: entry.type }} class="size-4 shrink-0" />
                    <div class="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
                      <span
                        class="shrink-0 truncate text-[12.5px]"
                        classList={{
                          "text-v2-state-fg-warning": !isDir && badge() === "M",
                          "text-v2-state-fg-success": !isDir && badge() === "A",
                          "text-v2-state-fg-danger line-through": !isDir && badge() === "D",
                          "text-v2-state-fg-info": !isDir && badge() === "U",
                        }}
                      >
                        {name}
                      </span>
                      <Show when={parent}>
                        <span class="min-w-0 truncate text-[11px] text-v2-text-text-faint" title={normalized}>
                          {parent}
                        </span>
                      </Show>
                    </div>

                    <Show when={!isDir}>{renderFileActions(entry)}</Show>

                    <Show when={badge()}>
                      {(b) => (
                        <span
                          class={`shrink-0 font-mono text-[10.5px] font-semibold leading-none ${badgeToneClass(b())}`}
                          title={badgeLabel(b(), tr)}
                          aria-label={badgeLabel(b(), tr)}
                        >
                          {b()}
                        </span>
                      )}
                    </Show>
                  </div>
                )
              }}
            </For>
          </Show>
        </div>
      </div>
    </Show>
  )
}

function normalizeRelativePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "")
}

function parentDirectory(relPath: string) {
  const dir = getDirectory(normalizeRelativePath(relPath)).replace(/\/+$/, "")

  return dir
}

function ancestorDirectories(relPath: string) {
  const parts = normalizeRelativePath(relPath).split("/").filter(Boolean)

  if (parts.length <= 1) return []

  const ancestors: string[] = []

  for (let index = 0; index < parts.length - 1; index++) {
    ancestors.push(parts.slice(0, index + 1).join("/"))
  }

  return ancestors
}

function sortEntries(entries: readonly FileSystemEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1

    const nameA = getFilename(a.path) || a.path
    const nameB = getFilename(b.path) || b.path

    return nameA.localeCompare(nameB, undefined, { sensitivity: "base", numeric: true })
  })
}

function badgeForStatus(status: VcsFileStatus["status"]): VcsBadge {
  if (status === "modified") return "M"

  if (status === "deleted") return "D"

  if (status === "added") return "A"

  return "U"
}

function badgeLabel(badge: VcsBadge, tr: Translate) {
  if (badge === "M") return tr("Modified", "Modificado")

  if (badge === "A") return tr("Added", "Adicionado")

  if (badge === "D") return tr("Deleted", "Removido")

  return tr("Untracked", "Não rastreado")
}

function badgeToneClass(badge: VcsBadge) {
  if (badge === "M") return "text-v2-state-fg-warning"

  if (badge === "A") return "text-v2-state-fg-success"

  if (badge === "D") return "text-v2-state-fg-danger"

  return "text-v2-state-fg-info"
}

function sanitizeNewFilePath(raw: string) {
  const trimmed = raw.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "")

  if (!trimmed || trimmed.endsWith("/")) return undefined

  const segments = trimmed.split("/")

  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return undefined

  return segments.join("/")
}

function joinWorkspacePath(directory: string, relativePath: string) {
  const windows = directory.includes("\\") || /^[A-Za-z]:/.test(directory)
  const sep = windows ? "\\" : "/"
  const base = directory.replace(/[/\\]+$/, "")
  const rel = normalizeRelativePath(relativePath).replaceAll("/", sep)

  if (!rel) return base

  return `${base}${sep}${rel}`
}

function NewFileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M9.5 2H4.25A1.25 1.25 0 0 0 3 3.25v9.5A1.25 1.25 0 0 0 4.25 14h7.5A1.25 1.25 0 0 0 13 12.75V5.5L9.5 2Z"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
      <path d="M9.25 2v3.5H13" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
      <path d="M8 7.5v4M6 9.5h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  )
}

function CollapseAllIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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

function MentionAtIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="8" cy="8" r="2.4" stroke="currentColor" stroke-width="1.3" />
      <path
        d="M10.4 5.6v3.1a1.55 1.55 0 0 0 3.1 0V8a5.5 5.5 0 1 0-2.15 4.35"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
      />
    </svg>
  )
}
