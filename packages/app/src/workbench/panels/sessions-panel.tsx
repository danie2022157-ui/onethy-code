import { batch, createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { SessionInfo } from "@opencode/client/promise"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { getFilename } from "@opencode/util/path"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { ServerConnection } from "@/runtime/server/registry"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { sessionTitle } from "@/session/title"
import { showToast } from "@/shell/notifications/toast"
import { useTabs } from "@/shell/tabs/tabs"
import { notifySessionTabsRemoved } from "@/shell/titlebar/session-events"
import { pathKey } from "@/workspaces/path-key"
import { GitBranchIcon, SearchCodeIcon, SessionsIcon } from "../icons"
import { useWorkbench } from "../state"

type SessionFilterScope = "all" | "project"

type PendingConfirm = {
  sessionId: string
  kind: "archive" | "delete"
}

export function SessionsPanel() {
  const workbench = useWorkbench()
  const tabs = useTabs()
  const { tr, relativeTime } = useOnethyI18n()

  const [searchQuery, setSearchQuery] = createSignal("")
  const [filterScope, setFilterScope] = createSignal<SessionFilterScope>("all")
  const [fetchedSessions, setFetchedSessions] = createSignal<readonly SessionInfo[]>([])
  const [archivedIds, setArchivedIds] = createSignal<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = createSignal(false)
  const [refreshing, setRefreshing] = createSignal(false)
  const [loadError, setLoadError] = createSignal<string | undefined>(undefined)
  const [creatingDraft, setCreatingDraft] = createSignal(false)
  const [forkingId, setForkingId] = createSignal<string | undefined>(undefined)
  const [archivingId, setArchivingId] = createSignal<string | undefined>(undefined)
  const [deletingId, setDeletingId] = createSignal<string | undefined>(undefined)
  const [confirmAction, setConfirmAction] = createSignal<PendingConfirm | undefined>(undefined)
  const [clockTick, setClockTick] = createSignal(Date.now())

  let fetchGen = 0

  createEffect(() => {
    const timer = setInterval(() => setClockTick(Date.now()), 30_000)
    onCleanup(() => clearInterval(timer))
  })

  // Auto-disarm 2-click confirmation after a short window so rows do not stay stuck armed.
  createEffect(() => {
    const armed = confirmAction()

    if (!armed) return

    const timer = setTimeout(() => {
      setConfirmAction((current) =>
        current && current.sessionId === armed.sessionId && current.kind === armed.kind ? undefined : current,
      )
    }, 4500)

    onCleanup(() => clearTimeout(timer))
  })

  const loadSessions = async () => {
    const ctx = workbench.activeServerCtx()

    if (!ctx) {
      setFetchedSessions([])
      setLoading(false)
      setLoadError(undefined)

      return
    }

    const generation = ++fetchGen
    setLoading(true)
    setLoadError(undefined)

    const result = await ctx.sdk.api.session
      .list({ limit: 120, order: "desc", parentID: null, archived: false })
      .then((res) => ({ ok: true as const, data: res.data }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    if (generation !== fetchGen) return

    batch(() => {
      setLoading(false)

      if (!result.ok) {
        setLoadError(result.message)

        return
      }

      setFetchedSessions(result.data)
      setLoadError(undefined)
    })
  }

  // Load server root sessions on mount or active server switch.
  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    fetchGen += 1

    batch(() => {
      setConfirmAction(undefined)
      setArchivedIds(new Set<string>())
    })

    if (!ctx) {
      setFetchedSessions([])
      setLoading(false)
      setLoadError(undefined)

      return
    }

    void loadSessions()
  })

  // Keep list synchronized with live server session lifecycle events.
  createEffect(() => {
    const ctx = workbench.activeServerCtx()

    if (!ctx) return

    const unsubCreated = ctx.data.on("session.created", () => {
      void loadSessions()
    })
    const unsubForked = ctx.data.on("session.forked", () => {
      void loadSessions()
    })
    const unsubArchived = ctx.data.on("session.archived", (event) => {
      setFetchedSessions((current) => current.filter((item) => item.id !== event.data.sessionID))
    })
    const unsubUnarchived = ctx.data.on("session.unarchived", (event) => {
      setArchivedIds((current) => {
        if (!current.has(event.data.sessionID)) return current
        const next = new Set(current)
        next.delete(event.data.sessionID)

        return next
      })
      void loadSessions()
    })
    const unsubDeleted = ctx.data.on("session.deleted", (event) => {
      setFetchedSessions((current) => current.filter((item) => item.id !== event.data.sessionID))
    })

    onCleanup(() => {
      unsubCreated()
      unsubForked()
      unsubArchived()
      unsubUnarchived()
      unsubDeleted()
    })
  })

  const currentProjectKey = createMemo(() => {
    const dir = workbench.activeDirectory()

    return dir ? pathKey(dir) : undefined
  })

  const currentProjectID = createMemo(() => {
    const ctx = workbench.activeServerCtx()
    const dir = workbench.activeDirectory()

    if (!ctx || !dir) return undefined

    return ctx.projects.forDirectory(dir)?.id
  })

  const activeRootID = createMemo(() => {
    const ctx = workbench.activeServerCtx()
    const id = workbench.activeSessionID()

    if (!ctx || !id) return undefined

    const current = ctx.data.session.get(id)

    if (!current?.parentID) return id

    return ctx.data.session.root(id)
  })

  const childStatsByRoot = createMemo(() => {
    const ctx = workbench.activeServerCtx()
    const stats = new Map<string, { total: number; running: number }>()

    if (!ctx) return stats

    for (const session of ctx.data.session.list()) {
      if (!session.parentID) continue

      const rootID = ctx.data.session.root(session.id)
      const current = stats.get(rootID) ?? { total: 0, running: 0 }
      const running = ctx.data.session.status(session.id) === "running" ? 1 : 0
      stats.set(rootID, { total: current.total + 1, running: current.running + running })
    }

    return stats
  })

  // Merge fetched historical root sessions with live reactive store sessions.
  const allRootSessions = createMemo<readonly SessionInfo[]>(() => {
    const ctx = workbench.activeServerCtx()

    if (!ctx) return []

    const liveSessions = ctx.data.session.list()
    const mergedById = new Map<string, SessionInfo>()

    for (const session of fetchedSessions()) {
      mergedById.set(session.id, session)
    }

    for (const session of liveSessions) {
      mergedById.set(session.id, session)
    }

    const hiddenArchived = archivedIds()
    const applied = ctx.data.session.apply([...mergedById.values()])

    return applied
      .filter(
        (session) =>
          !session.parentID && typeof session.time.archived !== "number" && !hiddenArchived.has(session.id),
      )
      .toSorted((a, b) => {
        const updatedDiff = (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)

        if (updatedDiff !== 0) return updatedDiff

        return a.id.localeCompare(b.id)
      })
  })

  const matchesCurrentProject = (session: SessionInfo) => {
    const projectID = currentProjectID()

    if (projectID && session.projectID === projectID) return true

    const projectKey = currentProjectKey()

    if (!projectKey) return false

    return pathKey(session.location.directory) === projectKey
  }

  const formatSessionTitle = (session: Pick<SessionInfo, "title" | "parentID">) => {
    const cleaned = sessionTitle(session.title)

    if (!cleaned || cleaned === "New session") return tr("New session", "Nova sessão")
    if (cleaned === "Child session") return tr("Subagent", "Subagente")

    return cleaned
  }

  const projectRootSessions = createMemo(() => allRootSessions().filter(matchesCurrentProject))

  const visibleSessions = createMemo(() => {
    const base = filterScope() === "project" ? projectRootSessions() : allRootSessions()
    const query = searchQuery().trim().toLowerCase()

    if (!query) return base

    return base.filter((session) => {
      const title = formatSessionTitle(session).toLowerCase()
      const projectName = projectBasename(session.location.directory).toLowerCase()
      const directory = session.location.directory.toLowerCase()
      const agent = (session.agent ?? "").toLowerCase()

      return (
        title.includes(query) ||
        projectName.includes(query) ||
        directory.includes(query) ||
        agent.includes(query) ||
        session.id.toLowerCase().includes(query)
      )
    })
  })

  const isSessionRunning = (sessionID: string) => {
    const ctx = workbench.activeServerCtx()

    if (!ctx) return false

    return ctx.data.session.status(sessionID) === "running"
  }

  const handleRefresh = async () => {
    if (refreshing()) return
    setRefreshing(true)
    await loadSessions()
    setRefreshing(false)
  }

  const handleNewSession = async () => {
    const conn = workbench.activeServer()
    const ctx = workbench.activeServerCtx()
    const dir = workbench.activeDirectory() ?? ctx?.data.location.default().directory

    if (creatingDraft()) return

    if (!conn || !dir) {
      showToast({
        variant: "default",
        title: tr("No active workspace connected.", "Nenhum workspace ativo conectado."),
      })

      return
    }

    setCreatingDraft(true)

    const result = await tabs
      .newDraft({ server: ServerConnection.key(conn), directory: dir }, "")
      .then(() => ({ ok: true as const }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    setCreatingDraft(false)

    if (!result.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to start new session", "Falha ao iniciar nova sessão"),
        description: result.message,
      })
    }
  }

  const handleOpenSession = (session: SessionInfo) => {
    const conn = workbench.activeServer()
    const ctx = workbench.activeServerCtx()

    if (!conn || !ctx) return

    ctx.data.session.remember(session)
    void ctx.data.session.message.sync(session.id).catch(() => undefined)
    ctx.projects.touch(session.location.directory)
    const tab = tabs.addSessionTab({
      server: ServerConnection.key(conn),
      sessionId: session.id,
    })
    tabs.select(tab)
  }

  const handleForkSession = async (event: MouseEvent, session: SessionInfo) => {
    event.stopPropagation()

    const conn = workbench.activeServer()
    const ctx = workbench.activeServerCtx()

    if (!conn || !ctx || forkingId() === session.id) return

    setConfirmAction(undefined)
    setForkingId(session.id)

    const result = await ctx.sdk.api.session
      .fork({ sessionID: session.id })
      .then((forked) => ({ ok: true as const, forked }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    setForkingId((current) => (current === session.id ? undefined : current))

    if (!result.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to fork session", "Falha ao bifurcar sessão"),
        description: result.message,
      })

      return
    }

    ctx.data.session.remember(result.forked)
    setFetchedSessions((current) => [result.forked, ...current.filter((item) => item.id !== result.forked.id)])
    const tab = tabs.addSessionTab({
      server: ServerConnection.key(conn),
      sessionId: result.forked.id,
    })
    tabs.select(tab)
    showToast({
      variant: "success",
      title: tr("Session forked", "Sessão bifurcada"),
      description: formatSessionTitle(result.forked),
    })
  }

  const handleArchiveClick = async (event: MouseEvent, session: SessionInfo) => {
    event.stopPropagation()

    const armed = confirmAction()

    if (!armed || armed.sessionId !== session.id || armed.kind !== "archive") {
      setConfirmAction({ sessionId: session.id, kind: "archive" })

      return
    }

    const conn = workbench.activeServer()
    const ctx = workbench.activeServerCtx()

    if (!conn || !ctx || archivingId() === session.id) return

    setConfirmAction(undefined)
    setArchivingId(session.id)

    const result = await ctx.sdk.api.session
      .update({ sessionID: session.id, archived: true })
      .then(() => ({ ok: true as const }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    setArchivingId((current) => (current === session.id ? undefined : current))

    if (!result.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to archive session", "Falha ao arquivar sessão"),
        description: result.message,
      })

      return
    }

    const ids = sessionTreeIDs(ctx.data.session.list(), session.id)

    batch(() => {
      setArchivedIds((current) => {
        const next = new Set(current)
        next.add(session.id)

        return next
      })
      setFetchedSessions((current) => current.filter((item) => item.id !== session.id))
    })

    ctx.data.session.invalidate(session.id)
    notifySessionTabsRemoved({
      server: ServerConnection.key(conn),
      directory: session.location.directory,
      sessionIDs: ids,
    })
    showToast({
      variant: "default",
      title: tr("Session archived", "Sessão arquivada"),
      description: formatSessionTitle(session),
    })
  }

  const handleDeleteClick = async (event: MouseEvent, session: SessionInfo) => {
    event.stopPropagation()

    const armed = confirmAction()

    if (!armed || armed.sessionId !== session.id || armed.kind !== "delete") {
      setConfirmAction({ sessionId: session.id, kind: "delete" })

      return
    }

    const conn = workbench.activeServer()
    const ctx = workbench.activeServerCtx()

    if (!conn || !ctx || deletingId() === session.id) return

    setConfirmAction(undefined)
    setDeletingId(session.id)

    const ids = sessionTreeIDs(ctx.data.session.list(), session.id)

    const result = await ctx.data.session
      .remove(session.id)
      .then(() => ({ ok: true as const }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    setDeletingId((current) => (current === session.id ? undefined : current))

    if (!result.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to delete session", "Falha ao excluir sessão"),
        description: result.message,
      })

      return
    }

    setFetchedSessions((current) => current.filter((item) => item.id !== session.id))
    notifySessionTabsRemoved({
      server: ServerConnection.key(conn),
      directory: session.location.directory,
      sessionIDs: ids,
    })
    showToast({
      variant: "default",
      title: tr("Session deleted", "Sessão excluída"),
      description: formatSessionTitle(session),
    })
  }

  return (
    <Show
      when={workbench.activeServerCtx()}
      fallback={
        <div class="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
          <div class="flex size-10 items-center justify-center rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
            <SessionsIcon size={18} />
          </div>
          <div class="text-[12.5px] font-medium text-v2-text-text-base">
            {tr("No server connected", "Nenhum servidor conectado")}
          </div>
          <p class="max-w-[215px] text-[11.5px] leading-4 text-v2-text-text-faint">
            {tr(
              "Connect a server to list, search, fork, and start work sessions.",
              "Conecte um servidor para listar, buscar, bifurcar e iniciar sessões de trabalho.",
            )}
          </p>
        </div>
      }
    >
      <div class="flex min-h-0 flex-1 flex-col bg-v2-background-bg-base text-v2-text-text-base">
        {/* Top actions: New Session + Refresh */}
        <div class="flex shrink-0 items-center gap-1.5 border-b border-v2-border-border-muted px-2.5 py-2">
          <button
            type="button"
            disabled={creatingDraft()}
            class="inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[6px] bg-v2-background-bg-accent px-2.5 text-[12px] font-medium text-v2-text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-50"
            onClick={() => void handleNewSession()}
          >
            <Show when={creatingDraft()} fallback={<Icon name="plus" size="small" class="size-3.5 shrink-0" />}>
              <Loader width={12} height={12} />
            </Show>
            <span class="truncate">{tr("New Session", "Nova Sessão")}</span>
          </button>

          <Tooltip placement="bottom" value={tr("Refresh sessions list", "Atualizar lista de sessões")}>
            <button
              type="button"
              disabled={refreshing()}
              class="flex size-7 shrink-0 items-center justify-center rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 text-v2-icon-icon-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
              aria-label={tr("Refresh sessions", "Atualizar sessões")}
              onClick={() => void handleRefresh()}
            >
              <Show when={refreshing()} fallback={<Icon name="refresh" size="small" class="size-3.5" />}>
                <Loader width={13} height={13} />
              </Show>
            </button>
          </Tooltip>
        </div>

        {/* Search bar & filter pills */}
        <div class="flex shrink-0 flex-col gap-1.5 border-b border-v2-border-border-muted px-2.5 py-2">
          <div class="flex h-7 items-center gap-1.5 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 focus-within:border-v2-border-border-focus">
            <SearchCodeIcon size={13} class="shrink-0 text-v2-icon-icon-muted" />
            <input
              type="text"
              value={searchQuery()}
              placeholder={tr("Search sessions...", "Buscar sessões...")}
              aria-label={tr("Search sessions by title or project", "Buscar sessões por título ou projeto")}
              class="min-w-0 flex-1 bg-transparent text-[12px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && searchQuery()) {
                  e.stopPropagation()
                  setSearchQuery("")
                }
              }}
            />
            <Show when={searchQuery().length > 0}>
              <button
                type="button"
                class="flex size-4 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                aria-label={tr("Clear search", "Limpar busca")}
                onClick={() => setSearchQuery("")}
              >
                <Icon name="outline-xmark" size="small" class="size-3" />
              </button>
            </Show>
          </div>

          <div class="flex items-center gap-1" role="tablist" aria-label={tr("Session filter", "Filtro de sessões")}>
            <button
              type="button"
              role="tab"
              aria-selected={filterScope() === "all"}
              class="inline-flex h-6 flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 text-[11px] font-medium transition-colors"
              classList={{
                "bg-v2-overlay-simple-overlay-pressed text-v2-text-text-base": filterScope() === "all",
                "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                  filterScope() !== "all",
              }}
              onClick={() => setFilterScope("all")}
            >
              <span>{tr("All", "Todas")}</span>
              <span class="rounded-full bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[9.5px] leading-none text-v2-text-text-muted">
                {allRootSessions().length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={filterScope() === "project"}
              disabled={!workbench.activeDirectory()}
              class="inline-flex h-6 flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 text-[11px] font-medium transition-colors disabled:opacity-45"
              classList={{
                "bg-v2-overlay-simple-overlay-pressed text-v2-text-text-base": filterScope() === "project",
                "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                  filterScope() !== "project",
              }}
              onClick={() => setFilterScope("project")}
            >
              <span class="truncate">{tr("Current Project", "Projeto Atual")}</span>
              <span class="rounded-full bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[9.5px] leading-none text-v2-text-text-muted">
                {projectRootSessions().length}
              </span>
            </button>
          </div>
        </div>

        {/* Sessions list */}
        <div
          data-slot="workbench-scroll"
          role="list"
          aria-label={tr("Sessions list", "Lista de sessões")}
          class="min-h-0 flex-1 overflow-y-auto py-1"
        >
          <Show when={loadError()}>
            {(message) => (
              <div class="mx-2 my-1 rounded-[6px] border border-v2-state-border-danger bg-v2-state-bg-danger px-2.5 py-1.5 text-[11px] text-v2-state-fg-danger">
                {message()}
              </div>
            )}
          </Show>

          <Show
            when={!loading() || allRootSessions().length > 0}
            fallback={
              <div class="flex items-center justify-center gap-2 py-8 text-[12px] text-v2-text-text-faint">
                <Loader width={14} height={14} />
                <span>{tr("Loading sessions...", "Carregando sessões...")}</span>
              </div>
            }
          >
            <Show
              when={visibleSessions().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
                  <SessionsIcon size={18} class="text-v2-icon-icon-muted/70" />
                  <div class="text-[12px] font-medium text-v2-text-text-muted">
                    {searchQuery().trim()
                      ? tr("No sessions found", "Nenhuma sessão encontrada")
                      : filterScope() === "project"
                        ? tr("No sessions in this project", "Nenhuma sessão neste projeto")
                        : tr("No sessions yet", "Nenhuma sessão registrada")}
                  </div>
                  <p class="max-w-[210px] text-[11px] leading-4 text-v2-text-text-faint">
                    {searchQuery().trim()
                      ? tr('No results for "{{query}}".', 'Sem resultados para "{{query}}".', {
                          query: searchQuery().trim(),
                        })
                      : tr('Click "New Session" above to get started.', 'Clique em "Nova Sessão" acima para começar.')}
                  </p>
                </div>
              }
            >
              <For each={visibleSessions()}>
                {(session) => {
                  const running = () => isSessionRunning(session.id)
                  const isActive = () =>
                    workbench.activeSessionID() === session.id || activeRootID() === session.id
                  const armed = () => {
                    const current = confirmAction()

                    return current && current.sessionId === session.id ? current : undefined
                  }
                  const isForking = () => forkingId() === session.id
                  const isArchiving = () => archivingId() === session.id
                  const isDeleting = () => deletingId() === session.id
                  const isBusy = () => isForking() || isArchiving() || isDeleting()
                  const subagents = () => childStatsByRoot().get(session.id)
                  const title = () => formatSessionTitle(session)
                  const projectName = () => projectBasename(session.location.directory)
                  const timestampLabel = () => {
                    clockTick()
                    return relativeTime(session.time.updated ?? session.time.created)
                  }

                  return (
                    <div
                      role="listitem"
                      tabIndex={0}
                      class="group/row relative mx-1.5 my-0.5 flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 select-none transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-1 focus-visible:outline-v2-border-border-focus"
                      classList={{
                        "bg-v2-overlay-simple-overlay-pressed": isActive(),
                      }}
                      onClick={() => handleOpenSession(session)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape" && armed()) {
                          e.stopPropagation()
                          setConfirmAction(undefined)

                          return
                        }

                        if (e.key !== "Enter" && e.key !== " ") return
                        e.preventDefault()
                        handleOpenSession(session)
                      }}
                    >
                      <Show when={isActive()}>
                        <span
                          aria-hidden="true"
                          class="pointer-events-none absolute inset-y-1.5 start-0 w-[2.5px] rounded-full bg-v2-background-bg-accent"
                        />
                      </Show>

                      {/* Running / Status indicator */}
                      <div class="flex size-3.5 shrink-0 items-center justify-center">
                        <Show
                          when={running()}
                          fallback={
                            <span
                              class="inline-block size-1.5 rounded-full"
                              classList={{
                                "bg-v2-background-bg-accent": isActive(),
                                "bg-v2-state-fg-danger": !isActive() && session.outcome === "failed",
                                "bg-v2-icon-icon-muted/50": !isActive() && session.outcome !== "failed",
                              }}
                            />
                          }
                        >
                          <span
                            class="onethy-pulse-dot inline-block size-2 rounded-full bg-v2-background-bg-accent"
                            title={tr("Running session", "Sessão em execução")}
                          />
                        </Show>
                      </div>

                      {/* Title & metadata */}
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                          <span
                            class="min-w-0 flex-1 truncate text-[12px] leading-4"
                            classList={{
                              "font-semibold text-v2-text-text-base": isActive(),
                              "font-medium text-v2-text-text-base": !isActive(),
                            }}
                            title={title()}
                          >
                            {title()}
                          </span>
                        </div>

                        <div class="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-v2-text-text-faint">
                          <span class="min-w-0 truncate" title={session.location.directory}>
                            {projectName()}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span class="shrink-0 tabular-nums">{timestampLabel()}</span>
                          <Show when={subagents()}>
                            {(stats) => (
                              <span
                                class="shrink-0 rounded bg-v2-background-bg-layer-02 px-1 py-0.5 font-mono text-[9.5px] leading-none"
                                classList={{
                                  "text-v2-text-text-accent": stats().running > 0,
                                  "text-v2-text-text-faint": stats().running === 0,
                                }}
                                title={
                                  stats().total === 1
                                    ? tr("1 subagent", "1 subagente")
                                    : tr("{{count}} subagents", "{{count}} subagentes", { count: stats().total })
                                }
                              >
                                +{stats().total}
                              </span>
                            )}
                          </Show>
                        </div>
                      </div>

                      {/* Hover SVG actions or 2-click inline confirmation */}
                      <Show
                        when={armed()}
                        fallback={
                          <div
                            class="flex shrink-0 items-center gap-0.5 transition-opacity duration-100"
                            classList={{
                              "opacity-100": isBusy(),
                              "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100": !isBusy(),
                            }}
                          >
                            <Tooltip placement="top" value={tr("Fork session", "Bifurcar sessão (Fork)")}>
                              <button
                                type="button"
                                disabled={isBusy()}
                                class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
                                aria-label={tr("Fork {{title}}", "Bifurcar {{title}}", { title: title() })}
                                onClick={(e) => void handleForkSession(e, session)}
                              >
                                <Show when={isForking()} fallback={<GitBranchIcon size={12} />}>
                                  <Loader width={11} height={11} />
                                </Show>
                              </button>
                            </Tooltip>

                            <Tooltip placement="top" value={tr("Archive session", "Arquivar sessão")}>
                              <button
                                type="button"
                                disabled={isBusy()}
                                class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
                                aria-label={tr("Archive {{title}}", "Arquivar {{title}}", { title: title() })}
                                onClick={(e) => void handleArchiveClick(e, session)}
                              >
                                <Show when={isArchiving()} fallback={<ArchiveBoxIcon />}>
                                  <Loader width={11} height={11} />
                                </Show>
                              </button>
                            </Tooltip>

                            <Tooltip placement="top" value={tr("Delete session", "Excluir sessão")}>
                              <button
                                type="button"
                                disabled={isBusy()}
                                class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-state-bg-danger hover:text-v2-state-fg-danger disabled:opacity-50"
                                aria-label={tr("Delete {{title}}", "Excluir {{title}}", { title: title() })}
                                onClick={(e) => void handleDeleteClick(e, session)}
                              >
                                <Show
                                  when={isDeleting()}
                                  fallback={<Icon name="trash" size="small" class="size-3" />}
                                >
                                  <Loader width={11} height={11} />
                                </Show>
                              </button>
                            </Tooltip>
                          </div>
                        }
                      >
                        {(pending) => (
                          <div class="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              class="inline-flex h-5 items-center gap-1 rounded-[4px] border px-1.5 text-[10px] font-semibold transition-opacity hover:opacity-90"
                              classList={{
                                "border-v2-state-border-danger bg-v2-state-bg-danger text-v2-state-fg-danger":
                                  pending().kind === "delete",
                                "border-v2-state-border-warning bg-v2-state-bg-warning text-v2-state-fg-warning":
                                  pending().kind === "archive",
                              }}
                              aria-label={
                                pending().kind === "delete"
                                  ? tr("Confirm deleting {{title}}", "Confirmar exclusão de {{title}}", {
                                      title: title(),
                                    })
                                  : tr("Confirm archiving {{title}}", "Confirmar arquivamento de {{title}}", {
                                      title: title(),
                                    })
                              }
                              onClick={(e) => {
                                if (pending().kind === "delete") {
                                  void handleDeleteClick(e, session)

                                  return
                                }

                                void handleArchiveClick(e, session)
                              }}
                            >
                              <span>
                                {pending().kind === "delete"
                                  ? tr("Delete?", "Excluir?")
                                  : tr("Archive?", "Arquivar?")}
                              </span>
                            </button>

                            <button
                              type="button"
                              class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                              aria-label={tr("Cancel confirmation", "Cancelar confirmação")}
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmAction(undefined)
                              }}
                            >
                              <Icon name="outline-xmark" size="small" class="size-3" />
                            </button>
                          </div>
                        )}
                      </Show>
                    </div>
                  )
                }}
              </For>
            </Show>
          </Show>
        </div>
      </div>
    </Show>
  )
}

function projectBasename(directory: string) {
  const clean = directory.replace(/[/\\]+$/, "")

  return getFilename(clean) || clean || "Workspace"
}

function ArchiveBoxIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="3" rx="0.8" stroke="currentColor" stroke-width="1.3" />
      <path
        d="M3.25 5.5v7a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1v-7"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
      <path d="M6.25 8.5h3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  )
}
