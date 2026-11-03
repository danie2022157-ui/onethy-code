import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog } from "./dialog"
import { RGBA, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { For, createMemo } from "solid-js"

interface ShortcutSection {
  title: string
  items: { key: string; description: string }[]
}

const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: "Navigation & Panes",
    items: [
      { key: "Alt+← / Alt+→", description: "Switch between session tabs" },
      { key: "Ctrl+1..9", description: "Jump directly to tab slot 1 to 9" },
      { key: "Alt+W", description: "Toggle focus between Session and Right pane" },
      { key: "Ctrl+B", description: "Toggle session sidebar" },
      { key: "Ctrl+T", description: "Toggle integrated terminal pane" },
      { key: "Alt+↑ / Alt+↓", description: "Navigate previous / next message in transcript" },
    ],
  },
  {
    title: "Session & Palette",
    items: [
      { key: "Ctrl+P / F1", description: "Open Command Palette" },
      { key: "Ctrl+N / Alt+N", description: "Create a new session" },
      { key: "Ctrl+O", description: "Open recent sessions and projects menu" },
      { key: "Ctrl+R", description: "Rename current session" },
      { key: "Ctrl+D", description: "Delete session / Close dialog" },
      { key: "Esc", description: "Interrupt current response / Close modal" },
    ],
  },
  {
    title: "Composer & Input",
    items: [
      { key: "Enter", description: "Submit prompt" },
      { key: "Shift+Enter", description: "Insert newline into composer" },
      { key: "Ctrl+C", description: "Clear composer input field" },
      { key: "/", description: "Trigger slash command autocomplete" },
      { key: "@", description: "Reference file or context attachment" },
    ],
  },
  {
    title: "OmniCode Workflows",
    items: [
      { key: "/omni", description: "Autonomous multi-agent orchestration" },
      { key: "/memory", description: "Persistent Memory Bank manager & editor" },
      { key: "/ulw", description: "UltraWork continuous turbo execution loop" },
      { key: "/arena", description: "Multi-model comparative benchmark" },
      { key: "/ralph", description: "Self-healing test and build runner" },
      { key: "/auto-customizations", description: "Configure proactive skills, agents, MCPs & hooks" },
    ],
  },
]

export function DialogHelp() {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const dimensions = useTerminalDimensions()
  const maxHeight = createMemo(() => Math.max(1, dimensions().height - 8))

  dialog.setSize("large")

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: "Close help", group: "Dialog", run: () => dialog.clear() },
      { bind: "escape", title: "Close help", group: "Dialog", run: () => dialog.clear() },
    ],
  }))

  return (
    <DialogLayout
      header={<DialogHeader title="Keyboard Shortcuts & Quick Help" closeLabel="esc / enter to close" />}
      footer={{
        actions: {
          primary: [
            {
              title: "Close [Enter]",
              key: "enter",
              onTrigger: () => dialog.clear(),
            },
          ],
        },
      }}
    >
      <scrollbox maxHeight={maxHeight()} flexDirection="column">
        <box flexDirection="column" gap={1}>
          <For each={SHORTCUT_SECTIONS}>
          {(section) => (
            <box flexDirection="column" gap={0}>
              <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                {section.title}
              </text>
              <box flexDirection="column" paddingLeft={1}>
                <For each={section.items}>
                  {(item) => (
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={RGBA.fromHex("#38BDF8")} attributes={TextAttributes.BOLD}>
                        {item.key}
                      </text>
                      <text fg={theme.text.muted}>{item.description}</text>
                    </box>
                  )}
                </For>
              </box>
            </box>
          )}
          </For>
        </box>
      </scrollbox>
    </DialogLayout>
  )
}
