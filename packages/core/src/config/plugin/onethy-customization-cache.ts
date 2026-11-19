export * as OnethyCustomizationCache from "./onethy-customization-cache.js"

import path from "path"
import { Effect, Option, Schema } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Hash } from "@opencode/util/hash"

const memory = new Map<string, { readonly digest: string; readonly items: unknown }>()

const fingerprintDirectory = Effect.fnUntraced(function* (fs: FSUtil.Interface, directory: string) {
  const entries = yield* fs.readDirectoryEntries(directory).pipe(Effect.orElseSucceed(() => []))
  if (entries.length === 0) return [] as string[]
  if (entries.length > 64) {
    const dirMtime = yield* fs.stat(directory).pipe(
      Effect.map((info) => Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() })),
      Effect.orElseSucceed(() => 0),
    )
    return entries.map((entry) => `${directory}:${dirMtime}:${entry.type}:${entry.name}`)
  }
  return yield* Effect.forEach(
    entries,
    (entry) => {
      const target = path.join(directory, entry.name)
      const probe = entry.type === "directory" ? path.join(target, "SKILL.md") : target
      return fs.stat(probe).pipe(
        Effect.catch(() => (probe === target ? Effect.fail(undefined) : fs.stat(target))),
        Effect.map((info) => {
          const mtime = Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() })
          return `${directory}:${entry.type}:${entry.name}:${mtime}:${info.size}`
        }),
        Effect.orElseSucceed(() => `${directory}:${entry.type}:${entry.name}:0:0`),
      )
    },
    { concurrency: 64 },
  )
})

const fingerprint = Effect.fn("OnethyCustomizationCache.fingerprint")(function* (
  fs: FSUtil.Interface,
  directories: readonly string[],
) {
  const groups = yield* Effect.forEach(directories, (directory) => fingerprintDirectory(fs, directory), {
    concurrency: 8,
  })
  const stats = groups.flat()
  if (stats.length === 0) return undefined
  return Hash.fast(stats.toSorted().join("\n"))
})

export function cached<A, I, R = never>(options: {
  readonly fs: FSUtil.Interface
  readonly global?: Global.Interface
  readonly kind: "skills" | "agents" | "commands"
  readonly root: string
  readonly directories: readonly string[]
  readonly schema: Schema.Codec<A, I>
  readonly compute: Effect.Effect<readonly A[], never, R>
}): Effect.Effect<A[], never, R> {
  return Effect.gen(function* () {
    const global =
      options.global ?? Option.getOrElse(yield* Effect.serviceOption(Global.Service), () => Global.Path)
    if (process.env.OMNICODE_ACTIVE !== "1" || !FSUtil.contains(global.config, options.root)) {
      return [...(yield* options.compute)]
    }
    const digest = yield* fingerprint(options.fs, options.directories)
    if (!digest) return [...(yield* options.compute)]

    const key = `${options.kind}:${options.root}`
    const inMemory = memory.get(key)
    if (inMemory?.digest === digest && Array.isArray(inMemory.items)) {
      return [...(inMemory.items as A[])]
    }

    const envelope = Schema.fromJsonString(
      Schema.Struct({
        digest: Schema.String,
        items: Schema.Array(options.schema),
      }),
    )
    const file = path.join(global.cache, "onethy-index-v1", `${options.kind}-${Hash.fast(options.root)}.json`)
    const raw = yield* options.fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
    if (raw !== undefined) {
      const decoded = Schema.decodeUnknownOption(envelope)(raw)
      if (Option.isSome(decoded) && decoded.value.digest === digest) {
        memory.set(key, { digest, items: decoded.value.items })
        return [...decoded.value.items]
      }
    }

    const computed = [...(yield* options.compute)]
    memory.set(key, { digest, items: computed })
    const encoded = Schema.encodeUnknownOption(envelope)({ digest, items: computed })
    if (Option.isSome(encoded)) {
      yield* options.fs.writeWithDirs(file, encoded.value).pipe(Effect.ignore)
    }
    return computed
  })
}
