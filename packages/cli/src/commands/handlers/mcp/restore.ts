import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors } from "../../../ui/prompt"
import { confirmAction, perform } from "./shared"

export default Runtime.handler(
  Commands.commands.mcp.commands.restore,
  Effect.fn("cli.mcp.restore")((input) =>
    Effect.gen(function* () {
      const name = Option.getOrUndefined(input.name)
      if (input.all && name) return yield* Effect.fail(new Error("Use either an MCP name or --all, not both."))
      if (!input.all && !name)
        return yield* Effect.fail(new Error("Provide a native MCP name or use --all to restore all eight."))
      if (input.all) {
        const allowed = yield* confirmAction(
          "Restore all 8 native MCPs? This resets customized native definitions and removes overrides in the selected scope.",
          input.yes,
        )
        if (!allowed) return
      }
      yield* perform({ action: "restore", name: input.all ? "all" : name!, global: input.global })
    }).pipe(handlePromptErrors),
  ),
)
