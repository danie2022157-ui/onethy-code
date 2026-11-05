import { For } from "solid-js"
import { useDialog, DialogHeader, DialogLayout } from "../ui/dialog"
import { useTheme } from "../context/theme"
import type { DesktopReportRow } from "./desktop-report"

/** A read-only, scrollable report: status must remain visible with classic/new TUI designs. */
export function DialogDesktopReport(props: { title: string; rows: readonly DesktopReportRow[] }) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const valueColor = (severity: DesktopReportRow["severity"]) => {
    if (severity === "success") return theme.text.feedback.success.base
    if (severity === "warning") return theme.text.feedback.warning.base
    if (severity === "error") return theme.text.feedback.error.base
    return theme.text.base
  }

  return (
    <DialogLayout header={<DialogHeader title={props.title} onClose={() => dialog.pop()} />}>
      <box flexDirection="column" gap={1}>
        <scrollbox maxHeight={18} scrollbarOptions={{ visible: true }}>
          <box flexDirection="column" gap={1} paddingRight={1}>
            <For each={props.rows}>
              {(row) => (
                <box flexDirection="column">
                  <text fg={theme.text.muted} wrapMode="word">{row.label}</text>
                  <text fg={valueColor(row.severity)} wrapMode="word">{row.value}</text>
                </box>
              )}
            </For>
          </box>
        </scrollbox>
        <text fg={theme.text.muted} onMouseUp={() => dialog.pop()}>Back (Esc)</text>
      </box>
    </DialogLayout>
  )
}
