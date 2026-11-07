import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { OPENCODE_CHANNEL } from "../../../version"
import { logPath, filterLines, readBytes, readLogs } from "@opencode/util/observability/log-view"

export default Runtime.handler(
  Commands.commands.debug.commands.logs,
  Effect.fn("cli.debug.logs")(function* (input) {
    const file = logPath(OPENCODE_CHANNEL)
    const filter = {
      source: input.source,
      level: input.level,
      search: input.search,
      lines: Math.max(1, Math.min(500, input.lines)),
    } as const
    const initial = yield* Effect.promise(() => readLogs(file, filter))
    process.stdout.write((initial.length ? initial.join("\n") : "Sem logs correspondentes no arquivo: " + file) + "\n")
    if (!input.follow) return

    let offset = (yield* Effect.promise(() => readBytes(file, 0, true))).offset
    let partial = ""
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
    try {
      while (!controller.signal.aborted) {
        yield* Effect.promise(() => new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer)
            controller.signal.removeEventListener("abort", finish)
            resolve()
          }
          const timer = setTimeout(finish, 750)
          controller.signal.addEventListener("abort", finish, { once: true })
        }))
        if (controller.signal.aborted) break
        const chunk = yield* Effect.promise(() => readBytes(file, offset))
        if (chunk.offset < offset || chunk.truncated) partial = ""
        offset = chunk.offset
        if (!chunk.text) continue
        const next = (partial + chunk.text).split(/\r?\n/)
        // A bounded read can begin halfway through a line: never print an
        // unredactable fragment of an earlier sensitive field.
        if (chunk.truncated) next.shift()
        partial = next.pop() ?? ""
        const selected = filterLines(next, { ...filter, lines: 500 })
        if (selected.length) process.stdout.write(selected.join("\n") + "\n")
      }
    } finally {
      process.off("SIGINT", stop)
      process.off("SIGTERM", stop)
    }
  }),
)
