import { RGBA, TextAttributes, type MouseEvent } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { execFile } from "node:child_process"
import { useClient } from "../../context/client"
import { useData } from "../../context/data"
import { useLocation } from "../../context/location"
import { useTheme } from "../../context/theme"
import { Keymap } from "../../context/keymap"
import { useToast } from "../../ui/toast"

export interface ChangedFile {
  readonly file: string
  readonly additions: number
  readonly deletions: number
  readonly status: "added" | "modified" | "deleted" | string
}

// Global dismiss trigger for the review bar
export const ReviewBarSignals = {
  dismiss: (sessionID?: string) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("omnicode:review:dismiss", { detail: { sessionID } }))
    }
  },
}

export function PromptReviewBar(props: { sessionID?: string }) {
  const client = useClient()
  const data = useData()
  const location = useLocation()
  const theme = useTheme()
  const keymap = Keymap.use()
  const toast = useToast()

  const [files, setFiles] = createSignal<readonly ChangedFile[]>([])
  const [expanded, setExpanded] = createSignal(false)
  const [dismissedSession, setDismissedSession] = createSignal<string | null>(null)
  const [dismissedFingerprint, setDismissedFingerprint] = createSignal<string>("")

  const status = createMemo(() => (props.sessionID ? data.session.status(props.sessionID) : undefined))
  const messages = createMemo(() => (props.sessionID ? data.session.message.list(props.sessionID) : []))

  let diffRequestId = 0
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  const executeLoadDiff = async () => {
    const sid = props.sessionID
    if (!sid) {
      setFiles([])
      return
    }

    const currentRequestId = ++diffRequestId
    const isRunning = status() === "running"

    try {
      let resolved: ChangedFile[] = []

      // 1. Try session.diff first
      try {
        const sessionDiff = await client.api.session.diff({ sessionID: sid })
        if (Array.isArray(sessionDiff) && sessionDiff.length > 0) {
          resolved = sessionDiff.map((item) => ({
            file: item.file ?? "",
            additions: typeof item.additions === "number" ? item.additions : 0,
            deletions: typeof item.deletions === "number" ? item.deletions : 0,
            status: item.status ?? "modified",
          }))
        }
      } catch {
        // session.diff may not have snapshot records
      }

      // 2. Fallback to vcs.diff("working") if idle or step completed (avoid hammering during streaming)
      if (resolved.length === 0 && (!isRunning || resolved.length > 0)) {
        try {
          const vcsRes: any = await client.api.vcs.diff({ mode: "working" })
          const vcsList = Array.isArray(vcsRes) ? vcsRes : (vcsRes?.data ?? [])
          if (Array.isArray(vcsList) && vcsList.length > 0) {
            resolved = vcsList.map((item: any) => ({
              file: item.file ?? "",
              additions: typeof item.additions === "number" ? item.additions : 0,
              deletions: typeof item.deletions === "number" ? item.deletions : 0,
              status: item.status ?? "modified",
            }))
          }
        } catch {
          // vcs not available
        }
      }

      // Guard against out-of-order resolution
      if (currentRequestId === diffRequestId) {
        resolved = resolved.filter((f) => f.file && f.file.trim().length > 0)
        setFiles(resolved)
      }
    } catch {
      if (currentRequestId === diffRequestId) {
        setFiles([])
      }
    }
  }

  const scheduleLoadDiff = (delay = 400) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      void executeLoadDiff()
    }, delay)
  }

  // React to status changes and message length changes
  createEffect(() => {
    const sid = props.sessionID
    const s = status()
    void messages().length
    if (sid) {
      scheduleLoadDiff(s === "running" ? 600 : 200)
    } else {
      setFiles([])
    }
  })

  // Listen to meaningful client events (filtering out streaming delta deluges)
  onMount(() => {
    scheduleLoadDiff(100)

    const unsub = client.event.listen((evt: any) => {
      try {
        const raw = evt?.details?.type ?? evt?.type ?? evt?.name
        if (typeof raw !== "string" || !raw) return

        // Filter out high-frequency streaming deltas
        if (
          raw.includes(".delta") ||
          raw.includes(".chunk") ||
          raw.includes(".token") ||
          raw.includes(".diff")
        ) {
          return
        }

        if (
          raw.startsWith("vcs.") ||
          raw.startsWith("tool.") ||
          raw === "session.idle" ||
          raw === "session.status" ||
          raw === "session.step.completed" ||
          raw === "session.step.failed" ||
          raw === "session.updated"
        ) {
          scheduleLoadDiff(raw.startsWith("vcs.") ? 150 : 400)
        }
      } catch {
        // never throw in event listener
      }
    })

    // Listen to global dismiss events from /keep command
    const handleGlobalDismiss = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail?.sessionID || detail.sessionID === props.sessionID) {
        dismissCurrent()
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("omnicode:review:dismiss", handleGlobalDismiss)
    }

    // Keyboard shortcuts for ReviewBar (Alt+K: Keep, Alt+U / Alt+Z: Undo, Alt+D: Diff drawer)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible()) return

      if (e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault()
        e.stopPropagation()
        dismissCurrent()
      } else if (e.altKey && (e.key === "u" || e.key === "U" || e.key === "z" || e.key === "Z")) {
        e.preventDefault()
        e.stopPropagation()
        triggerUndo()
      } else if (e.altKey && (e.key === "d" || e.key === "D")) {
        e.preventDefault()
        e.stopPropagation()
        setExpanded((prev) => !prev)
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("keydown", handleKeyDown, true)
    }

    onCleanup(() => {
      unsub()
      if (debounceTimer) clearTimeout(debounceTimer)
      if (typeof window !== "undefined") {
        window.removeEventListener("omnicode:review:dismiss", handleGlobalDismiss)
        window.removeEventListener("keydown", handleKeyDown, true)
      }
    })
  })

  const totalAdditions = createMemo(() => files().reduce((acc, f) => acc + f.additions, 0))
  const totalDeletions = createMemo(() => files().reduce((acc, f) => acc + f.deletions, 0))

  const currentFingerprint = createMemo(() => {
    return files()
      .map((f) => `${f.file}:${f.additions}:${f.deletions}`)
      .join("|")
  })

  const visible = createMemo(() => {
    if (!props.sessionID || files().length === 0) return false
    if (dismissedSession() === props.sessionID && dismissedFingerprint() === currentFingerprint()) return false
    return true
  })

  const dismissCurrent = () => {
    if (props.sessionID) {
      setDismissedSession(props.sessionID)
      setDismissedFingerprint(currentFingerprint())
      toast.show({
        variant: "success",
        message: `✓ Alterações mantidas (${files().length} ${files().length === 1 ? "arquivo" : "arquivos"})`,
        duration: 3000,
      })
    }
  }

  const triggerUndo = async () => {
    try {
      keymap.dispatch("session.undo")
      toast.show({
        variant: "info",
        message: "⏪ Revertendo alterações...",
        duration: 2500,
      })
      setTimeout(() => {
        scheduleLoadDiff(300)
      }, 500)
    } catch {
      // ignore
    }
  }

  const handleKeep = (e: MouseEvent) => {
    e.stopPropagation()
    dismissCurrent()
  }

  const handleUndo = async (e: MouseEvent) => {
    e.stopPropagation()
    await triggerUndo()
  }

  const toggleExpand = (e: MouseEvent) => {
    e.stopPropagation()
    setExpanded((prev) => !prev)
  }

  const undoSingleFile = (e: MouseEvent, item: ChangedFile) => {
    e.stopPropagation()
    const cwd = location.ref?.directory || process.cwd()
    execFile("git", ["checkout", "HEAD", "--", item.file], { cwd }, (err) => {
      if (err && item.status === "added") {
        execFile("git", ["clean", "-f", "--", item.file], { cwd }, () => {
          toast.show({
            variant: "info",
            message: `⏪ Arquivo revertido: ${item.file}`,
            duration: 2400,
          })
          scheduleLoadDiff(150)
        })
        return
      }
      toast.show({
        variant: err ? "warning" : "info",
        message: err ? `Não foi possível reverter ${item.file} via git` : `⏪ Arquivo revertido: ${item.file}`,
        duration: 2400,
      })
      scheduleLoadDiff(150)
    })
  }

  return (
    <Show when={visible()}>
      <box
        width="100%"
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={RGBA.fromHex("#00D2FF")}
        backgroundColor={RGBA.fromHex("#080D1A")}
        marginBottom={0}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={0}
        paddingBottom={0}
        flexShrink={0}
      >
        {/* Main Bar Row */}
        <box
          flexDirection="row"
          alignItems="center"
          width="100%"
          gap={1}
          height={1}
        >
          {/* Chevron expander & summary */}
          <box
            flexDirection="row"
            alignItems="center"
            gap={1}
            flexGrow={1}
            minWidth={0}
            onMouseUp={toggleExpand}
          >
            <text fg={RGBA.fromHex("#00F5FF")} attributes={TextAttributes.BOLD} selectable={false}>
              {expanded() ? "▾" : ">"}
            </text>
            <text fg={RGBA.fromHex("#F8FAFC")} attributes={TextAttributes.BOLD} selectable={false}>
              {files().length} {files().length === 1 ? "arquivo alterado" : "arquivos alterados"}
            </text>
            <text fg={RGBA.fromHex("#10B981")} attributes={TextAttributes.BOLD} selectable={false}>
              +{totalAdditions()}
            </text>
            <text fg={RGBA.fromHex("#F43F5E")} attributes={TextAttributes.BOLD} selectable={false}>
              -{totalDeletions()}
            </text>
          </box>

          {/* Action buttons with Keyboard Affordance */}
          <box flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
            <box
              backgroundColor={RGBA.fromHex("#0066FF")}
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={handleKeep}
            >
              <text fg={RGBA.fromHex("#FFFFFF")} attributes={TextAttributes.BOLD} selectable={false}>
                Manter [Alt+K]
              </text>
            </box>
            <box
              backgroundColor={RGBA.fromHex("#1E293B")}
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={handleUndo}
            >
              <text fg={RGBA.fromHex("#E2E8F0")} attributes={TextAttributes.BOLD} selectable={false}>
                Desfazer [Alt+U]
              </text>
            </box>
            <box
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={toggleExpand}
            >
              <text fg={RGBA.fromHex("#00F5FF")} attributes={TextAttributes.BOLD} selectable={false}>
                {expanded() ? "[Arquivos ▴]" : "[Arquivos ▾ Alt+D]"}
              </text>
            </box>
          </box>
        </box>

        {/* Expanded Changed Files List */}
        <Show when={expanded()}>
          <box flexDirection="column" width="100%" paddingTop={1} paddingBottom={0} gap={0}>
            <For each={files()}>
              {(item) => (
                <box flexDirection="row" gap={1} alignItems="center" width="100%">
                  <text
                    fg={
                      item.status === "added"
                        ? RGBA.fromHex("#10B981")
                        : item.status === "deleted"
                          ? RGBA.fromHex("#F43F5E")
                          : RGBA.fromHex("#00D2FF")
                    }
                    attributes={TextAttributes.BOLD}
                    selectable={false}
                  >
                    {item.status === "added" ? "[A]" : item.status === "deleted" ? "[D]" : "[M]"}
                  </text>
                  <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} minWidth={0}>
                    {item.file}
                  </text>
                  <Show when={item.additions > 0}>
                    <text fg={RGBA.fromHex("#10B981")} selectable={false}>
                      +{item.additions}
                    </text>
                  </Show>
                  <Show when={item.deletions > 0}>
                    <text fg={RGBA.fromHex("#F43F5E")} selectable={false}>
                      -{item.deletions}
                    </text>
                  </Show>
                  <box
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={RGBA.fromHex("#1E293B")}
                    onMouseUp={(e) => undoSingleFile(e, item)}
                  >
                    <text fg={RGBA.fromHex("#38BDF8")} selectable={false}>
                      [Desfazer arquivo]
                    </text>
                  </box>
                </box>
              )}
            </For>
          </box>
        </Show>
      </box>
    </Show>
  )
}
