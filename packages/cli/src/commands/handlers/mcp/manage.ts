import { intro, outro, select } from "@clack/prompts"
import { Effect } from "effect"
import { Global } from "@opencode/util/global"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, prompt, requireInteractive } from "../../../ui/prompt"
import { managedMcpList, type McpAction } from "../../../services/mcp-manager"
import { confirmAction, perform } from "./shared"

export default Runtime.handler(
  Commands.commands.mcp.commands.manage,
  Effect.fn("cli.mcp.manage")((input) =>
    Effect.gen(function* () {
      yield* requireInteractive("The MCP manager requires an interactive terminal. Use 'onethy mcp list' or the enable/disable/remove/restore commands.")
      intro("OnethyCode • MCP Manager")
      const global = yield* Global.Service
      const items = yield* Effect.promise(() => managedMcpList(process.cwd(), global.config))
      const name = yield* prompt<string>(() => select({
        message: "Which MCP server would you like to manage?",
        options: items.map(item => ({
          value: item.name,
          label: item.name,
          hint: [
            item.kind === "native" ? "native" : "custom",
            !item.present ? "not installed" : item.enabled === true ? "enabled" : item.enabled === false ? "disabled" : "not explicitly enabled",
            item.location === "global" ? "global" : item.location === "project" ? "project" : "restorable",
          ].join(" • "),
        })),
      }))
      const item = items.find(entry => entry.name === name)!
      const actions: Array<{value: McpAction; label: string; hint: string}> = []
      if (item.present) {
        actions.push({ value: "enable", label: "Enable", hint: "Allows the server to start" })
        actions.push({ value: "disable", label: "Disable", hint: "Keeps settings and files" })
        actions.push({ value: "remove", label: "Delete", hint: "Removes from the selected scope" })
      }
      if (item.kind === "native") actions.push({
        value: "restore", label: "Restore native defaults", hint: "Restores the original disabled template",
      })
      const action = yield* prompt<McpAction>(() => select({
        message: "What would you like to do?",
        options: actions,
      }))
      const actionGlobal = input.global || ((action === "remove" || action === "restore") && item.location === "global")
      if (action === "remove" || action === "restore") {
        const ok = yield* confirmAction(
          action === "remove"
            ? `Delete MCP "${name}" from the ${actionGlobal ? "global" : "project"}?`
            : `Restore original configuration for "${name}" and reset authorization in this scope?`,
          false,
        )
        if (!ok) {
          outro("No changes were made.")
          return
        }
      }
      yield* perform({ action, name, global: actionGlobal })
      outro("Configuration saved. Check connectivity with: onethy mcp doctor")
    }).pipe(handlePromptErrors),
  ),
)
