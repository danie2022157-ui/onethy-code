import { RGBA, TextAttributes, type MouseEvent } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useClient } from "../../context/client"
import { useRoute } from "../../context/route"
import { isCurrentSessionDiff, loadSessionReview, sessionReviewFingerprint, type ChangedFile } from "./review-bar-session"
import { useData } from "../../context/data"
import { useTheme } from "../../context/theme"
import { Keymap } from "../../context/keymap"
import { useToast } from "../../ui/toast"

type DismissListener = (sessionID: string) => void
const dismissListeners = new Set<DismissListener>()

// Each /keep action must name its owning session; it must never broadcast to other tabs.
export const ReviewBarSignals = {
  dismiss: (sessionID: string) => {
    for (const listener of dismissListeners) {
      try {
        listener(sessionID)
      } catch {}
    }
  },
  onDismiss: (listener: DismissListener) => {
    dismissListeners.add(listener)
    return () => dismissListeners.delete(listener)
  },
}

export function PromptReviewBar(props: { sessionID?: string; active?: boolean }) {
  const client = useClient()
  const data = useData()
  const route = useRoute()
  const theme = useTheme()
  const keymap = Keymap.use()
  const toast = useToast()

  // The component can remain mounted while tabs switch, so attach every result and
  // interaction state to a session ID. Old tab results never appear in the new tab.
  const [diffState, setDiffState] = createSignal<{ sessionID: string; files: readonly ChangedFile[] }>({
    sessionID: "",
    files: [],
  })
  const files = createMemo(() =>
    diffState().sessionID === props.sessionID ? diffState().files : [],
  )
  const [expandedBySession, setExpandedBySession] = createSignal<Record<string, boolean>>({})
  const [dismissedBySession, setDismissedBySession] = createSignal<Record<string, string>>({})
  const expanded = createMemo(() => Boolean(expandedBySession()[props.sessionID ?? ""]))
  const toggleExpanded = () => {
    const sid = props.sessionID
    if (!sid) return
    setExpandedBySession((current) => ({ ...current, [sid]: !current[sid] }))
  }

  const status = createMemo(() => (props.sessionID ? data.session.status(props.sessionID) : undefined))
  const messages = createMemo(() => (props.sessionID ? data.session.message.list(props.sessionID) : []))

  let diffRequestId = 0
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  const executeLoadDiff = async () => {
    const sid = props.sessionID
    if (!sid) return

    const currentRequestId = ++diffRequestId
    try {
      // Only the owning session's recorded turn is permitted. An empty response is
      // genuinely empty; workspace-level vcs.diff/git status may belong to other tabs.
      const resolved = await loadSessionReview(sid, (sessionID) =>
        client.api.session.diff({ sessionID, context: 0 }),
      )
      if (!isCurrentSessionDiff(sid, currentRequestId, props.sessionID, diffRequestId)) return
      setDiffState({ sessionID: sid, files: resolved })
    } catch {
      // Fail closed on missing snapshots/errors; never show another session's git changes.
      if (!isCurrentSessionDiff(sid, currentRequestId, props.sessionID, diffRequestId)) return
      setDiffState({ sessionID: sid, files: [] })
    }
  }

  const scheduleLoadDiff = (delay = 300) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      void executeLoadDiff()
    }, delay)
  }

  // Reset immediately when the route changes, before the next async request resolves.
  let activeSessionID: string | undefined
  createEffect(() => {
    const sid = props.sessionID
    const state = status()
    void messages().length
    if (sid !== activeSessionID) {
      diffRequestId++
      activeSessionID = sid
      setDiffState({ sessionID: sid ?? "", files: [] })
    }
    if (sid) scheduleLoadDiff(state === "running" ? 500 : 150)
  })

  // Listen to meaningful client events (filtering out streaming delta deluges)
  onMount(() => {
    scheduleLoadDiff(100)

    const unsub = client.event.listen((evt: any) => {
      try {
        const raw = evt?.details?.type ?? evt?.type ?? evt?.name
        if (typeof raw !== "string" || !raw) return

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
          scheduleLoadDiff(raw.startsWith("vcs.") ? 150 : 350)
        }
      } catch {
        // never throw in event listener
      }
    })

    // Listen to global dismiss events from /keep command or ReviewBarSignals
    const unsubDismiss = ReviewBarSignals.onDismiss((targetSessionID) => {
      if (targetSessionID === props.sessionID) {
        dismissCurrent()
      }
    })

    // Refresh the active session's own recorded turn (never the working tree).
    const pollInterval = setInterval(() => {
      void executeLoadDiff()
    }, 3000)

    onCleanup(() => {
      unsub()
      unsubDismiss()
      clearInterval(pollInterval)
      if (debounceTimer) clearTimeout(debounceTimer)
      diffRequestId++
    })
  })

  const totalAdditions = createMemo(() => files().reduce((acc, f) => acc + f.additions, 0))
  const totalDeletions = createMemo(() => files().reduce((acc, f) => acc + f.deletions, 0))

  const lastTurnID = createMemo(() => messages().filter((message) => message.type === "user").at(-1)?.id ?? "")
  const currentFingerprint = createMemo(() =>
    sessionReviewFingerprint(props.sessionID ?? "", lastTurnID(), files()),
  )

  const visible = createMemo(() => {
    const sid = props.sessionID
    if (!sid || props.active === false || route.data.type !== "session" || route.data.sessionID !== sid) return false
    if (files().length === 0) return false
    return dismissedBySession()[sid] !== currentFingerprint()
  })

  const dismissCurrent = () => {
    const sid = props.sessionID
    if (!sid || !visible()) return
    setDismissedBySession((current) => ({ ...current, [sid]: currentFingerprint() }))
    toast.show({
      variant: "success",
      message: `✓ Changes kept (${files().length} ${files().length === 1 ? "file" : "files"})`,
      duration: 3000,
    })
  }

  const triggerUndo = async () => {
    try {
      keymap.dispatch("session.undo")
      toast.show({
        variant: "info",
        message: "⏪ Reverting changes...",
        duration: 2500,
      })
      setTimeout(() => {
        scheduleLoadDiff(200)
      }, 500)
    } catch {
      // ignore
    }
  }

  // Register native OpenTUI keybindings for the ReviewBar
  Keymap.createLayer(() => ({
    mode: "global",
    enabled: () => visible(),
    commands: [
      {
        id: "session.review.keep",
        bind: "alt+k",
        title: "Keep review changes",
        group: "Review",
        run: dismissCurrent,
      },
      {
        id: "session.review.diff",
        bind: "alt+d",
        title: "Toggle changed files list",
        group: "Review",
        run: () => toggleExpanded(),
      },
      {
        id: "session.review.undo",
        bind: "alt+u,alt+z",
        title: "Undo review changes",
        group: "Review",
        run: () => void triggerUndo(),
      },
    ],
  }))

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
    toggleExpanded()
  }

  return (
    <Show when={visible()}>
      <box
        width="100%"
        flexDirection="column"
        border
        borderStyle="single"
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
              {expanded() ? "v" : ">"}
            </text>
            <text fg={RGBA.fromHex("#F8FAFC")} attributes={TextAttributes.BOLD} selectable={false}>
              {files().length} {files().length === 1 ? "file changed" : "files changed"}
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
                Keep [Alt+K]
              </text>
            </box>
            <box
              backgroundColor={RGBA.fromHex("#1E293B")}
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={handleUndo}
            >
              <text fg={RGBA.fromHex("#E2E8F0")} attributes={TextAttributes.BOLD} selectable={false}>
                Undo [Alt+U]
              </text>
            </box>
            <box
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={toggleExpand}
            >
              <text fg={RGBA.fromHex("#00F5FF")} attributes={TextAttributes.BOLD} selectable={false}>
                {expanded() ? "Files [v]" : "Files [Alt+D]"}
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

                </box>
              )}
            </For>
          </box>
        </Show>
      </box>
    </Show>
  )
}
