import { expect, setDefaultTimeout } from "bun:test"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { Session } from "@opencode/core/session"
import { Snapshot } from "@opencode/core/snapshot"
import { AbsolutePath } from "@opencode/schema/schema"
import { join } from "node:path"
import { $ } from "bun"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

setDefaultTimeout(30_000)

it.live("lists and decides session review decisions through endpoint", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-session-review-")))
    yield* Effect.promise(async () => {
      await $`git init -q`.cwd(tmp.path).quiet()
      await $`git config user.email test@opencode.test`.cwd(tmp.path).quiet()
      await $`git config user.name Test`.cwd(tmp.path).quiet()
      await Bun.write(join(tmp.path, "README.md"), "# hello\n")
      await Bun.write(join(tmp.path, "file.txt"), "initial\n")
      await $`git add .`.cwd(tmp.path).quiet()
      await $`git commit -m initial`.cwd(tmp.path).quiet()
    })

    const context = yield* Layer.build(
      createRoutes({
        app: { version: "test-version" },
        database: { path: ":memory:" },
        fs: { filewatcher: false },
        models: { fetch: false },
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const request = (path: string, init?: RequestInit) =>
      Effect.promise(async () => {
        const response = await handler(new Request(`http://opencode.local${path}`, init))
        return { status: response.status, body: (await response.json()) as Record<string, unknown> }
      })
    const put = (path: string, body: unknown) =>
      request(path, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })

    const created = yield* request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: tmp.path } }),
    })
    expect(created.status).toBe(200)
    const sessionID = Session.ID.make((created.body.data as { id: string }).id)
    const reviewPath = `/api/experimental/session/${sessionID}/review`
    expect(yield* request(reviewPath)).toEqual({ status: 200, body: { data: [] } })

    const location = LocationServiceMap.canonical(Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }))
    const locations = Context.get(context, LocationServiceMap.Service)
    const locationLayer = locations.get(location)
    const startSnapshot = yield* Snapshot.Service.use((snapshot) => snapshot.capture()).pipe(
      Effect.provide(locationLayer),
      Effect.orDie,
    )
    if (!startSnapshot) throw new Error("Failed to capture start snapshot")
    yield* Effect.promise(() => Bun.write(join(tmp.path, "file.txt"), "modified\n"))
    const endSnapshot = yield* Snapshot.Service.use((snapshot) => snapshot.capture()).pipe(
      Effect.provide(locationLayer),
      Effect.orDie,
    )
    if (!endSnapshot) throw new Error("Failed to capture end snapshot")

    const decision = {
      file: "file.txt",
      decision: "keep",
      startSnapshot,
      endSnapshot,
    }
    const keepResp = yield* put(reviewPath, decision)
    expect(keepResp.status).toBe(200)
    expect(keepResp.body.data).toMatchObject({ file: "file.txt", status: "keep", version: 1 })

    const listed = yield* request(reviewPath)
    expect(listed.status).toBe(200)
    expect(listed.body.data).toEqual([expect.objectContaining({ file: "file.txt", status: "keep", version: 1 })])

    const staleResp = yield* put(reviewPath, { ...decision, decision: "reject", expectVersion: 99 })
    expect(staleResp.status).toBe(409)
    expect(staleResp.body._tag).toBe("ConflictError")

    const unknownResp = yield* request(`/api/experimental/session/${Session.ID.make("ses_unknown_review")}/review`)
    expect(unknownResp.status).toBe(404)
    expect(unknownResp.body._tag).toBe("SessionNotFoundError")
  }),
)
