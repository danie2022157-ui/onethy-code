import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog } from "./dialog"
import { RGBA, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { For, createMemo } from "solid-js"

const SHORTCUT_SECTIONS = [
  {
    title: "Navigation & Panes",
    items: [
      { id: "session.tab.previous", description: "Previous session tab" },
      { id: "session.tab.next", description: "Next session tab" },
      { id: "session.quick_switch.1", description: "Switch to quick session slot 1" },
      { id: "session.quick_switch.2", description: "Switch to quick session slot 2" },
      { id: "session.quick_switch.3", description: "Switch to quick session slot 3" },
      { id: "session.quick_switch.4", description: "Switch to quick session slot 4" },
      { id: "session.quick_switch.5", description: "Switch to quick session slot 5" },
      { id: "session.quick_switch.6", description: "Switch to quick session slot 6" },
      { id: "session.quick_switch.7", description: "Switch to quick session slot 7" },
      { id: "session.quick_switch.8", description: "Switch to quick session slot 8" },
      { id: "session.quick_switch.9", description: "Switch to quick session slot 9" },
      { id: "session.tab.select.1", description: "Switch to tab 1" },
      { id: "session.tab.select.2", description: "Switch to tab 2" },
      { id: "session.tab.select.3", description: "Switch to tab 3" },
      { id: "session.tab.select.4", description: "Switch to tab 4" },
      { id: "session.tab.select.5", description: "Switch to tab 5" },
      { id: "session.tab.select.6", description: "Switch to tab 6" },
      { id: "session.tab.select.7", description: "Switch to tab 7" },
      { id: "session.tab.select.8", description: "Switch to tab 8" },
      { id: "session.tab.select.9", description: "Switch to tab 9" },
      { id: "session.tab.select.10", description: "Switch to tab 10" },
      { id: "pane.focus.left", description: "Focus session pane" },
      { id: "pane.focus.right", description: "Focus right pane" },
      { id: "session.sidebar.toggle", description: "Toggle sidebar" },
      { id: "terminal.toggle", description: "Toggle terminal pane" },
      { id: "session.message.previous", description: "Previous message" },
      { id: "session.message.next", description: "Next message" },
    ],
  },
  {
    title: "Session & Palette",
    items: [
      { id: "command.palette.show", description: "Open command palette" },
      { id: "session.new", description: "Create a new session" },
      { id: "open.menu", description: "Open recent sessions and projects" },
      { id: "session.rename", description: "Rename current session" },
      { id: "session.delete", description: "Delete current session" },
      { id: "session.interrupt", description: "Interrupt current response" },
    ],
  },
  {
    title: "Composer & Input",
    items: [
      { id: "input.submit", description: "Submit prompt" },
      { id: "input.newline", description: "Insert newline" },
      { id: "prompt.clear", description: "Clear composer" },
    ],
  },
]

export function DialogHelp() {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const dimensions = useTerminalDimensions()
  const shortcuts = Keymap.useShortcuts()
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
                    {(item) => {
                      const key = shortcuts.get(item.id) ?? "—"
                      return (
                        <box flexDirection="row" justifyContent="space-between">
                          <text fg={RGBA.fromHex("#38BDF8")} attributes={TextAttributes.BOLD}>
                            {key}
                          </text>
                          <text fg={theme.text.muted}>{item.description}</text>
                        </box>
                      )
                    }}
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
