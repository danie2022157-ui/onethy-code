export * as DesktopControlTool from "./desktop-control.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Permission } from "../../permission.js"
import { buildDesktopInvocation, formatDesktopResult, runAgentDesktop, actions } from "../../agent-desktop.js"

export const name = "desktop_control"

export const Input = Schema.Struct({
  action: Schema.Literals(actions).annotate({
    description: "Desktop action. Start with status, list-apps, list-windows, and snapshot; use qualified refs for element actions.",
  }),
  app: Schema.optionalKey(Schema.String).annotate({
    description: "App name. Required for window snapshots unless windowId is specified.",
  }),
  windowId: Schema.optionalKey(Schema.String).annotate({
    description: "Window ID returned by list-windows.",
  }),
  ref: Schema.optionalKey(Schema.String).annotate({
    description: "Qualified element reference from the latest snapshot (for example @s123:e8).",
  }),
  text: Schema.optionalKey(Schema.String).annotate({
    description: "Text to type or set. Passed through stdin, never as a command-line argument.",
  }),
  query: Schema.optionalKey(Schema.String).annotate({
    description: "Text query for find.",
  }),
  role: Schema.optionalKey(Schema.String).annotate({ description: "Accessibility role filter for find." }),
  name: Schema.optionalKey(Schema.String).annotate({ description: "Accessible element name filter for find." }),
  keys: Schema.optionalKey(Schema.String).annotate({ description: "Keyboard shortcut such as ctrl+s or shift+tab." }),
  value: Schema.optionalKey(Schema.String).annotate({ description: "Selection value for select." }),
  property: Schema.optionalKey(Schema.String).annotate({ description: "Property for get/is (e.g. text or enabled)." }),
  direction: Schema.optionalKey(Schema.Literals(["up", "down", "left", "right"])),
  amount: Schema.optionalKey(Schema.Number),
  waitMs: Schema.optionalKey(Schema.Number),
  headed: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Allow physical mouse/keyboard interaction and focus changes where the OS requires it.",
  }),
})

export const Output = Schema.Struct({
  action: Schema.String,
  summary: Schema.String,
})

export const description = [
  "First-party OnethyCode desktop computer-use tool, backed by the open-source vercel-labs/agent-desktop native accessibility engine.",
  "Controls GUI applications on the SAME machine running the OnethyCode server (Windows, macOS or Linux); it cannot remotely control the user's computer from a hosted server.",
  "Start with status to check availability and OS accessibility permissions. List apps/windows, then take a scoped snapshot and use its qualified refs for click, type, select, scroll and other UI actions.",
  "Use an updated snapshot after a UI change; stale refs must never be guessed or silently reused.",
  "All desktop observation and action calls require normal OnethyCode session permissions, except basic status, version and permissions checks.",
  "Never inspect unrelated apps or private content without user authorization. Verify visible state after actions. Do not claim a task completed based solely on a successful click.",
  "Requires the local agent-desktop runtime. When unavailable, install it on the host (npm install -g agent-desktop) and run status again.",
  "No API key, external hosted desktop service, VS Code extension, or separate MCP server is required.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.desktop_control",
  effect: Effect.fn("DesktopControlTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    yield* ctx.tool.transform((editor) => {
      if (process.env.OMNICODE_ACTIVE !== "1" && process.env.ONETHY_ACTIVE !== "1") return
      editor.add({
        name,
        options: { codemode: false },
        description,
        input: Input,
        output: Output,
        execute: (params, context) => Effect.gen(function* () {
          const invocation = yield* Effect.try({
            try: () => buildDesktopInvocation(params),
            catch: (error) => new ToolFailure({ message: "Invalid desktop operation: " + String(error) }),
          })
          if (invocation.requiresApproval) {
            yield* permission.assert({
              action: "desktop_control",
              resources: [invocation.resource],
              sessionID: context.sessionID,
              agent: context.agent,
              source: { type: "tool", messageID: context.messageID, id: context.id },
            }).pipe(Effect.mapError((error) =>
              new ToolFailure({ message: "Desktop access was not approved by session permissions.", error })))
          }
          const result = yield* Effect.tryPromise({
            try: () => runAgentDesktop(invocation),
            catch: (error) => new ToolFailure({ message: String(error) }),
          })
          const summary = formatDesktopResult(result, params.action)
          return {
            output: { action: params.action, summary },
            content: summary,
            metadata: { action: params.action, permissionResource: invocation.resource },
          }
        }),
      })
    }).pipe(Effect.asVoid)
  }),
}
