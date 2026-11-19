export * as SkillScan from "./skill-scan.js"

import { FSUtil } from "@opencode/util/fs-util"
import path from "path"
import { Effect } from "effect"

const MAX_DEPTH = 6

export const ignore = [...FSUtil.ignoreGlobs, "**/.*", "**/.*/**"]

export const scan = Effect.fn("SkillScan.scan")(function* (root: string) {
  const fs = yield* FSUtil.Service
  const rootName = path.basename(root).toLowerCase()
  const isExtraCustomizationDir =
    process.env.OMNICODE_ACTIVE === "1" && ["mods", "plugins", "hooks", "settings"].includes(rootName)
  const scanLevel = (directories: readonly string[], depth: number): Effect.Effect<string[]> =>
    Effect.forEach(
      directories,
      (directory) =>
        Effect.gen(function* () {
          const entries = yield* fs.readDirectoryEntries(directory).pipe(Effect.orElseSucceed(() => []))
          const children = yield* Effect.forEach(
            entries.filter((entry) => !entry.name.startsWith(".") && !FSUtil.ignoredDirectories.includes(entry.name)),
            (entry) => {
              const target = path.join(directory, entry.name)
              if (entry.type !== "symlink") return Effect.succeed({ name: entry.name, path: target, type: entry.type })
              return fs.stat(target).pipe(
                Effect.map((info) =>
                  info.type === "Directory" ? "directory" : info.type === "File" ? "file" : "other",
                ),
                Effect.orElseSucceed(() => "other" as const),
                Effect.map((type) => ({ name: entry.name, path: target, type })),
              )
            },
          )
          const skill = children.find((child) => child.type === "file" && child.name === "SKILL.md")
          if (skill) return { files: [skill.path], next: [] as string[] }
          const markdownFiles =
            depth === 0
              ? children
                  .filter((child) => child.type === "file" && child.name.endsWith(".md"))
                  .map((child) => child.path)
              : []
          const jsonFiles = isExtraCustomizationDir
            ? children
                .filter(
                  (child) =>
                    child.type === "file" &&
                    child.name.endsWith(".json") &&
                    child.name !== "HOOK_PATTERNS_COMPRESSED.json" &&
                    child.name !== "tsconfig.json" &&
                    child.name !== "marketplace.json",
                )
                .map((child) => child.path)
            : []
          const next =
            depth < MAX_DEPTH
              ? children.filter((child) => child.type === "directory").map((child) => child.path)
              : []
          return { files: [...markdownFiles, ...jsonFiles], next }
        }),
      { concurrency: 32 },
    ).pipe(
      Effect.flatMap((results) => {
        const files = results.flatMap((item) => item.files)
        const next = results.flatMap((item) => item.next)
        if (next.length === 0) return Effect.succeed(files)
        return scanLevel(next, depth + 1).pipe(Effect.map((nested) => [...files, ...nested]))
      }),
    )
  return (yield* scanLevel([root], 0)).toSorted()
})
