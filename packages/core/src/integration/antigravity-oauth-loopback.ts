import { createServer, type RequestListener, type Server } from "node:http"
import { readFileSync } from "node:fs"
import { OauthCallbackPage } from "../oauth/page.js"

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

function remoteBrowserMayNotReachLoopback(): boolean {
  if (process.env.SSH_TTY || process.env.SSH_CONNECTION || process.env.SSH_CLIENT ||
    process.env.CODESPACES || process.env.REMOTE_CONTAINERS) return true
  if (process.platform !== "linux") return false
  try {
    return /microsoft|wsl/i.test(readFileSync("/proc/version", "utf8"))
  } catch {
    return false
  }
}

/**
 * Converts the pinned plugin's manual, localhost-redirect OAuth into a local
 * callback without modifying its token exchange or account storage.
 *
 * Bind only to loopback IPv4/IPv6. An unknown redirect remains a manual flow.
 * No token, state or callback URL is logged or sent anywhere by this listener.
 */
export async function openAntigravityOAuthCallback(authorizationURL: string): Promise<AntigravityOAuthListener | undefined> {
  // In WSL/SSH containers, browser localhost may refer to a different machine.
  // Preserve the plugin's manual URL input unless trusted forwarding is explicit.
  if (remoteBrowserMayNotReachLoopback() && process.env.ONETHY_ANTIGRAVITY_OAUTH_LOOPBACK !== "1") return
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
    const reply = (status: number, html: string) => {
      response.writeHead(status, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        Connection: "close",
      })
      response.end(html)
    }

    if (request.method !== "GET" || !request.url) {
      reply(405, OauthCallbackPage.error("Método não permitido.", { provider: "Google (Antigravity)" }))
      return
    }
    if (![ `localhost:${expected.port}`, `127.0.0.1:${expected.port}`, `[::1]:${expected.port}` ].includes(request.headers.host ?? "")) {
      reply(400, OauthCallbackPage.error("Host de retorno inválido.", { provider: "Google (Antigravity)" }))
      return
    }
    const incoming = new URL(request.url, `http://localhost:${expected.port}`)
    if (incoming.pathname !== expected.path) {
      reply(404, OauthCallbackPage.error("Página não encontrada.", { provider: "Google (Antigravity)" }))
      return
    }
    if (settled) {
      reply(410, OauthCallbackPage.error("Esta autorização já foi concluída anteriormente.", { provider: "Google (Antigravity)" }))
      return
    }
    if (incoming.searchParams.get("state") !== expected.state) {
      reply(400, OauthCallbackPage.error("Estado OAuth (state) inválido ou expirado.", { provider: "Google (Antigravity)" }))
      return
    }
    const error = incoming.searchParams.get("error")
    const code = incoming.searchParams.get("code")
    if (!error && !code) {
      reply(400, OauthCallbackPage.error("Resultado de autorização ausente.", { provider: "Google (Antigravity)" }))
      return
    }
    settled = true
    if (error) {
      reply(400, OauthCallbackPage.error("A autorização do Google foi cancelada ou negada.", {
        provider: "Google (Antigravity)",
        headline: "Autorização não concluída",
        message: "A autorização do Google foi cancelada ou recusada na conta selecionada.",
        footnote: "Retorne ao OnethyCode para tentar novamente.",
        buttonText: "Fechar janela",
      }))
      rejectCallback(new Error("Google authorization was cancelled or denied"))
      return
    }
    reply(200, OauthCallbackPage.success({
      provider: "Google (Antigravity)",
      headline: "Autorização concluída com sucesso!",
      message: "O OnethyCode foi conectado à sua conta Google com sucesso.",
      footnote: "Você já pode fechar esta aba do navegador e retornar ao terminal.",
      buttonText: "Fechar esta janela",
    }))
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
