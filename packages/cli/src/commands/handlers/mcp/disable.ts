import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { perform } from "./shared"

export default Runtime.handler(
  Commands.commands.mcp.commands.disable,
  Effect.fn("cli.mcp.disable")((input) =>
    perform({ action: "disable", name: input.name, global: input.global }),
  ),
)
