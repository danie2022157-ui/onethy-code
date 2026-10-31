import { RGBA, TextAttributes, type MouseEvent } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useClient } from "../../context/client"
import { useData } from "../../context/data"
import { useTheme } from "../../context/theme"
import { Keymap } from "../../context/keymap"

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

  const [files, setFiles] = createSignal<readonly ChangedFile[]>([])
  const [expanded, setExpanded] = createSignal(false)
  const [dismissedSession, setDismissedSession] = createSignal<string | null>(null)
  const [dismissedCount, setDismissedCount] = createSignal<number>(0)

  const status = createMemo(() => (props.sessionID ? data.session.status(props.sessionID) : undefined))

  const loadDiff = async () => {
    if (!props.sessionID) {
      setFiles([])
      return
    }
    try {
      const rawList = await client.api.session.diff({ sessionID: props.sessionID })
      const list: ChangedFile[] = (rawList ?? []).map((item) => ({
        file: item.file ?? "",
        additions: typeof item.additions === "number" ? item.additions : 0,
        deletions: typeof item.deletions === "number" ? item.deletions : 0,
        status: item.status ?? "modified",
      }))
      setFiles(list)
    } catch {
      setFiles([])
    }
  }

  // Reload diff when session finishes running (becomes idle) or sessionID changes
  createEffect((prevStatus) => {
    const cur = status()
    if (props.sessionID) {
      if (prevStatus === "running" && cur === "idle") {
        void loadDiff()
      } else if (prevStatus === undefined) {
        void loadDiff()
      }
    } else {
      setFiles([])
    }
    return cur
  })

  const totalAdditions = createMemo(() => files().reduce((acc, f) => acc + f.additions, 0))
  const totalDeletions = createMemo(() => files().reduce((acc, f) => acc + f.deletions, 0))

  const visible = createMemo(() => {
    if (!props.sessionID || files().length === 0) return false
    if (dismissedSession() === props.sessionID && dismissedCount() === files().length) return false
    return true
  })

  const handleKeep = (e: MouseEvent) => {
    e.stopPropagation()
    if (props.sessionID) {
      setDismissedSession(props.sessionID)
      setDismissedCount(files().length)
    }
  }

  const handleUndo = (e: MouseEvent) => {
    e.stopPropagation()
    keymap.dispatch("session.undo")
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
        borderColor={RGBA.fromHex("#0099FF")}
        backgroundColor={theme.decrease(theme.background.raised.base)}
        marginBottom={1}
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
            <text fg={RGBA.fromHex("#00D2FF")} attributes={TextAttributes.BOLD} selectable={false}>
              {expanded() ? "▾" : "▸"}
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
              <text fg={RGBA.fromHex("#CBD5E1")} attributes={TextAttributes.BOLD} selectable={false}>
                Undo
              </text>
            </box>
            <box
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={toggleExpand}
            >
              <text fg={RGBA.fromHex("#38BDF8")} attributes={TextAttributes.BOLD} selectable={false}>
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
                          : RGBA.fromHex("#38BDF8")
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
