export * as WorktreeDirectory from "./directory.js"

import { Effect, Schema } from "effect"
import fs from "node:fs/promises"
import { FSUtil } from "@opencode/util/fs-util"
import { AbsolutePath } from "../schema.js"

export class DirectoryUnavailableError extends Schema.TaggedError<DirectoryUnavailableError>()(
  "Worktree.DirectoryUnavailableError",
  { directory: AbsolutePath },
) {}

export const canonical = Effect.fnUntraced(function* (fs: FSUtil.Interface, input: AbsolutePath) {
  const resolved = AbsolutePath.make(yield* fs.resolve(input))
  if (!(yield* fs.isDir(resolved))) return yield* new DirectoryUnavailableError({ directory: input })
  return resolved
})

/**
 * Only an OS-confirmed ENOENT counts as absent. A dangling symlink, a file,
 * an inaccessible volume and an EACCES failure must not trigger stale cleanup.
 */
export const confirmedMissing = Effect.fnUntraced(function* (directory: AbsolutePath) {
  return yield* Effect.promise(() =>
    fs.lstat(directory).then(
      () => false,
      (error: unknown) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT",
    ),
  )
})
