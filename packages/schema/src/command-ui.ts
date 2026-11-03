export * as CommandUi from "./command-ui.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export interface Shortcut extends Schema.Schema.Type<typeof Shortcut> {}
export const Shortcut = Schema.Struct({
  macos: Schema.String.pipe(optional),
  windows: Schema.String.pipe(optional),
  linux: Schema.String.pipe(optional),
}).annotate({ identifier: "CommandUi.Shortcut" })

export interface Descriptor extends Schema.Schema.Type<typeof Descriptor> {}
export const Descriptor = Schema.Struct({
  id: Schema.String,
  titleKey: Schema.String,
  descriptionKey: Schema.String.pipe(optional),
  tuiId: Schema.String.pipe(optional),
  appId: Schema.String.pipe(optional),
  desktopAction: Schema.String.pipe(optional),
  shortcuts: Shortcut.pipe(optional),
  surfaces: Schema.Array(Schema.Literals(["tui", "web", "desktop"])).pipe(optional),
}).annotate({ identifier: "CommandUi.Descriptor" })

export const CANONICAL_COMMANDS = [
  {
    id: "sidebar.toggle",
    titleKey: "command.sidebar.toggle",
    tuiId: "session.sidebar.toggle",
    appId: "sidebar.toggle",
    desktopAction: "sidebar.toggle",
    shortcuts: { macos: "Cmd+B", windows: "Ctrl+B", linux: "Ctrl+B" },
    surfaces: ["tui", "web", "desktop"],
  },
  {
    id: "session.new",
    titleKey: "command.session.new",
    tuiId: "session.new",
    appId: "session.new",
    shortcuts: { macos: "Cmd+N", windows: "Ctrl+N", linux: "Ctrl+N" },
    surfaces: ["tui", "web"],
  },
  {
    id: "window.next",
    titleKey: "command.window.next",
    desktopAction: "window.next",
    shortcuts: { macos: "Cmd+Shift+`", windows: "Ctrl+Shift+`" },
    surfaces: ["desktop"],
  },
] as const satisfies readonly Descriptor[]
