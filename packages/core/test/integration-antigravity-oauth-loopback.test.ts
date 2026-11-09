import { createServer } from "node:net"
import type { AddressInfo } from "node:net"
import { describe, expect, test } from "bun:test"
import { openAntigravityOAuthCallback } from "../src/integration/antigravity-oauth-loopback"

async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

function authorization(port: number, state = "expected-oauth-state") {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("state", state)
  url.searchParams.set("redirect_uri", `http://localhost:${port}/oauth-callback`)
  return url.toString()
}

describe("Antigravity OAuth loopback", () => {
  test("captures a valid Google callback after rejecting mismatched state", async () => {
    const port = await freePort()
    const listener = await openAntigravityOAuthCallback(authorization(port))
    expect(listener).toBeDefined()
    try {
      const wrong = await fetch(`http://127.0.0.1:${port}/oauth-callback?state=wrong&code=ignored`)
      expect(wrong.status).toBe(400)
      const missing = await fetch(`http://127.0.0.1:${port}/oauth-callback?state=expected-oauth-state`)
      expect(missing.status).toBe(400)
      const valid = await fetch(`http://127.0.0.1:${port}/oauth-callback?state=expected-oauth-state&code=mock-code`)
      expect(valid.status).toBe(200)
      const callback = new URL(await listener!.waitForCallback())
      expect(callback.searchParams.get("code")).toBe("mock-code")
    } finally {
      await listener!.close()
    }
  })

  test("reports denied permission without returning an authorization code", async () => {
    const port = await freePort()
    const listener = await openAntigravityOAuthCallback(authorization(port))
    expect(listener).toBeDefined()
    try {
      const failed = listener!.waitForCallback().catch((error: Error) => error.message)
      const response = await fetch(`http://127.0.0.1:${port}/oauth-callback?state=expected-oauth-state&error=access_denied`)
      expect(response.status).toBe(400)
      expect(await failed).toContain("cancelled or denied")
    } finally {
      await listener!.close()
    }
  })

  test("rejects unsupported redirects rather than binding an arbitrary port", async () => {
    expect(await openAntigravityOAuthCallback("https://example.com")).toBeUndefined()
    const forged = new URL(authorization(51121))
    forged.searchParams.set("redirect_uri", "http://external.example:51121/oauth-callback")
    expect(await openAntigravityOAuthCallback(forged.toString())).toBeUndefined()
  })

  test("fails safely when another process owns the callback port", async () => {
    const port = await freePort()
    const blocker = createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject)
      blocker.listen(port, "127.0.0.1", resolve)
    })
    try {
      await expect(openAntigravityOAuthCallback(authorization(port))).rejects.toMatchObject({ code: "EADDRINUSE" })
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })

  test("closes its server and pending callback when the OAuth attempt is cancelled", async () => {
    const port = await freePort()
    const listener = await openAntigravityOAuthCallback(authorization(port))
    expect(listener).toBeDefined()
    const failed = listener!.waitForCallback().catch((error: Error) => error.message)
    await listener!.close()
    expect(await failed).toContain("closed before callback")
    await listener!.close()
  })
})
