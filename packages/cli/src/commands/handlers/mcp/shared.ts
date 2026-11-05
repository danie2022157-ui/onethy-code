import { EOL } from "node:os"
import { confirm } from "@clack/prompts"
import { Effect } from "effect"
import { Global } from "@opencode/util/global"
import { prompt, requireInteractive } from "../../../ui/prompt"
import { manageMcp, type McpAction } from "../../../services/mcp-manager"

export const perform = Effect.fn("cli.mcp.perform")(function* (input: {
  action: McpAction
  name: string
  global: boolean
}) {
  const global = yield* Global.Service
  const message = yield* Effect.promise(() => manageMcp({
    ...input,
    cwd: process.cwd(),
    globalRoot: global.config,
  }))
  process.stdout.write(message + EOL)
})

export const confirmAction = Effect.fn("cli.mcp.confirm")(function* (message: string, yes: boolean) {
  if (yes) return true
  yield* requireInteractive("Confirmation required. Use --yes in a non-interactive terminal.")
  return yield* prompt<boolean>(() => confirm({ message }))
})
