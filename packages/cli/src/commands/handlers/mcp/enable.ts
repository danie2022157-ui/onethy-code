import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { perform } from "./shared"

export default Runtime.handler(
  Commands.commands.mcp.commands.enable,
  Effect.fn("cli.mcp.enable")((input) =>
    perform({ action: "enable", name: input.name, global: input.global }),
  ),
)
