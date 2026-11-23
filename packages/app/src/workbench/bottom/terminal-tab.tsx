import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { Pty } from "@opencode/client/promise"
import type { FitAddon, Terminal } from "ghostty-web"
import { Option, Predicate, Schema } from "effect"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { withAlpha } from "@opencode/ui/theme/color"
import { useTheme } from "@opencode/ui/theme/context"
import { resolveThemeVariant } from "@opencode/ui/theme/resolve"
import { resolveThemeVariantV2 } from "@opencode/ui/theme/v2/resolve"
import type { HexColor, ResolvedV2Theme } from "@opencode/ui/theme/types"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { usePlatform } from "@/runtime/platform/platform"
import type { ServerCtx } from "@/runtime/server/runtime"
import { monoFontFamily, terminalFontFamily, useSettings } from "@/settings/model"
import { showToast } from "@/shell/notifications/toast"
import { TerminalPromptIcon } from "../icons"
import { useWorkbench } from "../state"

type SurfaceError =
  | { kind: "message"; text: string }
  | { kind: "closed"; code: number }
  | { kind: "exited" }

type TerminalColors = {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
}

type TerminalController = {
  clear: () => void
  focus: () => void
  fit: () => void
}

const DEFAULT_TERMINAL_COLORS = {
  light: {
    background: "#fcfcfc",
    foreground: "#211e1e",
    cursor: "#211e1e",
    selectionBackground: withAlpha("#211e1e", 0.2),
  },
  dark: {
    background: "#191515",
    foreground: "#d4d4d4",
    cursor: "#d4d4d4",
    selectionBackground: withAlpha("#d4d4d4", 0.25),
  },
} as const satisfies Record<"light" | "dark", TerminalColors>

const ControlFrame = Schema.fromJsonString(Schema.Struct({ cursor: Schema.optional(Schema.Number) }))
const decodeControlFrame = Schema.decodeUnknownOption(ControlFrame)

async function importGhostty() {
  const mod = await import("ghostty-web")
  const ghostty = await mod.Ghostty.load()
  return { mod, ghostty }
}

let sharedGhostty: ReturnType<typeof importGhostty> | undefined

function loadGhostty() {
  if (sharedGhostty) return sharedGhostty
  sharedGhostty = importGhostty().catch((err) => {
    sharedGhostty = undefined
    throw err
  })
  return sharedGhostty
}

function isHexColor(value: string): value is HexColor {
  return value.startsWith("#")
}

function resolveV2Token(tokens: ResolvedV2Theme, key: string) {
  let current = tokens[key]
  for (let i = 0; i < 8 && current; i++) {
    const match = /^var\(--([^)]+)\)$/.exec(current.trim())
    if (!match) {
      const hex = current.trim()
      if (/^#[0-9a-fA-F]{8}$/.test(hex)) return hex.slice(0, 7)
      return hex
    }
    current = tokens[match[1]]
  }
  return undefined
}

function setOptionIfSupported(term: Terminal, key: string, value: unknown) {
  const candidate = term as unknown as Record<string, unknown>
  if (typeof candidate.setOption !== "function") return
  ;(candidate.setOption as (k: string, v: unknown) => void)(key, value)
}

function getHoveredLinkText(term: Terminal) {
  const candidate = term as unknown as Record<string, unknown>
  const link = candidate.currentHoveredLink
  if (!link || typeof link !== "object") return undefined
  const text = (link as Record<string, unknown>).text
  return typeof text === "string" ? text : undefined
}

function createBatchedWriter(write: (data: string, done?: VoidFunction) => void) {
  let chunks: string[] | undefined
  let waits: VoidFunction[] | undefined
  let scheduled = false
  let writing = false

  const settle = () => {
    if (scheduled || writing || chunks?.length) return
    const list = waits
    if (!list?.length) return
    waits = undefined
    for (const fn of list) fn()
  }

  const run = () => {
    if (writing) return
    scheduled = false
    const items = chunks
    if (!items?.length) {
      settle()
      return
    }
    chunks = undefined
    writing = true
    write(items.join(""), () => {
      writing = false
      if (chunks?.length) {
        if (scheduled) return
        scheduled = true
        queueMicrotask(run)
        return
      }
      settle()
    })
  }

  const push = (data: string) => {
    if (!data) return
    chunks = chunks ? [...chunks, data] : [data]
    if (scheduled || writing) return
    scheduled = true
    queueMicrotask(run)
  }

  const flush = (done?: VoidFunction) => {
    if (!scheduled && !writing && !chunks?.length) {
      done?.()
      return
    }
    if (done) waits = waits ? [...waits, done] : [done]
    run()
  }

  return { push, flush }
}

async function openPtySocket(ctx: ServerCtx, ptyID: string, directory: string, cursor: number) {
  const tokenRes = await ctx.sdk.api.pty.connect.token({
    ptyID,
    location: { directory },
    "x-opencode-ticket": "1",
  })
  const baseUrl = new URL(ctx.sdk.url)
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/"
  const url = new URL(`api/pty/${encodeURIComponent(ptyID)}/connect`, baseUrl)
  url.searchParams.set("location[directory]", directory)
  url.searchParams.set("cursor", String(cursor))
  url.searchParams.set("ticket", tokenRes.data.ticket)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"

  const socket = new WebSocket(url)
  socket.binaryType = "arraybuffer"
  return socket
}

function nextTerminalTitle(existing: readonly Pty[]) {
  const used = new Set<number>()
  for (const item of existing) {
    const match = /^Terminal\s+(\d+)$/i.exec(item.title.trim())
    if (match) used.add(Number(match[1]))
  }
  let num = 1
  while (used.has(num)) num += 1
  return `Terminal ${num}`
}

function PtyTerminalSurface(props: {
  pty: Pty
  ctx: ServerCtx
  directory: string
  active: boolean
  onRegister: (id: string, ctrl: TerminalController) => void
  onUnregister: (id: string) => void
  onExited: (id: string) => void
}) {
  const theme = useTheme()
  const settings = useSettings()
  const platform = usePlatform()
  const { tr } = useOnethyI18n()

  const [status, setStatus] = createSignal<"connecting" | "connected" | "error">("connecting")
  const [surfaceError, setSurfaceError] = createSignal<SurfaceError | undefined>(undefined)

  const errorMessage = createMemo(() => {
    const err = surfaceError()
    if (!err) return undefined
    if (err.kind === "closed") {
      return tr("Connection closed (code {{code}})", "Conexão encerrada (código {{code}})", { code: err.code })
    }
    if (err.kind === "exited") {
      return tr("Terminal session ended.", "Sessão do terminal encerrada.")
    }
    return err.text
  })

  let container: HTMLDivElement | undefined
  let term: Terminal | undefined
  let fitAddon: FitAddon | undefined
  let ws: WebSocket | undefined
  let fitFrame: number | undefined
  let sizeTimer: ReturnType<typeof setTimeout> | undefined
  let reconnTimer: ReturnType<typeof setTimeout> | undefined
  let pendingSize: { cols: number; rows: number } | undefined
  let lastSize: { cols: number; rows: number } | undefined
  let dropSocket: VoidFunction | undefined
  let disposed = false
  let cursor = 0
  let tries = 0
  const cleanups: VoidFunction[] = []

  // Intentional mount-time capture for stable imperative PTY & WebSocket lifecycle.
  const ctx = props.ctx
  const directory = props.directory
  const ptyID = props.pty.id

  const fontFamily = createMemo(() => {
    const customTerm = settings.appearance.terminalFont().trim()
    if (customTerm) return terminalFontFamily(customTerm)
    return monoFontFamily(settings.appearance.font())
  })

  const terminalColors = createMemo<TerminalColors>(() => {
    const mode = theme.mode() === "dark" ? "dark" : "light"
    const fallback = DEFAULT_TERMINAL_COLORS[mode]
    const currentTheme = theme.themes()[theme.themeId()]
    if (!currentTheme) return fallback
    const variant = mode === "dark" ? currentTheme.dark : currentTheme.light
    if (!variant?.seeds && !variant?.palette) return fallback

    const resolved = resolveThemeVariant(variant, mode === "dark")
    const foreground = resolved["text-stronger"] ?? fallback.foreground
    const background =
      resolveV2Token(resolveThemeVariantV2(variant, mode === "dark"), "v2-background-bg-base") ?? fallback.background
    const alpha = mode === "dark" ? 0.25 : 0.2
    const selectionBase = isHexColor(foreground) ? foreground : fallback.foreground

    return {
      background,
      foreground,
      cursor: foreground,
      selectionBackground: withAlpha(selectionBase, alpha),
    }
  })

  const scheduleFit = () => {
    if (disposed || !fitAddon || fitFrame !== undefined) return
    fitFrame = requestAnimationFrame(() => {
      fitFrame = undefined
      if (disposed || !fitAddon || !container) return
      if (container.clientWidth === 0 || container.clientHeight === 0) return
      fitAddon.fit()
    })
  }

  const pushSize = async (cols: number, rows: number) => {
    if (cols <= 0 || rows <= 0) return
    await ctx.sdk.api.pty
      .update({
        ptyID,
        location: { directory },
        size: { cols, rows },
      })
      .catch(() => undefined)
  }

  const scheduleSize = (cols: number, rows: number) => {
    if (disposed) return
    if (lastSize?.cols === cols && lastSize?.rows === rows) {
      pendingSize = undefined
      if (sizeTimer !== undefined) {
        clearTimeout(sizeTimer)
        sizeTimer = undefined
      }
      return
    }
    pendingSize = { cols, rows }
    if (!lastSize) {
      lastSize = pendingSize
      void pushSize(cols, rows)
      return
    }
    if (sizeTimer !== undefined) return
    sizeTimer = setTimeout(() => {
      sizeTimer = undefined
      const next = pendingSize
      if (!next || disposed) return
      pendingSize = undefined
      if (lastSize?.cols === next.cols && lastSize?.rows === next.rows) return
      lastSize = next
      void pushSize(next.cols, next.rows)
    }, 100)
  }

  const focusTerminal = () => {
    const t = term
    if (!t) return
    const focus = () => (t.textarea ? t.textarea.focus({ preventScroll: true }) : t.focus())
    focus()
    setTimeout(focus, 0)
  }

  createEffect(() => {
    const colors = terminalColors()
    const mode = theme.mode() === "dark" ? "dark" : "light"
    if (!term) return
    setOptionIfSupported(term, "theme", colors)
    setOptionIfSupported(term, "colorScheme", mode)
  })

  createEffect(() => {
    const font = fontFamily()
    if (!term) return
    setOptionIfSupported(term, "fontFamily", font)
    scheduleFit()
  })

  createEffect(() => {
    if (!props.active) return
    scheduleFit()
    requestAnimationFrame(() => {
      if (!disposed && props.active) focusTerminal()
    })
  })

  onMount(() => {
    const el = container
    if (!el) return

    const runCleanup = () => {
      if (!cleanups.length) return
      for (const fn of cleanups.splice(0).reverse()) {
        fn()
      }
    }

    const run = async () => {
      const loaded = await loadGhostty()
      if (disposed) return

      const t = new loaded.mod.Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 13,
        fontFamily: fontFamily(),
        allowTransparency: false,
        convertEol: false,
        theme: terminalColors(),
        scrollback: 10_000,
        ghostty: loaded.ghostty,
      })

      cleanups.push(() => t.dispose())

      if (disposed) {
        runCleanup()
        return
      }

      term = t
      setOptionIfSupported(t, "colorScheme", theme.mode() === "dark" ? "dark" : "light")
      const writer = createBatchedWriter((data, done) => t.write(data, done))

      t.attachCustomKeyEventHandler((event) => {
        const key = event.key.toLowerCase()
        if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === "backspace") {
          t.input("\x15", true)
          return true
        }
        if (event.ctrlKey && event.shiftKey && !event.metaKey && key === "c" && t.hasSelection()) {
          const text = t.getSelection()
          if (text) void (platform.writeClipboardText?.(text) ?? navigator.clipboard.writeText(text)).catch(() => undefined)
          return true
        }
        if (event.ctrlKey && !event.shiftKey && !event.altKey && key === "`") {
          return true
        }
        return false
      })

      const fit = new loaded.mod.FitAddon()
      cleanups.push(() => fit.dispose())
      t.loadAddon(fit)
      fitAddon = fit

      t.open(el)

      const handleCopy = (event: ClipboardEvent) => {
        const selection = t.getSelection()
        if (!selection || !event.clipboardData) return
        event.preventDefault()
        event.clipboardData.setData("text/plain", selection)
      }
      const handlePaste = (event: ClipboardEvent) => {
        const text = event.clipboardData?.getData("text/plain") ?? event.clipboardData?.getData("text") ?? ""
        if (!text) return
        event.preventDefault()
        event.stopPropagation()
        t.paste(text)
      }
      const handlePointerDown = () => focusTerminal()
      const handleLinkClick = (event: MouseEvent) => {
        if ((!event.ctrlKey && !event.metaKey && !event.shiftKey) || event.altKey || event.button !== 0) return
        const link = getHoveredLinkText(t)
        if (!link) return
        event.preventDefault()
        event.stopImmediatePropagation()
        platform.openExternal(link)
      }

      el.addEventListener("copy", handleCopy, true)
      el.addEventListener("paste", handlePaste, true)
      el.addEventListener("pointerdown", handlePointerDown)
      el.addEventListener("click", handleLinkClick, { capture: true })
      cleanups.push(() => {
        el.removeEventListener("copy", handleCopy, true)
        el.removeEventListener("paste", handlePaste, true)
        el.removeEventListener("pointerdown", handlePointerDown)
        el.removeEventListener("click", handleLinkClick, { capture: true })
      })

      const onResize = t.onResize((size) => scheduleSize(size.cols, size.rows))
      const onData = t.onData((data) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(data)
      })
      cleanups.push(() => {
        onResize.dispose()
        onData.dispose()
      })

      fit.observeResize()
      window.addEventListener("resize", scheduleFit)
      cleanups.push(() => window.removeEventListener("resize", scheduleFit))

      if (typeof document !== "undefined" && document.fonts) {
        void document.fonts.ready.then(scheduleFit)
      }

      props.onRegister(ptyID, {
        clear: () => {
          t.clear()
          focusTerminal()
        },
        focus: focusTerminal,
        fit: scheduleFit,
      })

      scheduleFit()
      if (props.active) focusTerminal()

      const decoder = new TextDecoder()

      const isGone = async () =>
        ctx.sdk.api.pty
          .get({ ptyID, location: { directory } })
          .then((res) => res.data.status === "exited")
          .catch((err) => Predicate.isTagged(err, "PtyNotFoundError"))

      const retry = (err: SurfaceError) => {
        if (disposed || reconnTimer !== undefined) return
        const delay = Math.min(250 * 2 ** Math.min(tries, 4), 4_000)
        reconnTimer = setTimeout(async () => {
          reconnTimer = undefined
          if (disposed) return
          if (await isGone()) {
            if (disposed) return
            setStatus("error")
            setSurfaceError(err)
            props.onExited(ptyID)
            return
          }
          if (disposed) return
          tries += 1
          void connectSocket()
        }, delay)
      }

      const connectSocket = async () => {
        if (disposed) return
        dropSocket?.()
        setStatus("connecting")

        const socket = await openPtySocket(ctx, ptyID, directory, cursor).catch((err) => {
          const message = err instanceof Error ? err.message : String(err)
          retry(message ? { kind: "message", text: message } : { kind: "exited" })
          return undefined
        })
        if (!socket) return
        if (disposed) {
          socket.close(1000)
          return
        }

        ws = socket

        const handleOpen = () => {
          if (disposed) return
          tries = 0
          setStatus("connected")
          setSurfaceError(undefined)
          scheduleFit()
          scheduleSize(t.cols, t.rows)
          if (t.getMode(2031)) t.write("\x1b[?996n")
        }

        const handleMessage = (event: MessageEvent) => {
          if (disposed) return
          if (event.data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(event.data)
            if (bytes[0] !== 0) return
            const meta = decodeControlFrame(decoder.decode(bytes.subarray(1)))
            if (Option.isNone(meta)) return
            const next = meta.value.cursor
            if (next !== undefined && Number.isSafeInteger(next) && next >= 0) {
              cursor = next
            }
            return
          }
          const chunk = String(event.data)
          if (!chunk) return
          writer.push(chunk)
          cursor += chunk.length
        }

        const handleError = () => {
          if (disposed) return
          setStatus("connecting")
        }

        const stop = () => {
          socket.removeEventListener("open", handleOpen)
          socket.removeEventListener("message", handleMessage)
          socket.removeEventListener("error", handleError)
          socket.removeEventListener("close", handleClose)
          if (ws === socket) ws = undefined
          if (dropSocket === stop) dropSocket = undefined
          if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
            socket.close(1000)
          }
        }

        const handleClose = (event: CloseEvent) => {
          if (ws === socket) ws = undefined
          if (dropSocket === stop) dropSocket = undefined
          socket.removeEventListener("open", handleOpen)
          socket.removeEventListener("message", handleMessage)
          socket.removeEventListener("error", handleError)
          socket.removeEventListener("close", handleClose)
          if (disposed || event.code === 1000) return
          retry({ kind: "closed", code: event.code })
        }

        dropSocket = stop
        socket.addEventListener("open", handleOpen)
        socket.addEventListener("message", handleMessage)
        socket.addEventListener("error", handleError)
        socket.addEventListener("close", handleClose)
      }

      void connectSocket()
    }

    void run().catch((err) => {
      if (disposed) return
      setStatus("error")
      setSurfaceError({ kind: "message", text: err instanceof Error ? err.message : String(err) })
    })

    onCleanup(() => {
      disposed = true
      props.onUnregister(ptyID)
      if (fitFrame !== undefined) cancelAnimationFrame(fitFrame)
      if (sizeTimer !== undefined) clearTimeout(sizeTimer)
      if (reconnTimer !== undefined) clearTimeout(reconnTimer)
      dropSocket?.()
      if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close(1000)
      runCleanup()
    })
  })

  return (
    <div class="relative size-full overflow-hidden">
      <div
        ref={container}
        data-component="workbench-terminal-surface"
        dir="ltr"
        tabIndex={-1}
        class="size-full select-text overflow-hidden px-3 py-2"
        style={{
          "background-color": terminalColors().background,
          "caret-color": "transparent",
          "font-family": fontFamily(),
        }}
      />

      <Show when={status() === "connecting"}>
        <div class="pointer-events-none absolute end-3 top-2 flex items-center gap-1.5 rounded-md border border-v2-border-border-muted bg-v2-background-bg-layer-01/90 px-2 py-1 text-[11px] text-v2-text-text-muted">
          <Loader width={11} height={11} />
          <span>{tr("Connecting PTY...", "Conectando PTY...")}</span>
        </div>
      </Show>

      <Show when={status() === "error" && errorMessage()}>
        {(msg) => (
          <div class="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2 text-[11.5px] text-v2-state-fg-danger">
            <span class="truncate">{msg()}</span>
          </div>
        )}
      </Show>
    </div>
  )
}

export function TerminalTab(props: { visible?: boolean }) {
  const workbench = useWorkbench()
  const { tr } = useOnethyI18n()

  const [ptys, setPtys] = createSignal<readonly Pty[]>([])
  const [activeId, setActiveId] = createSignal<string | undefined>(undefined)
  const [loading, setLoading] = createSignal(false)
  const [creating, setCreating] = createSignal(false)

  const controllers = new Map<string, TerminalController>()
  const autoSpawnedWorkspaces = new Set<string>()
  let workspaceGen = 0

  const workspaceKey = createMemo(() => {
    const ctx = workbench.activeServerCtx()
    const dir = workbench.activeDirectory()
    if (!ctx || !dir) return undefined
    return `${ctx.sdk.url}\0${dir}`
  })

  const createTerminal = async () => {
    const ctx = workbench.activeServerCtx()
    const dir = workbench.activeDirectory()
    if (!ctx || !dir || creating()) return

    setCreating(true)
    const title = nextTerminalTitle(ptys())
    const res = await ctx.sdk.api.pty
      .create({
        location: { directory: dir },
        cwd: dir,
        title,
      })
      .then((out) => ({ ok: true as const, data: out.data }))
      .catch((err) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }))
    setCreating(false)

    if (!res.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to create terminal", "Falha ao criar terminal"),
        description: res.message,
      })
      return
    }

    setPtys((prev) => (prev.some((item) => item.id === res.data.id) ? prev : [...prev, res.data]))
    setActiveId(res.data.id)
  }

  const removeTerminal = async (id: string) => {
    const ctx = workbench.activeServerCtx()
    const dir = workbench.activeDirectory()
    if (!ctx || !dir) return

    const current = ptys()
    const idx = current.findIndex((item) => item.id === id)
    const remaining = current.filter((item) => item.id !== id)
    setPtys(remaining)

    if (activeId() === id) {
      const next = remaining[idx] ?? remaining[idx - 1] ?? remaining[0]
      setActiveId(next?.id)
    }

    const failed = await ctx.sdk.api.pty
      .remove({ ptyID: id, location: { directory: dir } })
      .then(() => undefined)
      .catch((err) => (err instanceof Error ? err.message : String(err)))

    if (failed) {
      showToast({
        variant: "error",
        title: tr("Failed to close terminal", "Falha ao encerrar terminal"),
        description: failed,
      })
    }
  }

  const clearActive = () => {
    const id = activeId()
    if (!id) return
    controllers.get(id)?.clear()
  }

  const handlePtyExited = (id: string) => {
    setPtys((prev) => prev.map((item) => (item.id === id ? { ...item, status: "exited" } : item)))
  }

  // Load workspace PTYs and subscribe to server PTY lifecycle events.
  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    const dir = workbench.activeDirectory()
    const key = workspaceKey()
    const gen = ++workspaceGen

    setPtys([])
    setActiveId(undefined)

    if (!ctx || !dir || !key) return

    const stream = ctx.sdk.event.location(dir)
    const offCreated = stream.on("pty.created", (event) => {
      const info = event.data.info
      setPtys((prev) => (prev.some((item) => item.id === info.id) ? prev : [...prev, info]))
      if (!activeId()) setActiveId(info.id)
    })
    const offUpdated = stream.on("pty.updated", (event) => {
      const info = event.data.info
      setPtys((prev) => prev.map((item) => (item.id === info.id ? info : item)))
    })
    const offExited = stream.on("pty.exited", (event) => {
      handlePtyExited(event.data.id)
    })
    const offDeleted = stream.on("pty.deleted", (event) => {
      const removed = event.data.id
      setPtys((prev) => {
        const next = prev.filter((item) => item.id !== removed)
        if (activeId() === removed) setActiveId(next[0]?.id)
        return next
      })
    })
    onCleanup(() => {
      offCreated()
      offUpdated()
      offExited()
      offDeleted()
    })

    setLoading(true)
    void ctx.sdk.api.pty
      .list({ location: { directory: dir } })
      .then((res) => {
        if (gen !== workspaceGen) return
        const running = res.data.filter((item) => item.status === "running")
        setPtys(running)
        setActiveId(running[0]?.id)
      })
      .catch(() => undefined)
      .finally(() => {
        if (gen === workspaceGen) setLoading(false)
      })
  })

  // Auto-open the first interactive terminal once when visible on a workspace with no running PTYs.
  createEffect(() => {
    const visible = props.visible !== false
    const key = workspaceKey()
    if (!visible || !key || loading() || creating()) return
    if (ptys().length > 0) return
    if (autoSpawnedWorkspaces.has(key)) return
    autoSpawnedWorkspaces.add(key)
    void createTerminal()
  })

  const activePty = createMemo(() => ptys().find((item) => item.id === activeId()))

  return (
    <Show
      when={workbench.activeServerCtx() && workbench.activeDirectory()}
      fallback={
        <div class="flex size-full flex-col items-center justify-center gap-2 px-4 text-center">
          <TerminalPromptIcon size={18} class="text-v2-icon-icon-muted" />
          <div class="text-[12px] font-medium text-v2-text-text-base">
            {tr("No workspace connected", "Nenhum workspace conectado")}
          </div>
          <p class="text-[11px] text-v2-text-text-faint">
            {tr(
              "Open a project to launch interactive terminals on the active server.",
              "Abra um projeto para iniciar terminais interativos no servidor ativo.",
            )}
          </p>
        </div>
      }
    >
      <div class="flex size-full min-h-0 flex-col bg-v2-background-bg-base">
        {/* Compact terminal instances bar */}
        <div class="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01/50 px-2 select-none">
          <div
            data-slot="workbench-scroll"
            class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            role="tablist"
            aria-label={tr("Terminal instances", "Instâncias de terminal")}
          >
            <For each={ptys()}>
              {(pty) => {
                const isSelected = () => activeId() === pty.id
                return (
                  <div
                    role="tab"
                    aria-selected={isSelected()}
                    class="group flex h-6 max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[5px] border px-2 text-[11px] transition-colors"
                    classList={{
                      "border-v2-border-border-base bg-v2-background-bg-base text-v2-text-text-base": isSelected(),
                      "border-transparent text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                        !isSelected(),
                    }}
                    title={`${pty.title} · PID ${pty.pid} · ${pty.cwd}`}
                    onClick={() => setActiveId(pty.id)}
                  >
                    <span
                      class="size-1.5 shrink-0 rounded-full"
                      classList={{
                        "bg-v2-state-fg-success": pty.status === "running",
                        "bg-v2-text-text-faint": pty.status !== "running",
                      }}
                    />
                    <span class="truncate">{pty.title}</span>
                    <button
                      type="button"
                      class="flex size-4 shrink-0 items-center justify-center rounded text-v2-icon-icon-muted opacity-60 hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base hover:opacity-100"
                      aria-label={tr("Close {{title}}", "Encerrar {{title}}", { title: pty.title })}
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeTerminal(pty.id)
                      }}
                    >
                      <Icon name="outline-xmark" size="small" class="size-3" />
                    </button>
                  </div>
                )
              }}
            </For>

            <Show when={loading() && ptys().length === 0}>
              <div class="flex items-center gap-1.5 px-1 text-[11px] text-v2-text-text-faint">
                <Loader width={11} height={11} />
                <span>{tr("Loading terminals...", "Carregando terminais...")}</span>
              </div>
            </Show>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={creating()}
              class="flex h-6 items-center gap-1 rounded-[5px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[11px] font-medium text-v2-text-text-base transition-colors hover:border-v2-border-border-base hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-50"
              onClick={() => void createTerminal()}
            >
              <Show when={creating()} fallback={<Icon name="plus" size="small" class="size-3" />}>
                <Loader width={11} height={11} />
              </Show>
              <span>{tr("New Terminal", "Novo Terminal")}</span>
            </button>

            <Tooltip placement="top" value={tr("Clear active terminal screen", "Limpar tela do terminal ativo")}>
              <button
                type="button"
                disabled={!activePty()}
                class="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[11px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-40"
                aria-label={tr("Clear terminal", "Limpar terminal")}
                onClick={clearActive}
              >
                <Icon name="outline-reset" size="small" class="size-3.5" />
                <span class="hidden sm:inline">{tr("Clear", "Limpar")}</span>
              </button>
            </Tooltip>

            <Tooltip placement="top" value={tr("Terminate active terminal process", "Encerrar processo do terminal ativo")}>
              <button
                type="button"
                disabled={!activePty()}
                class="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[11px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-state-fg-danger disabled:opacity-40"
                aria-label={tr("Close terminal", "Encerrar terminal")}
                onClick={() => {
                  const id = activeId()
                  if (id) void removeTerminal(id)
                }}
              >
                <Icon name="trash" size="small" class="size-3.5" />
                <span class="hidden sm:inline">{tr("Close", "Encerrar")}</span>
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Live PTY canvases */}
        <div class="relative min-h-0 flex-1 overflow-hidden">
          <Show
            when={ptys().length > 0}
            fallback={
              <Show when={!loading()}>
                <div class="flex size-full flex-col items-center justify-center gap-2.5 px-4 text-center">
                  <div class="flex size-9 items-center justify-center rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
                    <TerminalPromptIcon size={16} />
                  </div>
                  <div class="text-[12px] font-medium text-v2-text-text-base">
                    {tr("No active terminal", "Nenhum terminal ativo")}
                  </div>
                  <button
                    type="button"
                    disabled={creating()}
                    class="flex h-7 items-center gap-1.5 rounded-[6px] bg-v2-background-bg-accent px-3 text-[11.5px] font-medium text-v2-text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-50"
                    onClick={() => void createTerminal()}
                  >
                    <Icon name="plus" size="small" class="size-3.5" />
                    <span>{tr("New Terminal", "Novo Terminal")}</span>
                  </button>
                </div>
              </Show>
            }
          >
            <For each={ptys()}>
              {(pty) => {
                const ctx = workbench.activeServerCtx()
                const dir = workbench.activeDirectory()
                const isActive = () => props.visible !== false && activeId() === pty.id

                return (
                  <Show when={ctx && dir}>
                    <div
                      class="absolute inset-0"
                      classList={{ hidden: activeId() !== pty.id }}
                    >
                      <PtyTerminalSurface
                        pty={pty}
                        ctx={ctx!}
                        directory={dir!}
                        active={isActive()}
                        onRegister={(id, ctrl) => controllers.set(id, ctrl)}
                        onUnregister={(id) => controllers.delete(id)}
                        onExited={handlePtyExited}
                      />
                    </div>
                  </Show>
                )
              }}
            </For>
          </Show>
        </div>
      </div>
    </Show>
  )
}
