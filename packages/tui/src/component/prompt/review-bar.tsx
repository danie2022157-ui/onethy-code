import { RGBA, TextAttributes, type MouseEvent } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useClient } from "../../context/client"
import { useData } from "../../context/data"
import { useTheme } from "../../context/theme"
import { Keymap } from "../../context/keymap"
import { useToast } from "../../ui/toast"

export interface ChangedFile {
  readonly file: string
  readonly additions: number
  readonly deletions: number
  readonly status: "added" | "modified" | "deleted" | string
}

export function PromptReviewBar(props: { sessionID?: string }) {
  const client = useClient()
  const data = useData()
  const theme = useTheme()
  const keymap = Keymap.use()
  const toast = useToast()

  const [files, setFiles] = createSignal<readonly ChangedFile[]>([])
  const [expanded, setExpanded] = createSignal(false)
  const [dismissedSession, setDismissedSession] = createSignal<string | null>(null)
  const [dismissedFingerprint, setDismissedFingerprint] = createSignal<string>("")

  const status = createMemo(() => (props.sessionID ? data.session.status(props.sessionID) : undefined))
  const messages = createMemo(() => (props.sessionID ? data.session.message.list(props.sessionID) : []))

  const loadDiff = async () => {
    const sid = props.sessionID
    if (!sid) {
      setFiles([])
      return
    }

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
        // session.diff may not have snapshots recorded yet; fallback to vcs
      }

      // 2. Fallback to vcs.diff("working")
      if (resolved.length === 0) {
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

      // Filter out empty file names
      resolved = resolved.filter((f) => f.file.trim().length > 0)
      setFiles(resolved)
    } catch {
      setFiles([])
    }
  }

  // React to status changes and message list updates in real time
  createEffect(() => {
    const sid = props.sessionID
    const s = status()
    const msgCount = messages().length
    if (sid) {
      void loadDiff()
    } else {
      setFiles([])
    }
  })

  // Listen to client events and polling fallback during active generation
  onMount(() => {
    void loadDiff()

    const unsub = client.event.listen((evt) => {
      const type = evt.type
      if (
        type.startsWith("session.") ||
        type.startsWith("message.") ||
        type.startsWith("tool.") ||
        type.startsWith("vcs.")
      ) {
        void loadDiff()
      }
    })

    const timer = setInterval(() => {
      if (props.sessionID && status() === "running") {
        void loadDiff()
      }
    }, 1500)

    onCleanup(() => {
      unsub()
      clearInterval(timer)
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

  const handleKeep = (e: MouseEvent) => {
    e.stopPropagation()
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

  const handleUndo = async (e: MouseEvent) => {
    e.stopPropagation()
    try {
      keymap.dispatch("session.undo")
      toast.show({
        variant: "info",
        message: "⏪ Revertendo alterações...",
        duration: 2500,
      })
      setTimeout(() => {
        void loadDiff()
      }, 600)
    } catch {
      // ignore
    }
  }

  const toggleExpand = (e: MouseEvent) => {
    e.stopPropagation()
    setExpanded((prev) => !prev)
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
              {files().length} {files().length === 1 ? "file changed" : "files changed"}
            </text>
            <text fg={RGBA.fromHex("#10B981")} attributes={TextAttributes.BOLD} selectable={false}>
              +{totalAdditions()}
            </text>
            <text fg={RGBA.fromHex("#F43F5E")} attributes={TextAttributes.BOLD} selectable={false}>
              -{totalDeletions()}
            </text>
          </box>

          {/* Action buttons: Keep and Undo */}
          <box flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
            <box
              backgroundColor={RGBA.fromHex("#0066FF")}
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={handleKeep}
            >
              <text fg={RGBA.fromHex("#FFFFFF")} attributes={TextAttributes.BOLD} selectable={false}>
                Keep
              </text>
            </box>
            <box
              backgroundColor={RGBA.fromHex("#1E293B")}
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={handleUndo}
            >
              <text fg={RGBA.fromHex("#E2E8F0")} attributes={TextAttributes.BOLD} selectable={false}>
                Undo
              </text>
            </box>
            <box
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={toggleExpand}
            >
              <text fg={RGBA.fromHex("#00F5FF")} attributes={TextAttributes.BOLD} selectable={false}>
                📄
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
                    {item.status === "added" ? "+" : item.status === "deleted" ? "-" : "~"}
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
