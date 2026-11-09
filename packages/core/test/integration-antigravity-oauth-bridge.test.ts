import { createServer } from "node:net"
import type { AddressInfo } from "node:net"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Bus } from "@opencode/core/bus"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Integration.node, Credential.node, Bus.node])))

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

function oauthURL(port: number) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("state", "fake-state")
  url.searchParams.set("redirect_uri", `http://localhost:${port}/oauth-callback`)
  return url.toString()
}

function register(integrations: Integration.Interface, port: number) {
  const integrationID = Integration.ID.make("google")
  const methodID = Integration.MethodID.make("antigravity-oauth")
  return integrations.transform((editor) => editor.method.update({
    integrationID,
    method: { id: methodID, type: "oauth", label: "OAuth with Google (Antigravity)" },
    authorize: () => Effect.succeed({
      mode: "code" as const,
      url: oauthURL(port),
      instructions: "Paste redirected URL",
      callback: (callback: string) => {
        // The pinned plugin's v2 adapter expects the entire callback URL.
        const code = new URL(callback).searchParams.get("code")
        if (!code) return Effect.fail(new Error("Missing authorization code"))
        return Effect.succeed(Credential.OAuth.make({
          type: "oauth",
          methodID,
          access: "mock-access",
          refresh: "mock-refresh",
          expires: 42,
          metadata: { code },
        }))
      },
    }),
  }))
}

describe("Antigravity OAuth v2 integration bridge", () => {
  it.live("automatically completes the localhost callback and persists the returned credential", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("google")
      const methodID = Integration.MethodID.make("antigravity-oauth")
      const port = yield* Effect.promise(freePort)
      yield* register(integrations, port)
      const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
      expect(attempt.mode).toBe("auto")

      const response = yield* Effect.promise(() =>
        fetch(`http://127.0.0.1:${port}/oauth-callback?state=fake-state&code=fake-code`),
      )
      expect(response.status).toBe(200)
      let status = yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID })
      for (let i = 0; i < 100 && status.status === "pending"; i++) {
        yield* Effect.promise(() => Bun.sleep(20))
        status = yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID })
      }
      expect(status.status).toBe("complete")
      const stored = yield* credentials.list(integrationID)
      expect(stored[0]?.value).toMatchObject({
        type: "oauth",
        methodID,
        metadata: { code: "fake-code" },
      })
    }),
  )

  it.live("retains manual paste when the browser callback port is occupied", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("google")
      const methodID = Integration.MethodID.make("antigravity-oauth")
      const port = yield* Effect.promise(freePort)
      const blocking = createServer()
      yield* Effect.promise(() => new Promise<void>((resolve, reject) => {
        blocking.once("error", reject)
        blocking.listen(port, "127.0.0.1", resolve)
      }))
      try {
        yield* register(integrations, port)
        const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
        expect(attempt.mode).toBe("code")
        const manualURL = `http://localhost:${port}/oauth-callback?state=fake-state&code=manual-code`
        yield* integrations.oauth.complete({ integrationID, attemptID: attempt.attemptID, code: manualURL })
        expect((yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID })).status).toBe("complete")
      } finally {
        yield* Effect.promise(() => new Promise<void>((resolve) => blocking.close(() => resolve())))
      }
    }),
  )
})
