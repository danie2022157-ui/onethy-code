export * as OmniPath from "./omni-path.js"

import fs from "node:fs"
import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { Location } from "./location.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"

export interface OmniPathInterface {
  readonly resolve: (target: string) => Effect.Effect<string, PathTraversalError>
  readonly isInsideWorkspace: (target: string) => Effect.Effect<boolean, never>
}

export class Service extends Context.Service<Service, OmniPathInterface>()("@opencode/OmniPath") {}

export class PathTraversalError extends Error {
  constructor(
    readonly target: string,
    readonly resolved: string,
    readonly workspace: string,
  ) {
    super(`Omni path traversal blocked: '${target}' resolves to '${resolved}', outside workspace '${workspace}'.`)
    this.name = "PathTraversalError"
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const workspace = location.directory ?? location.project.canonical ?? location.project.directory
    const canonicalWorkspace = location.project.canonical ?? (yield* Effect.promise(() => fs.promises.realpath(workspace)))

    const resolveImpl = Effect.fn("OmniPath.resolve")(function* (target: string) {
      const resolved = path.resolve(canonicalWorkspace, target)

      let canonicalTarget: string
      try {
        canonicalTarget = yield* Effect.promise(() => fs.promises.realpath(resolved))
      } catch {
        canonicalTarget = resolveNearestExisting(resolved, canonicalWorkspace)
      }

      const relative = path.relative(canonicalWorkspace, canonicalTarget)
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return yield* Effect.fail(new PathTraversalError(target, resolved, canonicalWorkspace))
      }

      return resolved
    })

    const resolve: (target: string) => Effect.Effect<string, PathTraversalError> = resolveImpl

    const isInsideWorkspaceImpl = Effect.fn("OmniPath.isInsideWorkspace")(function* (target: string) {
      return yield* resolve(target).pipe(
        Effect.map(() => true),
        Effect.catchCause(() => Effect.succeed(false)),
      )
    })

    const isInsideWorkspace: (target: string) => Effect.Effect<boolean, never> = isInsideWorkspaceImpl

    return Service.of({ resolve, isInsideWorkspace })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node],
})

function resolveNearestExisting(resolved: string, workspace: string): string {
  let current = resolved
  let parent = path.dirname(current)
  while (parent !== current && parent.startsWith(workspace)) {
    try {
      fs.realpathSync(parent)
      break
    } catch {
      current = parent
      parent = path.dirname(current)
    }
  }
  return current
}
