import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors } from "../../../ui/prompt"
import { confirmAction, perform } from "./shared"

export default Runtime.handler(
  Commands.commands.mcp.commands.remove,
  Effect.fn("cli.mcp.remove")((input) =>
    Effect.gen(function* () {
      const allowed = yield* confirmAction(
        `Delete MCP "${input.name}" from the ${input.global ? "global" : "project"}?`,
        input.yes,
      )
      if (!allowed) return
      yield* perform({ action: "remove", name: input.name, global: input.global })
    }).pipe(handlePromptErrors),
  ),
)
