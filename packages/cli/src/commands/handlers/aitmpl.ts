import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"

export default Runtime.handler(
  Commands.commands.aitmpl,
  Effect.fn("cli.aitmpl")(function* (input) {
    const { syncAITmpl } = yield* Effect.promise(() => import("../../services/aitmpl-native.mjs"))
    const report = yield* Effect.tryPromise(() =>
      syncAITmpl({
        install: input.install,
        global: input.global,
        type: input.type,
        sourceDir: Option.getOrUndefined(input.sourceDir),
      }),
    )
    process.stdout.write(JSON.stringify(report, null, 2) + "\n")
    if (report.pending) {
      process.stdout.write("ATENÇÃO: MCPs, settings, hooks, mods e loops foram inventariados, não ativados.\n")
    }
    if (report.rejected || report.errors.length) process.exitCode = 1
  }),
)
