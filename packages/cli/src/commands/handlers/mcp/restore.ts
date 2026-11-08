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
      if (input.all && name) return yield* Effect.fail(new Error("Use um nome ou --all, não ambos."))
      if (!input.all && !name)
        return yield* Effect.fail(new Error("Informe um MCP nativo ou use --all para restaurar os oito."))
      if (input.all) {
        const allowed = yield* confirmAction(
          "Restaurar os 8 MCPs nativos? Isto redefine definições nativas personalizadas e remove overrides nesse escopo.",
          input.yes,
        )
        if (!allowed) return
      }
      yield* perform({ action: "restore", name: input.all ? "all" : name!, global: input.global })
    }).pipe(handlePromptErrors),
  ),
)
