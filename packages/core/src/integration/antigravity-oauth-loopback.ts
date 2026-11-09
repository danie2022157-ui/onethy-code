import { createServer, type RequestListener, type Server } from "node:http"

/** The Antigravity OAuth integration is the only caller of this loopback listener. */
export interface AntigravityOAuthListener {
  waitForCallback(): Promise<string>
  close(): Promise<void>
}

function target(authorizationURL: string) {
  let authorization: URL
  let redirect: URL
  try {
    authorization = new URL(authorizationURL)
    if (authorization.protocol !== "https:" || authorization.hostname !== "accounts.google.com") return
    const raw = authorization.searchParams.get("redirect_uri")
    if (!raw) return
    redirect = new URL(raw)
  } catch {
    return
  }
  const state = authorization.searchParams.get("state")
  const port = Number(redirect.port)
  if (
    !state || redirect.protocol !== "http:" || redirect.hostname !== "localhost" ||
    redirect.pathname !== "/oauth-callback" || redirect.username || redirect.password ||
    redirect.search || redirect.hash || !Number.isInteger(port) || port < 1 || port > 65535
  ) return
  return { state, port, path: redirect.pathname }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (cause: Error) => {
      server.off("listening", ready)
      reject(cause)
    }
    const ready = () => {
      server.off("error", failed)
      resolve()
    }
    server.once("error", failed)
    server.once("listening", ready)
    server.listen(port, host)
  })
}

function stop(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve()
    server.close(() => resolve())
  })
}

/**
 * Converts the pinned plugin's manual, localhost-redirect OAuth into a local
 * callback without modifying its token exchange or account storage.
 *
 * Bind only to loopback IPv4/IPv6. An unknown redirect remains a manual flow.
 * No token, state or callback URL is logged or sent anywhere by this listener.
 */
export async function openAntigravityOAuthCallback(authorizationURL: string): Promise<AntigravityOAuthListener | undefined> {
  const expected = target(authorizationURL)
  if (!expected) return
  let settled = false
  let closed = false
  let resolveCallback!: (url: string) => void
  let rejectCallback!: (reason: Error) => void
  const callback = new Promise<string>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })
  // Cancellation may happen before the auto-mode fiber starts awaiting.
  void callback.catch(() => {})

  const servers: Server[] = []
  const handler: RequestListener = (request, response) => {
    response.setHeader("Cache-Control", "no-store")
    response.setHeader("Referrer-Policy", "no-referrer")
    response.setHeader("Content-Type", "text/plain; charset=utf-8")
    response.setHeader("Connection", "close")
    if (request.method !== "GET" || !request.url) {
      response.writeHead(405).end("Method not allowed")
      return
    }
    if (![ `localhost:${expected.port}`, `127.0.0.1:${expected.port}`, `[::1]:${expected.port}` ].includes(request.headers.host ?? "")) {
      response.writeHead(400).end("Invalid callback host")
      return
    }
    const incoming = new URL(request.url, `http://localhost:${expected.port}`)
    if (incoming.pathname !== expected.path) {
      response.writeHead(404).end("Not found")
      return
    }
    if (settled) {
      response.writeHead(410).end("Authorization already received")
      return
    }
    if (incoming.searchParams.get("state") !== expected.state) {
      response.writeHead(400).end("Invalid OAuth state")
      return
    }
    const error = incoming.searchParams.get("error")
    const code = incoming.searchParams.get("code")
    if (!error && !code) {
      response.writeHead(400).end("Missing authorization result")
      return
    }
    settled = true
    if (error) {
      response.writeHead(400).end("Google authorization was not completed. Return to OnethyCode.")
      rejectCallback(new Error("Google authorization was cancelled or denied"))
      return
    }
    response.writeHead(200).end("Authorization received. Return to OnethyCode to confirm the connection.")
    resolveCallback(incoming.toString())
  }

  const ipv4 = createServer(handler)
  try {
    await listen(ipv4, expected.port, "127.0.0.1")
    servers.push(ipv4)
    const ipv6 = createServer(handler)
    try {
      await listen(ipv6, expected.port, "::1")
      servers.push(ipv6)
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException)?.code
      if (code !== "EAFNOSUPPORT" && code !== "EADDRNOTAVAIL") throw cause
    }
  } catch (cause) {
    await Promise.all(servers.map(stop))
    throw cause
  }

  return {
    waitForCallback: () => callback,
    close: async () => {
      if (closed) return
      closed = true
      if (!settled) rejectCallback(new Error("OAuth attempt closed before callback"))
      await Promise.all(servers.map(stop))
    },
  }
}
