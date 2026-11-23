import { batch, createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type {
  AgentInfo,
  JsonValue,
  PermissionReply,
  PermissionRequest,
  PermissionSavedInfo,
  SessionInfo,
  SessionMessageAssistantTool,
} from "@opencode/client/promise"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { ServerConnection } from "@/runtime/server/registry"
import { sessionTitle } from "@/session/title"
import { showToast } from "@/shell/notifications/toast"
import { useTabs } from "@/shell/tabs/tabs"
import { AgentsIcon, CheckShieldIcon } from "../icons"
import { useWorkbench } from "../state"

type ToolActivityItem = {
  id: string
  messageID: string
  name: string
  status: "running" | "completed" | "error"
  summary: string
  created: number
}

type TranslateFn = ReturnType<typeof useOnethyI18n>["tr"]

const PRIMARY_AGENT_IDS: ReadonlySet<string> = new Set(["omni", "orchestrator", "build", "plan"])
const SPECIALIST_AGENT_IDS: ReadonlySet<string> = new Set([
  "architect",
  "coder",
  "reviewer",
  "planner",
  "librarian",
  "explore",
  "browser",
  "general",
])

const PRIMARY_ORDER: Record<string, number> = {
  omni: 0,
  plan: 1,
  build: 2,
  orchestrator: 3,
}

const SPECIALIST_ORDER: Record<string, number> = {
  architect: 0,
  coder: 1,
  reviewer: 2,
  planner: 3,
  librarian: 4,
  explore: 5,
  browser: 6,
  general: 7,
}

const TOOL_SUMMARY_KEYS = [
  "description",
  "command",
  "filePath",
  "file_path",
  "path",
  "pattern",
  "query",
  "url",
  "prompt",
  "subagent_type",
  "agent",
  "name",
] as const

export function AgentsPanel() {
  const workbench = useWorkbench()
  const tabs = useTabs()
  const { tr, relativeTime } = useOnethyI18n()

  const [pendingApprovals, setPendingApprovals] = createSignal<readonly PermissionRequest[]>([])
  const [approvalsLoading, setApprovalsLoading] = createSignal(false)
  const [approvalsError, setApprovalsError] = createSignal<string | undefined>(undefined)
  const [replyingById, setReplyingById] = createSignal<Record<string, PermissionReply | undefined>>({})

  const [agents, setAgents] = createSignal<readonly AgentInfo[]>([])
  const [agentsLoading, setAgentsLoading] = createSignal(false)
  const [agentsError, setAgentsError] = createSignal<string | undefined>(undefined)

  const [savedPermissions, setSavedPermissions] = createSignal<readonly PermissionSavedInfo[]>([])
  const [savedLoading, setSavedLoading] = createSignal(false)
  const [savedError, setSavedError] = createSignal<string | undefined>(undefined)
  const [savedExpanded, setSavedExpanded] = createSignal(false)
  const [revokingById, setRevokingById] = createSignal<Record<string, boolean>>({})

  const [refreshing, setRefreshing] = createSignal(false)
  const [clockTick, setClockTick] = createSignal(Date.now())

  let approvalsGen = 0
  let agentsGen = 0
  let savedGen = 0

  createEffect(() => {
    const timer = setInterval(() => setClockTick(Date.now()), 30_000)
    onCleanup(() => clearInterval(timer))
  })

  const formatTimestamp = (timestamp: number) => {
    clockTick()

    return relativeTime(timestamp)
  }

  const activeSession = createMemo(() => {
    const ctx = workbench.activeServerCtx()
    const id = workbench.activeSessionID()

    if (!ctx || !id) return undefined

    return ctx.data.session.get(id) ?? workbench.activeSession()
  })

  const rootSessionID = createMemo(() => {
    const ctx = workbench.activeServerCtx()
    const id = workbench.activeSessionID()

    if (!ctx || !id) return undefined

    const current = ctx.data.session.get(id)

    if (!current?.parentID) return id

    return ctx.data.session.root(id)
  })

  const rootSession = createMemo(() => {
    const ctx = workbench.activeServerCtx()
    const rootID = rootSessionID()

    if (!ctx || !rootID) return undefined

    return ctx.data.session.get(rootID)
  })

  const activeProjectID = createMemo(() => {
    const ctx = workbench.activeServerCtx()

    if (!ctx) return undefined

    const sessionProject = activeSession()?.projectID ?? rootSession()?.projectID

    if (sessionProject) return sessionProject

    const dir = workbench.activeDirectory()
    const project = dir ? ctx.projects.forDirectory(dir) : undefined

    if (project?.id) return project.id

    const loc = workbench.activeLocation()

    return loc ? ctx.data.location.info(loc)?.project.id : undefined
  })

  const currentAgentID = createMemo(
    () => workbench.activeAgent() ?? activeSession()?.agent ?? rootSession()?.agent,
  )

  const isSessionRunning = (sessionID: string | undefined) => {
    const ctx = workbench.activeServerCtx()

    if (!ctx || !sessionID) return false

    return ctx.data.session.status(sessionID) === "running"
  }

  const childSessions = createMemo<readonly SessionInfo[]>(() => {
    const ctx = workbench.activeServerCtx()
    const rootID = rootSessionID()

    if (!ctx || !rootID) return []

    const directChildren = ctx.data.session.list().filter((session) => session.parentID === rootID)
    const active = activeSession()
    const list =
      active && active.parentID && active.parentID !== rootID && !directChildren.some((item) => item.id === active.id)
        ? [active, ...directChildren]
        : directChildren

    return list.toSorted((a, b) => {
      const runningA = ctx.data.session.status(a.id) === "running" ? 1 : 0
      const runningB = ctx.data.session.status(b.id) === "running" ? 1 : 0

      if (runningA !== runningB) return runningB - runningA

      return (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)
    })
  })

  const activeSubagentCount = createMemo(
    () => childSessions().filter((child) => isSessionRunning(child.id)).length,
  )

  const recentTools = createMemo<readonly ToolActivityItem[]>(() => {
    const ctx = workbench.activeServerCtx()
    const sessionID = workbench.activeSessionID()

    if (!ctx || !sessionID) return []

    const messages = ctx.data.session.message.list(sessionID)
    const items: ToolActivityItem[] = []

    for (const message of messages) {
      if (message.type !== "assistant") continue

      for (const part of message.content) {
        if (part.type !== "tool") continue

        items.push({
          id: part.id,
          messageID: message.id,
          name: part.name,
          status: normalizeToolStatus(part.state.status),
          summary: summarizeToolCall(part, tr),
          created: part.time.created,
        })
      }
    }

    return items.reverse().slice(0, 12)
  })

  const visibleAgents = createMemo(() => agents().filter((agent) => !agent.hidden))

  const primaryAgents = createMemo(() =>
    visibleAgents()
      .filter((agent) => isPrimaryAgent(agent))
      .toSorted((a, b) => compareByOrder(a, b, PRIMARY_ORDER)),
  )

  const specialistAgents = createMemo(() =>
    visibleAgents()
      .filter((agent) => !isPrimaryAgent(agent))
      .toSorted((a, b) => compareByOrder(a, b, SPECIALIST_ORDER)),
  )

  const loadApprovals = async () => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()

    if (!ctx || !location) {
      setPendingApprovals([])
      setApprovalsLoading(false)
      setApprovalsError(undefined)

      return
    }

    const generation = ++approvalsGen
    setApprovalsLoading(true)
    setApprovalsError(undefined)

    const result = await ctx.sdk.api.permission.request
      .list({ location })
      .then((res) => ({ ok: true as const, data: res.data }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    if (generation !== approvalsGen) return

    batch(() => {
      setApprovalsLoading(false)

      if (!result.ok) {
        setApprovalsError(result.message)

        return
      }

      setPendingApprovals(result.data)
      setApprovalsError(undefined)
    })
  }

  const loadAgents = async () => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()

    if (!ctx || !location) {
      setAgents([])
      setAgentsLoading(false)
      setAgentsError(undefined)

      return
    }

    const generation = ++agentsGen
    setAgentsLoading(true)
    setAgentsError(undefined)

    const result = await ctx.sdk.api.agent
      .list({ location })
      .then((res) => ({ ok: true as const, data: res.data }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    if (generation !== agentsGen) return

    batch(() => {
      setAgentsLoading(false)

      if (!result.ok) {
        setAgentsError(result.message)

        return
      }

      setAgents(result.data)
      setAgentsError(undefined)
    })
  }

  const loadSavedPermissions = async () => {
    const ctx = workbench.activeServerCtx()
    const projectID = activeProjectID()

    if (!ctx) {
      setSavedPermissions([])
      setSavedLoading(false)
      setSavedError(undefined)

      return
    }

    const generation = ++savedGen
    setSavedLoading(true)
    setSavedError(undefined)

    const result = await ctx.sdk.api.permission.saved
      .list(projectID ? { projectID } : undefined)
      .then((data) => ({ ok: true as const, data }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    if (generation !== savedGen) return

    batch(() => {
      setSavedLoading(false)

      if (!result.ok) {
        setSavedError(result.message)

        return
      }

      const sorted = result.data.toSorted(
        (a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created),
      )
      setSavedPermissions(sorted)
      setSavedError(undefined)
    })
  }

  // Load approvals, agents, and ensure location project metadata on server/location change.
  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    const location = workbench.activeLocation()

    if (!ctx || !location) {
      approvalsGen += 1
      agentsGen += 1
      batch(() => {
        setPendingApprovals([])
        setApprovalsLoading(false)
        setApprovalsError(undefined)
        setAgents([])
        setAgentsLoading(false)
        setAgentsError(undefined)
      })

      return
    }

    if (!ctx.data.location.info(location)) {
      void ctx.data.location.syncInfo(location).catch(() => undefined)
    }

    void loadApprovals()
    void loadAgents()
  })

  // Load saved permissions whenever active server or resolved project changes.
  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    activeProjectID()

    if (!ctx) {
      savedGen += 1
      setSavedPermissions([])
      setSavedLoading(false)
      setSavedError(undefined)

      return
    }

    void loadSavedPermissions()
  })

  // Sync subagent family for active root session so child sessions are always visible.
  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    const rootID = rootSessionID()

    if (!ctx || !rootID) return

    void ctx.data.session.sync(rootID, { children: true }).catch(() => undefined)
  })

  // Ensure active session messages are loaded so recent tool activity stays populated.
  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    const sessionID = workbench.activeSessionID()

    if (!ctx || !sessionID) return

    void ctx.data.session.message.sync(sessionID).catch(() => undefined)
  })

  // Subscribe to live server events for approvals, agents, and newly spawned subagents.
  createEffect(() => {
    const ctx = workbench.activeServerCtx()

    if (!ctx) return

    const unsubAsked = ctx.data.on("permission.asked", () => {
      void loadApprovals()
    })
    const unsubReplied = ctx.data.on("permission.replied", () => {
      void loadApprovals()
      void loadSavedPermissions()
    })
    const unsubAgent = ctx.data.on("agent.updated", () => {
      void loadAgents()
    })
    const unsubCreated = ctx.data.on("session.created", () => {
      const rootID = rootSessionID()

      if (rootID) void ctx.data.session.sync(rootID, { children: true }).catch(() => undefined)
    })

    onCleanup(() => {
      unsubAsked()
      unsubReplied()
      unsubAgent()
      unsubCreated()
    })
  })

  const handleRefresh = async () => {
    const ctx = workbench.activeServerCtx()

    if (!ctx || refreshing()) return

    setRefreshing(true)

    const rootID = rootSessionID()
    const sessionID = workbench.activeSessionID()
    const tasks: Promise<unknown>[] = [loadApprovals(), loadAgents(), loadSavedPermissions()]

    if (rootID) {
      ctx.data.session.invalidate(rootID)
      tasks.push(ctx.data.session.sync(rootID, { children: true }).catch(() => undefined))
    }

    if (sessionID) {
      tasks.push(ctx.data.session.message.sync(sessionID).catch(() => undefined))
    }

    await Promise.all(tasks)
    setRefreshing(false)
  }

  const handleReplyPermission = async (request: PermissionRequest, decision: PermissionReply) => {
    const ctx = workbench.activeServerCtx()

    if (!ctx || replyingById()[request.id]) return

    setReplyingById((current) => ({ ...current, [request.id]: decision }))

    const result = await ctx.sdk.api.permission
      .reply({
        sessionID: request.sessionID,
        requestID: request.id,
        decision,
      })
      .then(() => ({ ok: true as const }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    setReplyingById((current) => {
      const next = { ...current }
      delete next[request.id]

      return next
    })

    if (!result.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to respond to approval", "Falha ao responder aprovação"),
        description: result.message,
      })

      return
    }

    setPendingApprovals((current) => current.filter((item) => item.id !== request.id))
    ctx.data.session.permission.invalidate(request.sessionID)
    void loadApprovals()

    if (decision === "always") {
      void loadSavedPermissions()
    }

    showToast({
      variant: decision === "reject" ? "default" : "success",
      title: decisionToastTitle(decision, tr),
      description: request.action,
    })
  }

  const handleRevokeSaved = async (entry: PermissionSavedInfo) => {
    const ctx = workbench.activeServerCtx()

    if (!ctx || revokingById()[entry.id]) return

    setRevokingById((current) => ({ ...current, [entry.id]: true }))

    const result = await ctx.sdk.api.permission.saved
      .remove({ id: entry.id })
      .then(() => ({ ok: true as const }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    setRevokingById((current) => {
      const next = { ...current }
      delete next[entry.id]

      return next
    })

    if (!result.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to revoke permission", "Falha ao revogar permissão"),
        description: result.message,
      })

      return
    }

    setSavedPermissions((current) => current.filter((item) => item.id !== entry.id))
    ctx.data.project.permission.invalidate(entry.projectID)
    showToast({
      variant: "default",
      title: tr("Permission revoked", "Permissão revogada"),
      description: `${entry.action} · ${entry.resource}`,
    })
  }

  const handleOpenSession = (session: SessionInfo) => {
    const conn = workbench.activeServer()
    const ctx = workbench.activeServerCtx()

    if (!conn || !ctx) return

    ctx.data.session.remember(session)
    void ctx.data.session.message.sync(session.id).catch(() => undefined)
    const tab = tabs.addSessionTab({
      server: ServerConnection.key(conn),
      sessionId: session.id,
    })
    tabs.select(tab)
  }

  const handleActivateAgent = async (agent: AgentInfo) => {
    if (workbench.bridge()) {
      workbench.setAgent(agent.id)
      showToast({
        variant: "default",
        title: tr("{{name}} activated (@{{id}})", "{{name}} ativado (@{{id}})", {
          name: agent.name || agent.id,
          id: agent.id,
        }),
      })

      return
    }

    const ctx = workbench.activeServerCtx()
    const sessionID = workbench.activeSessionID()

    if (!ctx || !sessionID) {
      workbench.setAgent(agent.id)
      showToast({
        variant: "default",
        title: tr("Open a session to activate @{{id}}", "Abra uma sessão para ativar @{{id}}", { id: agent.id }),
      })

      return
    }

    const result = await ctx.sdk.api.session
      .switchAgent({ sessionID, agent: agent.id })
      .then(() => ({ ok: true as const }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    if (!result.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to switch agent", "Falha ao trocar agente"),
        description: result.message,
      })

      return
    }

    showToast({
      variant: "default",
      title: tr("{{name}} activated (@{{id}})", "{{name}} ativado (@{{id}})", {
        name: agent.name || agent.id,
        id: agent.id,
      }),
    })
  }

  const handleMentionAgent = (agent: AgentInfo) => {
    workbench.insertComposerText(`@${agent.id} `)
  }

  const renderAgentCard = (agent: AgentInfo, variant: "primary" | "specialist") => {
    const isActive = () => currentAgentID() === agent.id
    const canActivate = agent.mode !== "subagent"
    const modelLabel = formatModelRef(agent.model)

    return (
      <div
        class="rounded-[7px] border px-2.5 py-2 transition-colors"
        classList={{
          "border-v2-background-bg-accent/60 bg-v2-background-bg-layer-01": isActive(),
          "border-v2-border-border-muted bg-v2-background-bg-layer-01/50 hover:border-v2-border-border-base":
            !isActive(),
        }}
      >
        <div class="flex items-start justify-between gap-1.5">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span
                class="inline-block size-2 shrink-0 rounded-full"
                classList={{
                  "bg-v2-background-bg-accent": isActive(),
                  "bg-v2-icon-icon-muted/50": !isActive(),
                }}
                style={agent.color && !isActive() ? { "background-color": agent.color } : undefined}
              />
              <span class="truncate text-[12px] font-semibold text-v2-text-text-base">
                {agent.name || agent.id}
              </span>
              <span class="shrink-0 font-mono text-[10.5px] text-v2-text-text-faint">@{agent.id}</span>
            </div>

            <Show when={agent.description}>
              {(desc) => (
                <p class="mt-0.5 line-clamp-2 text-[11px] leading-4 text-v2-text-text-muted">{desc()}</p>
              )}
            </Show>
          </div>

          <Show when={isActive()}>
            <span class="shrink-0 rounded-full bg-v2-background-bg-accent/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.04em] text-v2-text-text-accent">
              {tr("Active", "Ativo")}
            </span>
          </Show>
        </div>

        <div class="mt-2 flex flex-wrap items-center justify-between gap-1.5">
          <Show
            when={modelLabel}
            fallback={
              <span class="font-mono text-[10px] text-v2-text-text-faint">
                {agent.mode === "subagent" ? tr("Subagent", "Subagente") : tr("Session model", "Modelo da sessão")}
              </span>
            }
          >
            {(label) => (
              <span
                class="max-w-[140px] truncate rounded bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[10px] text-v2-text-text-muted"
                title={label()}
              >
                {label()}
              </span>
            )}
          </Show>

          <div class="flex shrink-0 items-center gap-1">
            <Show when={canActivate}>
              <button
                type="button"
                class="inline-flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11px] font-medium transition-colors"
                classList={{
                  "bg-v2-background-bg-accent text-v2-text-text-inverse": isActive(),
                  "border border-v2-border-border-base bg-v2-background-bg-base text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover":
                    !isActive(),
                }}
                onClick={() => void handleActivateAgent(agent)}
              >
                <Show when={isActive()}>
                  <Icon name="check" size="small" class="size-3" />
                </Show>
                <span>{isActive() ? tr("Active", "Ativo") : tr("Activate", "Ativar")}</span>
              </button>
            </Show>

            <Tooltip
              placement="top"
              value={tr("Insert @{{id}} in composer", "Inserir @{{id}} no composer", { id: agent.id })}
            >
              <button
                type="button"
                class="inline-flex h-6 items-center gap-1 rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-base px-1.5 text-[11px] font-medium text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                aria-label={tr("Mention @{{id}}", "Mencionar @{{id}}", { id: agent.id })}
                onClick={() => handleMentionAgent(agent)}
              >
                <MentionAtIcon />
                <Show when={variant === "specialist" || !canActivate}>
                  <span>{tr("Mention", "Mencionar")}</span>
                </Show>
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    )
  }

  return (
    <Show
      when={workbench.activeServerCtx()}
      fallback={
        <div class="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
          <div class="flex size-10 items-center justify-center rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
            <AgentsIcon size={18} />
          </div>
          <div class="text-[12.5px] font-medium text-v2-text-text-base">
            {tr("No server connected", "Nenhum servidor conectado")}
          </div>
          <p class="max-w-[215px] text-[11.5px] leading-4 text-v2-text-text-faint">
            {tr(
              "Connect a workspace to monitor agents, subagents, and approvals in real time.",
              "Conecte um workspace para acompanhar agentes, subagentes e aprovações em tempo real.",
            )}
          </p>
        </div>
      }
    >
      <div class="flex min-h-0 flex-1 flex-col bg-v2-background-bg-base text-v2-text-text-base">
        {/* Compact toolbar */}
        <div class="flex shrink-0 items-center justify-between gap-1.5 border-b border-v2-border-border-muted px-2.5 py-1.5">
          <div class="flex min-w-0 items-center gap-1.5">
            <Show
              when={isSessionRunning(workbench.activeSessionID())}
              fallback={<AgentsIcon size={14} class="shrink-0 text-v2-icon-icon-muted" />}
            >
              <span class="onethy-pulse-dot inline-block size-2 shrink-0 rounded-full bg-v2-background-bg-accent" />
            </Show>
            <span class="truncate text-[11.5px] font-semibold text-v2-text-text-base">
              {currentAgentID() ? `@${currentAgentID()}` : tr("Orchestration", "Orquestração")}
            </span>
            <Show when={pendingApprovals().length > 0}>
              <span
                class="shrink-0 rounded-full bg-v2-state-fg-warning px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-v2-text-text-inverse"
                title={
                  pendingApprovals().length === 1
                    ? tr("1 pending approval", "1 aprovação pendente")
                    : tr("{{count}} pending approvals", "{{count}} aprovações pendentes", {
                        count: pendingApprovals().length,
                      })
                }
              >
                {pendingApprovals().length}
              </span>
            </Show>
          </div>

          <Tooltip placement="bottom" value={tr("Refresh agents and permissions", "Atualizar agentes e permissões")}>
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
              aria-label={tr("Refresh agents panel", "Atualizar painel de agentes")}
              disabled={refreshing()}
              onClick={() => void handleRefresh()}
            >
              <Show when={refreshing()} fallback={<Icon name="refresh" size="small" class="size-3.5" />}>
                <Loader width={13} height={13} />
              </Show>
            </button>
          </Tooltip>
        </div>

        {/* Scrollable panel body */}
        <div data-slot="workbench-scroll" class="min-h-0 flex-1 overflow-y-auto">
          {/* Section 1: Pending Approvals */}
          <section
            aria-label={tr("Pending Approvals", "Aprovações Pendentes")}
            class="border-b border-v2-border-border-muted px-2.5 py-2.5"
            classList={{
              "bg-v2-state-bg-warning/40": pendingApprovals().length > 0,
            }}
          >
            <div class="mb-2 flex items-center justify-between gap-1.5">
              <div class="flex min-w-0 items-center gap-1.5">
                <Show
                  when={pendingApprovals().length > 0}
                  fallback={<CheckShieldIcon size={13} class="shrink-0 text-v2-state-fg-success" />}
                >
                  <Icon
                    name="outline-hexagonal-warning"
                    size="small"
                    class="size-3.5 shrink-0 text-v2-state-fg-warning"
                  />
                </Show>
                <span
                  class="truncate text-[10.5px] font-semibold uppercase tracking-[0.06em]"
                  classList={{
                    "text-v2-state-fg-warning": pendingApprovals().length > 0,
                    "text-v2-text-text-muted": pendingApprovals().length === 0,
                  }}
                >
                  {tr("Pending Approvals", "Aprovações Pendentes")}
                </span>
              </div>

              <Show when={approvalsLoading() && pendingApprovals().length === 0}>
                <Loader width={11} height={11} class="shrink-0 text-v2-icon-icon-muted" />
              </Show>

              <Show when={pendingApprovals().length > 0}>
                <span class="shrink-0 rounded-full bg-v2-state-fg-warning px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-v2-text-text-inverse">
                  {pendingApprovals().length}
                </span>
              </Show>
            </div>

            <Show when={approvalsError()}>
              {(message) => (
                <div class="mb-2 rounded-[6px] border border-v2-state-border-danger bg-v2-state-bg-danger px-2 py-1.5 text-[11px] text-v2-state-fg-danger">
                  {message()}
                </div>
              )}
            </Show>

            <Show
              when={pendingApprovals().length > 0}
              fallback={
                <Show when={!approvalsLoading() && !approvalsError()}>
                  <div class="flex items-center gap-1.5 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01/40 px-2 py-1.5 text-[11.5px] text-v2-text-text-faint">
                    <span>{tr("No approvals waiting for a decision.", "Nenhuma aprovação aguardando decisão.")}</span>
                  </div>
                </Show>
              }
            >
              <div class="flex flex-col gap-2">
                <For each={pendingApprovals()}>
                  {(request) => {
                    const busyDecision = () => replyingById()[request.id]
                    const ownerSession = () => workbench.activeServerCtx()?.data.session.get(request.sessionID)

                    return (
                      <div class="rounded-[7px] border border-v2-state-border-warning bg-v2-background-bg-base p-2">
                        <div class="flex items-center justify-between gap-1.5">
                          <span class="truncate rounded bg-v2-state-bg-warning px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-v2-state-fg-warning">
                            {request.action}
                          </span>

                          <Show when={ownerSession()}>
                            {(session) => (
                              <button
                                type="button"
                                class="max-w-[130px] truncate text-[10.5px] text-v2-text-text-faint hover:text-v2-text-text-accent hover:underline"
                                title={tr("Open requesting session", "Abrir sessão solicitante")}
                                onClick={() => handleOpenSession(session())}
                              >
                                {formatSessionName(session(), tr)}
                              </button>
                            )}
                          </Show>
                        </div>

                        <Show when={request.message}>
                          {(msg) => (
                            <p class="mt-1.5 text-[11.5px] leading-4 text-v2-text-text-base">{msg()}</p>
                          )}
                        </Show>

                        <Show when={request.resources.length > 0}>
                          <div class="mt-1.5 flex flex-col gap-1">
                            <For each={request.resources}>
                              {(resource) => (
                                <code class="block rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-deep px-1.5 py-1 font-mono text-[10.5px] leading-4 break-all text-v2-text-text-base">
                                  {resource}
                                </code>
                              )}
                            </For>
                          </div>
                        </Show>

                        <div class="mt-2 grid grid-cols-3 gap-1">
                          <button
                            type="button"
                            disabled={Boolean(busyDecision())}
                            class="inline-flex h-6 items-center justify-center gap-1 rounded-[5px] bg-v2-background-bg-accent px-1.5 text-[11px] font-medium text-v2-text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-50"
                            onClick={() => void handleReplyPermission(request, "once")}
                          >
                            <Show when={busyDecision() === "once"}>
                              <Loader width={11} height={11} />
                            </Show>
                            <span>{tr("Once", "Uma vez")}</span>
                          </button>

                          <button
                            type="button"
                            disabled={Boolean(busyDecision())}
                            class="inline-flex h-6 items-center justify-center gap-1 rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-1.5 text-[11px] font-medium text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-50"
                            onClick={() => void handleReplyPermission(request, "always")}
                          >
                            <Show when={busyDecision() === "always"}>
                              <Loader width={11} height={11} />
                            </Show>
                            <span>{tr("Always", "Sempre")}</span>
                          </button>

                          <button
                            type="button"
                            disabled={Boolean(busyDecision())}
                            class="inline-flex h-6 items-center justify-center gap-1 rounded-[5px] border border-v2-state-border-danger bg-v2-state-bg-danger px-1.5 text-[11px] font-medium text-v2-state-fg-danger transition-opacity hover:opacity-90 disabled:opacity-50"
                            onClick={() => void handleReplyPermission(request, "reject")}
                          >
                            <Show when={busyDecision() === "reject"}>
                              <Loader width={11} height={11} />
                            </Show>
                            <span>{tr("Reject", "Rejeitar")}</span>
                          </button>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>
          </section>

          {/* Section 2: Primary Agent & Active Subagents + Recent Tool Activity */}
          <section
            aria-label={tr("Primary Agent and Active Subagents", "Agente Principal e Subagentes Ativos")}
            class="border-b border-v2-border-border-muted px-2.5 py-2.5"
          >
            <div class="mb-2 flex items-center justify-between gap-1.5">
              <div class="flex min-w-0 items-center gap-1.5">
                <AgentsIcon size={13} class="shrink-0 text-v2-icon-icon-muted" />
                <span class="truncate text-[10.5px] font-semibold uppercase tracking-[0.06em] text-v2-text-text-muted">
                  {tr("Primary Agent & Subagents", "Agente Principal & Subagentes")}
                </span>
              </div>
              <Show when={childSessions().length > 0}>
                <span class="shrink-0 rounded-full bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-v2-text-text-muted">
                  {childSessions().length}
                </span>
              </Show>
            </div>

            <Show
              when={rootSession() || activeSession() || workbench.activeSessionID()}
              fallback={
                <div class="rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01/40 px-2.5 py-2 text-[11.5px] text-v2-text-text-faint">
                  {tr(
                    "No active session. Open or create a session to monitor agents and tools.",
                    "Nenhuma sessão ativa. Abra ou crie uma sessão para monitorar agentes e ferramentas.",
                  )}
                </div>
              }
            >
              {/* Principal agent card */}
              <div
                role={rootSession() ? "button" : undefined}
                tabIndex={rootSession() ? 0 : undefined}
                class="rounded-[7px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2.5 py-2 transition-colors"
                classList={{
                  "cursor-pointer hover:bg-v2-overlay-simple-overlay-hover": Boolean(rootSession()),
                  "border-v2-background-bg-accent/60": rootSessionID() === workbench.activeSessionID(),
                }}
                onClick={() => {
                  const root = rootSession()

                  if (root) handleOpenSession(root)
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return
                  const root = rootSession()

                  if (!root) return
                  e.preventDefault()
                  handleOpenSession(root)
                }}
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex min-w-0 items-center gap-1.5">
                    <Show
                      when={isSessionRunning(rootSessionID())}
                      fallback={
                        <span
                          class="inline-block size-2 shrink-0 rounded-full"
                          classList={{
                            "bg-v2-state-fg-danger": rootSession()?.outcome === "failed",
                            "bg-v2-state-fg-warning": rootSession()?.outcome === "interrupted",
                            "bg-v2-state-fg-success":
                              rootSession()?.outcome !== "failed" && rootSession()?.outcome !== "interrupted",
                          }}
                        />
                      }
                    >
                      <span class="onethy-pulse-dot inline-block size-2 shrink-0 rounded-full bg-v2-background-bg-accent" />
                    </Show>
                    <span class="truncate text-[12px] font-semibold text-v2-text-text-base">
                      {rootSession() ? formatSessionName(rootSession()!, tr) : tr("Current Session", "Sessão Atual")}
                    </span>
                  </div>

                  <span
                    class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none"
                    classList={{
                      "bg-v2-background-bg-accent/15 text-v2-text-text-accent": isSessionRunning(rootSessionID()),
                      "bg-v2-background-bg-layer-02 text-v2-text-text-muted": !isSessionRunning(rootSessionID()),
                    }}
                  >
                    {sessionStateLabel(rootSession(), isSessionRunning(rootSessionID()), tr)}
                  </span>
                </div>

                <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-v2-text-text-muted">
                  <span class="rounded bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[10px] text-v2-text-text-base">
                    @{rootSession()?.agent ?? workbench.activeAgent() ?? "omni"}
                  </span>
                  <Show when={workbench.activeModel()?.name || workbench.activeModel()?.modelID || rootSession()?.model?.id}>
                    <span class="min-w-0 truncate font-mono text-[10px] text-v2-text-text-faint">
                      {workbench.activeModel()?.name ?? workbench.activeModel()?.modelID ?? rootSession()?.model?.id}
                    </span>
                  </Show>
                </div>
              </div>

              {/* Subagents list */}
              <div class="mt-2">
                <div class="mb-1 flex items-center justify-between text-[10.5px] font-medium text-v2-text-text-faint">
                  <span>{tr("Session Subagents", "Subagentes da Sessão")}</span>
                  <span>
                    {activeSubagentCount() === 1
                      ? tr("1 active", "1 ativo")
                      : tr("{{count}} active", "{{count}} ativos", { count: activeSubagentCount() })}
                  </span>
                </div>

                <Show
                  when={childSessions().length > 0}
                  fallback={
                    <div class="rounded-[6px] border border-dashed border-v2-border-border-muted px-2 py-1.5 text-[11px] text-v2-text-text-faint">
                      {tr("No subagent delegated in this session.", "Nenhum subagente delegado nesta sessão.")}
                    </div>
                  }
                >
                  <div class="flex flex-col gap-1">
                    <For each={childSessions()}>
                      {(child) => {
                        const running = () => isSessionRunning(child.id)
                        const selected = () => workbench.activeSessionID() === child.id

                        return (
                          <button
                            type="button"
                            class="group flex w-full items-center gap-2 rounded-[6px] border px-2 py-1.5 text-start transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                            classList={{
                              "border-v2-background-bg-accent/60 bg-v2-overlay-simple-overlay-pressed": selected(),
                              "border-v2-border-border-muted bg-v2-background-bg-layer-01/40": !selected(),
                            }}
                            onClick={() => handleOpenSession(child)}
                          >
                            <Show
                              when={running()}
                              fallback={
                                <span
                                  class="inline-block size-1.5 shrink-0 rounded-full"
                                  classList={{
                                    "bg-v2-state-fg-danger": child.outcome === "failed",
                                    "bg-v2-state-fg-warning": child.outcome === "interrupted",
                                    "bg-v2-icon-icon-muted":
                                      child.outcome !== "failed" && child.outcome !== "interrupted",
                                  }}
                                />
                              }
                            >
                              <span class="onethy-pulse-dot inline-block size-2 shrink-0 rounded-full bg-v2-background-bg-accent" />
                            </Show>

                            <div class="min-w-0 flex-1">
                              <div class="truncate text-[11.5px] font-medium text-v2-text-text-base">
                                {formatSessionName(child, tr)}
                              </div>
                              <div class="flex items-center gap-1.5 text-[10px] text-v2-text-text-faint">
                                <Show when={child.agent}>
                                  <span class="font-mono text-v2-text-text-muted">@{child.agent}</span>
                                </Show>
                                <span>{formatTimestamp(child.time.updated ?? child.time.created)}</span>
                              </div>
                            </div>

                            <span
                              class="shrink-0 text-[10px] font-medium"
                              classList={{
                                "text-v2-text-text-accent": running(),
                                "text-v2-state-fg-danger": !running() && child.outcome === "failed",
                                "text-v2-text-text-faint": !running() && child.outcome !== "failed",
                              }}
                            >
                              {running()
                                ? tr("Active", "Ativo")
                                : child.outcome === "failed"
                                  ? tr("Error", "Erro")
                                  : tr("Open", "Abrir")}
                            </span>
                          </button>
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </div>

              {/* Recent Tool Activity */}
              <div class="mt-3">
                <div class="mb-1.5 flex items-center justify-between gap-1.5">
                  <div class="flex items-center gap-1.5">
                    <ToolActivityIcon />
                    <span class="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-v2-text-text-muted">
                      {tr("Recent Tool Activity", "Atividade Recente de Ferramentas")}
                    </span>
                  </div>
                  <Show when={recentTools().length > 0}>
                    <span class="font-mono text-[10px] text-v2-text-text-faint">{recentTools().length}</span>
                  </Show>
                </div>

                <Show
                  when={recentTools().length > 0}
                  fallback={
                    <div class="rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01/40 px-2 py-1.5 text-[11px] text-v2-text-text-faint">
                      {tr(
                        "No tool calls recorded in this session.",
                        "Nenhuma chamada de ferramenta registrada nesta sessão.",
                      )}
                    </div>
                  }
                >
                  <div class="flex flex-col gap-1">
                    <For each={recentTools()}>
                      {(tool) => (
                        <div class="flex items-start gap-2 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01/40 px-2 py-1.5">
                          <div class="mt-0.5 flex size-3.5 shrink-0 items-center justify-center">
                            <Show when={tool.status === "running"}>
                              <Loader width={11} height={11} class="text-v2-text-text-accent" />
                            </Show>
                            <Show when={tool.status === "completed"}>
                              <Icon name="check" size="small" class="size-3 text-v2-state-fg-success" />
                            </Show>
                            <Show when={tool.status === "error"}>
                              <Icon name="circle-xmark" size="small" class="size-3 text-v2-state-fg-danger" />
                            </Show>
                          </div>

                          <div class="min-w-0 flex-1">
                            <div class="flex items-center justify-between gap-1.5">
                              <span class="truncate font-mono text-[11px] font-semibold text-v2-text-text-base">
                                {tool.name}
                              </span>
                              <span
                                class="shrink-0 text-[9.5px] font-medium"
                                classList={{
                                  "text-v2-text-text-accent": tool.status === "running",
                                  "text-v2-state-fg-success": tool.status === "completed",
                                  "text-v2-state-fg-danger": tool.status === "error",
                                }}
                              >
                                {toolStatusLabel(tool.status, tr)}
                              </span>
                            </div>

                            <Show when={tool.summary}>
                              <p
                                class="mt-0.5 truncate font-mono text-[10.5px] leading-3.5"
                                classList={{
                                  "text-v2-state-fg-danger": tool.status === "error",
                                  "text-v2-text-text-faint": tool.status !== "error",
                                }}
                                title={tool.summary}
                              >
                                {tool.summary}
                              </p>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          </section>

          {/* Section 3: Specialists & Modes */}
          <section
            aria-label={tr("Specialists and Modes", "Especialistas e Modos")}
            class="border-b border-v2-border-border-muted px-2.5 py-2.5"
          >
            <div class="mb-2 flex items-center justify-between gap-1.5">
              <span class="truncate text-[10.5px] font-semibold uppercase tracking-[0.06em] text-v2-text-text-muted">
                {tr("Specialists & Modes", "Especialistas & Modos")}
              </span>
              <Show
                when={agentsLoading() && visibleAgents().length === 0}
                fallback={
                  <span class="font-mono text-[10px] text-v2-text-text-faint">{visibleAgents().length}</span>
                }
              >
                <Loader width={11} height={11} class="shrink-0 text-v2-icon-icon-muted" />
              </Show>
            </div>

            <Show when={agentsError()}>
              {(message) => (
                <div class="mb-2 rounded-[6px] border border-v2-state-border-danger bg-v2-state-bg-danger px-2 py-1.5 text-[11px] text-v2-state-fg-danger">
                  {message()}
                </div>
              )}
            </Show>

            <Show
              when={visibleAgents().length > 0}
              fallback={
                <Show when={!agentsLoading() && !agentsError()}>
                  <div class="rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01/40 px-2.5 py-2 text-[11.5px] text-v2-text-text-faint">
                    {tr("No agents available in this workspace.", "Nenhum agente disponível neste workspace.")}
                  </div>
                </Show>
              }
            >
              <Show when={primaryAgents().length > 0}>
                <div class="mb-1.5 text-[10.5px] font-medium text-v2-text-text-faint">
                  {tr("Primary Modes", "Modos Principais")}
                </div>
                <div class="flex flex-col gap-1.5">
                  <For each={primaryAgents()}>{(agent) => renderAgentCard(agent, "primary")}</For>
                </div>
              </Show>

              <Show when={specialistAgents().length > 0}>
                <div class="mb-1.5 mt-3 text-[10.5px] font-medium text-v2-text-text-faint">
                  {tr("Specialists & Subagents", "Especialistas & Subagentes")}
                </div>
                <div class="flex flex-col gap-1.5">
                  <For each={specialistAgents()}>{(agent) => renderAgentCard(agent, "specialist")}</For>
                </div>
              </Show>
            </Show>
          </section>

          {/* Section 4: Saved Permissions (collapsible) */}
          <section aria-label={tr("Saved Permissions", "Permissões Salvas")} class="px-2.5 py-2">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-1.5 rounded-[5px] py-1 text-start hover:bg-v2-overlay-simple-overlay-hover"
              aria-expanded={savedExpanded()}
              onClick={() => setSavedExpanded((open) => !open)}
            >
              <div class="flex min-w-0 items-center gap-1.5">
                <Icon
                  name="outline-chevron-right"
                  size="small"
                  class="size-3.5 shrink-0 text-v2-icon-icon-muted transition-transform duration-150"
                  classList={{ "rotate-90": savedExpanded() }}
                />
                <CheckShieldIcon size={13} class="shrink-0 text-v2-icon-icon-muted" />
                <span class="truncate text-[10.5px] font-semibold uppercase tracking-[0.06em] text-v2-text-text-muted">
                  {tr("Saved Permissions", "Permissões Salvas")}
                </span>
              </div>

              <div class="flex shrink-0 items-center gap-1.5 pe-1">
                <Show when={savedLoading()}>
                  <Loader width={11} height={11} class="text-v2-icon-icon-muted" />
                </Show>
                <span class="rounded-full bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-v2-text-text-muted">
                  {savedPermissions().length}
                </span>
              </div>
            </button>

            <Show when={savedExpanded()}>
              <div class="mt-2">
                <Show when={savedError()}>
                  {(message) => (
                    <div class="mb-2 rounded-[6px] border border-v2-state-border-danger bg-v2-state-bg-danger px-2 py-1.5 text-[11px] text-v2-state-fg-danger">
                      {message()}
                    </div>
                  )}
                </Show>

                <Show
                  when={savedPermissions().length > 0}
                  fallback={
                    <Show when={!savedLoading() && !savedError()}>
                      <div class="rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01/40 px-2.5 py-2 text-[11px] text-v2-text-text-faint">
                        {tr(
                          "No permanent permissions saved for this project.",
                          "Nenhuma permissão permanente salva para este projeto.",
                        )}
                      </div>
                    </Show>
                  }
                >
                  <div class="flex flex-col gap-1.5 pb-2">
                    <For each={savedPermissions()}>
                      {(entry) => {
                        const revoking = () => Boolean(revokingById()[entry.id])

                        return (
                          <div class="flex items-start justify-between gap-2 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01/50 px-2 py-1.5">
                            <div class="min-w-0 flex-1">
                              <div class="flex items-center gap-1.5">
                                <span class="shrink-0 rounded bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-v2-text-text-base">
                                  {entry.action}
                                </span>
                                <span class="truncate text-[10px] text-v2-text-text-faint">
                                  {formatTimestamp(entry.time.updated ?? entry.time.created)}
                                </span>
                              </div>
                              <code class="mt-1 block break-all font-mono text-[10.5px] leading-4 text-v2-text-text-muted">
                                {entry.resource}
                              </code>
                            </div>

                            <Tooltip placement="left" value={tr("Revoke saved permission", "Revogar permissão salva")}>
                              <button
                                type="button"
                                disabled={revoking()}
                                class="inline-flex h-6 shrink-0 items-center gap-1 rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-base px-1.5 text-[10.5px] font-medium text-v2-text-text-muted transition-colors hover:border-v2-state-border-danger hover:bg-v2-state-bg-danger hover:text-v2-state-fg-danger disabled:opacity-50"
                                aria-label={tr(
                                  "Revoke permission {{action}} for {{resource}}",
                                  "Revogar permissão {{action}} para {{resource}}",
                                  { action: entry.action, resource: entry.resource },
                                )}
                                onClick={() => void handleRevokeSaved(entry)}
                              >
                                <Show
                                  when={revoking()}
                                  fallback={<Icon name="trash" size="small" class="size-3" />}
                                >
                                  <Loader width={11} height={11} />
                                </Show>
                                <span>{tr("Revoke", "Revogar")}</span>
                              </button>
                            </Tooltip>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          </section>
        </div>
      </div>
    </Show>
  )
}

function isPrimaryAgent(agent: AgentInfo) {
  if (agent.mode === "primary") return true
  if (PRIMARY_AGENT_IDS.has(agent.id)) return true
  if (agent.mode === "subagent" || SPECIALIST_AGENT_IDS.has(agent.id)) return false

  return false
}

function compareByOrder(a: AgentInfo, b: AgentInfo, order: Record<string, number>) {
  const rankA = order[a.id] ?? Number.MAX_SAFE_INTEGER
  const rankB = order[b.id] ?? Number.MAX_SAFE_INTEGER

  if (rankA !== rankB) return rankA - rankB

  return (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: "base" })
}

function formatModelRef(model: AgentInfo["model"]) {
  if (!model) return ""
  const base = model.providerID ? `${model.providerID}/${model.id}` : model.id

  return model.variant ? `${base} (${model.variant})` : base
}

function formatSessionName(session: Pick<SessionInfo, "title" | "parentID">, tr: TranslateFn) {
  const cleaned = sessionTitle(session.title)

  if (!cleaned || cleaned === "New session") return session.parentID ? tr("Subagent", "Subagente") : tr("New session", "Nova sessão")
  if (cleaned === "Child session") return tr("Subagent", "Subagente")

  return cleaned
}

function sessionStateLabel(session: SessionInfo | undefined, running: boolean, tr: TranslateFn) {
  if (running) return tr("Running", "Executando")
  if (session?.outcome === "failed") return tr("Failed", "Falhou")
  if (session?.outcome === "interrupted") return tr("Interrupted", "Interrompido")

  return tr("Idle", "Ocioso")
}

function normalizeToolStatus(status: SessionMessageAssistantTool["state"]["status"]): ToolActivityItem["status"] {
  if (status === "completed") return "completed"
  if (status === "error") return "error"

  return "running"
}

function toolStatusLabel(status: ToolActivityItem["status"], tr: TranslateFn) {
  if (status === "running") return tr("Running", "Executando")
  if (status === "completed") return tr("Completed", "Concluído")

  return tr("Error", "Erro")
}

function summarizeToolCall(tool: SessionMessageAssistantTool, tr: TranslateFn): string {
  const state = tool.state

  if (state.status === "error") {
    return truncateSingleLine(state.error.message || tr("Execution failed", "Falha na execução"), 96)
  }

  if (state.status === "streaming") {
    return state.input.trim()
      ? truncateSingleLine(state.input, 96)
      : tr("Preparing arguments...", "Preparando argumentos...")
  }

  const fromInput = extractJsonSummary(state.input)

  if (fromInput) return fromInput

  const fromMetadata = state.metadata ? extractJsonSummary(state.metadata) : ""

  if (fromMetadata) return fromMetadata

  return ""
}

function extractJsonSummary(record: Record<string, JsonValue>): string {
  for (const key of TOOL_SUMMARY_KEYS) {
    const value = record[key]

    if (typeof value === "string" && value.trim().length > 0) {
      return truncateSingleLine(value, 96)
    }
  }

  for (const value of Object.values(record)) {
    if (typeof value === "string" && value.trim().length > 0) {
      return truncateSingleLine(value, 96)
    }
  }

  return ""
}

function truncateSingleLine(raw: string, maxLength: number) {
  const single = raw.replace(/\s+/g, " ").trim()

  if (single.length <= maxLength) return single

  return `${single.slice(0, maxLength - 1)}…`
}

function decisionToastTitle(decision: PermissionReply, tr: TranslateFn) {
  if (decision === "always") return tr("Permission saved permanently", "Permissão salva para sempre")
  if (decision === "reject") return tr("Permission rejected", "Permissão rejeitada")

  return tr("Permission approved once", "Permissão aprovada uma vez")
}

function MentionAtIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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

function ToolActivityIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class="shrink-0 text-v2-icon-icon-muted"
      aria-hidden="true"
    >
      <path
        d="M2.25 8h2.5l1.6-4.25L9.4 12.25l1.7-4.25h2.65"
        stroke="currentColor"
        stroke-width="1.35"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
