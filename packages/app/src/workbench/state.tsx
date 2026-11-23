import { batch, createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode/ui/context"
import type { SessionInfo } from "@opencode/client/promise"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { useOnethyI18n } from "@/runtime/i18n/onethy"

export type ActivityView =
  | "explorer"
  | "search"
  | "git"
  | "agents"
  | "sessions"
  | "mcp"
  | "skills"
  | "extensions"
  | "models"

export type LayoutMode = "chat" | "split" | "editor"

export type BottomTab = "terminal" | "output" | "problems" | "logs" | "debug"

export type DiagnosticProblem = {
  id: string
  severity: "error" | "warning" | "info"
  source: string
  message: string
  file?: string
  line?: number
  column?: number
  actionLabel?: string
  onAction?: () => void
}

export type SessionWorkbenchBridge = {
  sessionID: () => string | undefined
  directory: () => string | undefined
  openFile: (path: string, opts?: { line?: number; endLine?: number; edit?: boolean }) => void
  openDiff: (file?: string) => void
  openTerminal: () => void
  insertText: (text: string) => void
  setAgent: (agentId: string) => void
  activeAgent: () => string | undefined
  activeModel: () => { providerID: string; modelID: string; name?: string } | undefined
  contextPercent: () => number | undefined
  setSideOpen: (open: boolean) => void
  sideOpen: () => boolean
}

export type PersistedWorkbenchState = {
  activity: ActivityView
  sidebarOpen: boolean
  sidebarWidth: number
  layoutMode: LayoutMode
  bottomOpen: boolean
  bottomTab: BottomTab
  bottomHeight: number
}

const STORAGE_KEY = "onethy.workbench.v1"

const VALID_ACTIVITIES: ReadonlySet<string> = new Set([
  "explorer",
  "search",
  "git",
  "agents",
  "sessions",
  "mcp",
  "skills",
  "extensions",
  "models",
])

const VALID_LAYOUTS: ReadonlySet<string> = new Set(["chat", "split", "editor"])

const VALID_BOTTOM_TABS: ReadonlySet<string> = new Set(["terminal", "output", "problems", "logs", "debug"])

export const DEFAULT_WORKBENCH_STATE: PersistedWorkbenchState = {
  activity: "explorer",
  sidebarOpen: true,
  sidebarWidth: 276,
  layoutMode: "split",
  bottomOpen: false,
  bottomTab: "terminal",
  bottomHeight: 240,
}

export function clampSidebarWidth(width: number) {
  return Math.max(210, Math.min(480, Math.round(width)))
}

export function clampBottomHeight(height: number) {
  const max = typeof window === "undefined" ? 560 : Math.max(260, Math.round(window.innerHeight * 0.65))
  return Math.max(140, Math.min(max, Math.round(height)))
}

export function parseWorkbenchState(raw: string | null | undefined): PersistedWorkbenchState {
  if (!raw) return { ...DEFAULT_WORKBENCH_STATE }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_WORKBENCH_STATE }
  }

  if (!parsed || typeof parsed !== "object") return { ...DEFAULT_WORKBENCH_STATE }
  const data = parsed as Record<string, unknown>

  return {
    activity:
      typeof data.activity === "string" && VALID_ACTIVITIES.has(data.activity)
        ? (data.activity as ActivityView)
        : DEFAULT_WORKBENCH_STATE.activity,
    sidebarOpen: typeof data.sidebarOpen === "boolean" ? data.sidebarOpen : DEFAULT_WORKBENCH_STATE.sidebarOpen,
    sidebarWidth:
      typeof data.sidebarWidth === "number" && Number.isFinite(data.sidebarWidth)
        ? clampSidebarWidth(data.sidebarWidth)
        : DEFAULT_WORKBENCH_STATE.sidebarWidth,
    layoutMode:
      typeof data.layoutMode === "string" && VALID_LAYOUTS.has(data.layoutMode)
        ? (data.layoutMode as LayoutMode)
        : DEFAULT_WORKBENCH_STATE.layoutMode,
    bottomOpen: typeof data.bottomOpen === "boolean" ? data.bottomOpen : DEFAULT_WORKBENCH_STATE.bottomOpen,
    bottomTab:
      typeof data.bottomTab === "string" && VALID_BOTTOM_TABS.has(data.bottomTab)
        ? (data.bottomTab as BottomTab)
        : DEFAULT_WORKBENCH_STATE.bottomTab,
    bottomHeight:
      typeof data.bottomHeight === "number" && Number.isFinite(data.bottomHeight)
        ? clampBottomHeight(data.bottomHeight)
        : DEFAULT_WORKBENCH_STATE.bottomHeight,
  }
}

function readStoredWorkbench(): PersistedWorkbenchState {
  if (typeof localStorage !== "object") return { ...DEFAULT_WORKBENCH_STATE }
  try {
    return parseWorkbenchState(localStorage.getItem(STORAGE_KEY))
  } catch {
    return { ...DEFAULT_WORKBENCH_STATE }
  }
}

function writeStoredWorkbench(state: PersistedWorkbenchState) {
  if (typeof localStorage !== "object") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore quota/private-mode storage errors.
  }
}

export type ShellRunResult = {
  id?: string
  output: string
  exit?: number
  status?: "running" | "exited" | "timeout" | "killed"
  error?: string
}

export type EditorOpenRequest = {
  path: string
  line?: number
  endLine?: number
  edit?: boolean
  nonce: number
}

export const { use: useWorkbench, provider: WorkbenchProvider } = createSimpleContext({
  name: "Workbench",
  init: () => {
    const global = useGlobal()
    const servers = useServers()
    const layout = useLayout()
    const tabs = useTabs()
    const { tr } = useOnethyI18n()

    const initial = readStoredWorkbench()
    const [state, setState] = createStore<PersistedWorkbenchState>(initial)
    const [bridge, setBridge] = createSignal<SessionWorkbenchBridge | undefined>(undefined)
    const [customProblems, setCustomProblems] = createSignal<readonly DiagnosticProblem[]>([])
    const [pendingEditorRequest, setPendingEditorRequest] = createSignal<EditorOpenRequest | undefined>(undefined)
    const [gitRevision, setGitRevision] = createSignal(0)
    const [shellRevision, setShellRevision] = createSignal(0)

    const persist = () => {
      writeStoredWorkbench({
        activity: state.activity,
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        layoutMode: state.layoutMode,
        bottomOpen: state.bottomOpen,
        bottomTab: state.bottomTab,
        bottomHeight: state.bottomHeight,
      })
    }

    const activeServer: Accessor<ServerConnection.Any | undefined> = createMemo(() => {
      const route = layout.route()
      const all = servers.list

      if (route.type === "session") {
        const match = all.find((item) => ServerConnection.key(item) === route.server)
        if (match) return match
      }

      if (route.type === "draft") {
        const draftTab = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
        if (draftTab && draftTab.type === "draft") {
          const match = all.find((item) => ServerConnection.key(item) === draftTab.server)
          if (match) return match
        }
      }

      const homeSel = layout.home.selection()
      if (homeSel.server) {
        const match = all.find((item) => ServerConnection.key(item) === homeSel.server)
        if (match) return match
      }

      return servers.visible.find((item) => servers.current(item)) ?? servers.visible[0] ?? all[0]
    })

    const activeServerCtx = createMemo(() => {
      const conn = activeServer()
      if (!conn) return undefined
      return global.ensureServerCtx(conn)
    })

    const activeSession: Accessor<SessionInfo | undefined> = createMemo(() => {
      const route = layout.route()
      if (route.type !== "session") return undefined
      return activeServerCtx()?.data.session.get(route.sessionId)
    })

    const activeSessionID = createMemo(() => {
      const route = layout.route()
      if (route.type === "session") return route.sessionId
      return bridge()?.sessionID()
    })

    const activeDirectory = createMemo(() => {
      const route = layout.route()
      const ctx = activeServerCtx()

      if (route.type === "session") {
        const info = ctx?.data.session.get(route.sessionId)
        if (info?.location.directory) return info.location.directory
      }

      if (route.type === "draft") {
        const draftTab = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
        if (draftTab && draftTab.type === "draft" && draftTab.directory) return draftTab.directory
      }

      const bridged = bridge()?.directory()
      if (bridged) return bridged

      const homeSel = layout.home.selection()
      if (homeSel.directory) return homeSel.directory

      const lastProject = ctx?.projects.last() ?? ctx?.projects.list()[0]
      if (lastProject?.worktree) return lastProject.worktree

      return ctx?.data.location.default().directory
    })

    const activeLocation = createMemo(() => {
      const dir = activeDirectory()
      return dir ? { directory: dir } : undefined
    })

    const systemProblems = createMemo<readonly DiagnosticProblem[]>(() => {
      const ctx = activeServerCtx()
      if (!ctx) return []
      const loc = activeLocation() ?? ctx.data.location.default()
      const items: DiagnosticProblem[] = []

      const mcps = ctx.data.location.mcp.server.list(loc) ?? []
      for (const mcp of mcps) {
        if (mcp.status.status === "failed") {
          items.push({
            id: `mcp-failed:${mcp.name}`,
            severity: "error",
            source: `MCP · ${mcp.name}`,
            message: mcp.status.error || tr("Failed to connect MCP server", "Falha ao conectar servidor MCP"),
            actionLabel: tr("Open MCPs", "Abrir MCPs"),
            onAction: () => openActivity("mcp"),
          })
        }
        if (mcp.status.status === "needs_auth") {
          items.push({
            id: `mcp-auth:${mcp.name}`,
            severity: "warning",
            source: `MCP · ${mcp.name}`,
            message:
              mcp.status.error ||
              tr("Authentication required to use its tools", "Autenticação necessária para usar as ferramentas"),
            actionLabel: tr("Sign in", "Autenticar"),
            onAction: () => openActivity("mcp"),
          })
        }
      }

      return items
    })

    const problems = createMemo<readonly DiagnosticProblem[]>(() => [...systemProblems(), ...customProblems()])

    const openActivity = (view: ActivityView) => {
      batch(() => {
        setState("activity", view)
        setState("sidebarOpen", true)
      })
      persist()
    }

    const toggleSidebar = (view?: ActivityView) => {
      batch(() => {
        if (!view) {
          setState("sidebarOpen", !state.sidebarOpen)
        } else if (state.sidebarOpen && state.activity === view) {
          setState("sidebarOpen", false)
        } else {
          setState("activity", view)
          setState("sidebarOpen", true)
        }
      })
      persist()
    }

    const closeSidebar = () => {
      setState("sidebarOpen", false)
      persist()
    }

    const setSidebarWidth = (width: number) => {
      setState("sidebarWidth", clampSidebarWidth(width))
      persist()
    }

    const setLayoutMode = (mode: LayoutMode) => {
      setState("layoutMode", mode)
      persist()
      const current = bridge()
      if (!current) return
      if (mode === "chat") current.setSideOpen(false)
      if (mode === "split" || mode === "editor") current.setSideOpen(true)
    }

    const openBottom = (tab: BottomTab) => {
      batch(() => {
        setState("bottomTab", tab)
        setState("bottomOpen", true)
      })
      persist()
    }

    const toggleBottom = (tab?: BottomTab) => {
      batch(() => {
        if (!tab) {
          setState("bottomOpen", !state.bottomOpen)
        } else if (state.bottomOpen && state.bottomTab === tab) {
          setState("bottomOpen", false)
        } else {
          setState("bottomTab", tab)
          setState("bottomOpen", true)
        }
      })
      persist()
    }

    const closeBottom = () => {
      setState("bottomOpen", false)
      persist()
    }

    const setBottomHeight = (height: number) => {
      setState("bottomHeight", clampBottomHeight(height))
      persist()
    }

    const registerSessionBridge = (next: SessionWorkbenchBridge) => {
      setBridge(next)
      return () => {
        setBridge((current) => (current === next ? undefined : current))
      }
    }

    const ensureSessionForWorkspace = async () => {
      const currentBridge = bridge()
      if (currentBridge?.sessionID()) return currentBridge

      const conn = activeServer()
      const ctx = activeServerCtx()
      const dir = activeDirectory()
      if (!conn || !ctx || !dir) return undefined

      const serverKey = ServerConnection.key(conn)
      const existing = ctx.data.session
        .list()
        .find((item) => !item.parentID && item.location.directory === dir)

      if (existing) {
        tabs.select(tabs.addSessionTab({ server: serverKey, sessionId: existing.id }))
        return undefined
      }

      await tabs.newDraft({ server: serverKey, directory: dir }, "")
      return undefined
    }

    const openFile = async (path: string, opts?: { line?: number; endLine?: number; edit?: boolean }) => {
      const request: EditorOpenRequest = {
        path,
        line: opts?.line,
        endLine: opts?.endLine,
        edit: opts?.edit,
        nonce: Date.now(),
      }
      setPendingEditorRequest(request)

      if (state.layoutMode === "chat") {
        setState("layoutMode", "split")
        persist()
      }

      const currentBridge = bridge()
      if (currentBridge?.sessionID()) {
        currentBridge.setSideOpen(true)
        currentBridge.openFile(path, opts)
        return
      }

      await ensureSessionForWorkspace()
    }

    const openDiff = (file?: string) => {
      if (state.layoutMode === "chat") {
        setState("layoutMode", "split")
        persist()
      }
      const currentBridge = bridge()
      if (!currentBridge) return
      currentBridge.setSideOpen(true)
      currentBridge.openDiff(file)
    }

    const insertComposerText = (text: string) => {
      bridge()?.insertText(text)
    }

    const setAgent = (agentId: string) => {
      bridge()?.setAgent(agentId)
    }

    const runShellCommand = async (
      command: string,
      opts?: { cwd?: string; timeout?: number },
    ): Promise<ShellRunResult> => {
      const ctx = activeServerCtx()
      const dir = opts?.cwd ?? activeDirectory()
      if (!ctx || !dir) return { output: "", error: tr("No active workspace connected.", "Nenhum workspace ativo conectado.") }

      try {
        const created = await ctx.sdk.api.shell.create({
          location: { directory: dir },
          command,
          cwd: dir,
          timeout: opts?.timeout ?? 30_000,
        })
        const shellID = created.data.id
        setShellRevision((n) => n + 1)

        const deadline = Date.now() + (opts?.timeout ?? 30_000) + 2000
        let latest = created.data
        while (latest.status === "running" && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 140))
          const polled = await ctx.sdk.api.shell
            .get({ id: shellID, location: { directory: dir } })
            .catch(() => undefined)
          if (!polled) break
          latest = polled.data
        }

        const out = await ctx.sdk.api.shell
          .output({ id: shellID, location: { directory: dir }, limit: 256_000 })
          .catch(() => undefined)

        setShellRevision((n) => n + 1)
        return {
          id: shellID,
          output: out?.data.output ?? "",
          exit: latest.exit,
          status: latest.status,
        }
      } catch (err) {
        return {
          output: "",
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }

    createEffect(() => {
      const currentBridge = bridge()
      const pending = pendingEditorRequest()
      if (!currentBridge || !pending || !currentBridge.sessionID()) return
      // Only auto-consume recent requests when transitioning into a session from Home.
      if (Date.now() - pending.nonce > 4000) return
      currentBridge.setSideOpen(true)
      currentBridge.openFile(pending.path, {
        line: pending.line,
        endLine: pending.endLine,
        edit: pending.edit,
      })
      setPendingEditorRequest(undefined)
    })

    return {
      activity: () => state.activity,
      sidebarOpen: () => state.sidebarOpen,
      sidebarWidth: () => state.sidebarWidth,
      layoutMode: () => state.layoutMode,
      bottomOpen: () => state.bottomOpen,
      bottomTab: () => state.bottomTab,
      bottomHeight: () => state.bottomHeight,
      openActivity,
      toggleSidebar,
      closeSidebar,
      setSidebarWidth,
      setLayoutMode,
      openBottom,
      toggleBottom,
      closeBottom,
      setBottomHeight,
      activeServer,
      activeServerCtx,
      activeDirectory,
      activeLocation,
      activeSession,
      activeSessionID,
      registerSessionBridge,
      bridge,
      openFile,
      openDiff,
      insertComposerText,
      setAgent,
      activeAgent: () => bridge()?.activeAgent(),
      activeModel: () => bridge()?.activeModel(),
      contextPercent: () => bridge()?.contextPercent(),
      problems,
      setCustomProblems,
      runShellCommand,
      gitRevision,
      bumpGitRevision: () => setGitRevision((n) => n + 1),
      shellRevision,
      bumpShellRevision: () => setShellRevision((n) => n + 1),
    }
  },
})

export type WorkbenchContextValue = ReturnType<typeof useWorkbench>
