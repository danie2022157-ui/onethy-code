export * as LocalBrowser from "./local-browser.js"

import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode/util/global"

export const actions = [
  "open",
  "navigate",
  "snapshot",
  "click",
  "fill",
  "select",
  "press",
  "scroll",
  "screenshot",
  "wait",
  "evaluate",
  "console",
  "tabs",
  "switch_tab",
  "close_tab",
  "close",
] as const

export type Action = (typeof actions)[number]

export interface CommandInput {
  readonly action: Action
  readonly url?: string
  readonly navigation?: "goto" | "back" | "forward" | "reload"
  readonly ref?: string
  readonly selector?: string
  readonly text?: string
  readonly value?: string
  readonly clear?: boolean
  readonly submit?: boolean
  readonly key?: string
  readonly direction?: "up" | "down" | "top" | "bottom"
  readonly amount?: number
  readonly fullPage?: boolean
  readonly waitMs?: number
  readonly timeoutMs?: number
  readonly script?: string
  readonly tabId?: string
  readonly newTab?: boolean
  readonly headless?: boolean
}

export interface TabInfo {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly active: boolean
}

export interface SnapshotElement {
  readonly ref: string
  readonly tag: string
  readonly role?: string
  readonly label: string
  readonly type?: string
  readonly value?: string
  readonly placeholder?: string
  readonly href?: string
  readonly disabled?: boolean
  readonly checked?: boolean
}

export interface ScreenshotArtifact {
  readonly path: string
  readonly base64: string
  readonly bytes: number
}

export interface CommandResult {
  readonly action: Action
  readonly url?: string
  readonly title?: string
  readonly tabId?: string
  readonly summary: string
  readonly screenshot?: ScreenshotArtifact
}

interface CdpTarget {
  readonly id: string
  readonly type: string
  readonly title: string
  readonly url: string
  readonly webSocketDebuggerUrl?: string
}

interface ConsoleEntry {
  readonly level: string
  readonly text: string
  readonly time: number
}

interface PendingRequest {
  readonly resolve: (value: Record<string, unknown>) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

const MAX_CONSOLE_ENTRIES = 100
const MAX_SNAPSHOT_ELEMENTS = 150
const MAX_SNAPSHOT_TEXT = 8000
const MAX_EVALUATE_TEXT = 12000

const KEY_CODES: Record<string, { readonly code: string; readonly keyCode: number; readonly text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  Space: { code: "Space", keyCode: 32, text: " " },
  " ": { code: "Space", keyCode: 32, text: " " },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
}

export function normalizeBrowserUrl(raw: string): string {
  const value = raw.trim()
  if (!value || value === "about:blank") return "about:blank"
  if (/^(?:[\\/.]|[a-zA-Z]:[\\/])/.test(value)) {
    throw new Error("Local file paths are not allowed as browser URLs. Use http:// or https://.")
  }
  const isLocal = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `${isLocal ? "http" : "https"}://${value}`
  const parsed = new URL(withScheme)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported browser URL scheme "${parsed.protocol}". Only http:// and https:// are supported.`)
  }
  if (parsed.username || parsed.password) {
    throw new Error("Browser URLs with embedded credentials are not allowed.")
  }
  return parsed.href
}

export async function findBrowserExecutable(): Promise<string | undefined> {
  const envPath = process.env.ONETHY_BROWSER_PATH || process.env.CHROME_PATH
  if (envPath && (await Bun.file(envPath).exists())) return envPath

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? ""
    const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files"
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"
    const candidates = [
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      localAppData ? path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe") : "",
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      localAppData ? path.join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe") : "",
    ].filter(Boolean)
    for (const candidate of candidates) {
      if (await Bun.file(candidate).exists()) return candidate
    }
    return undefined
  }

  if (process.platform === "darwin") {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
    for (const candidate of candidates) {
      if (await Bun.file(candidate).exists()) return candidate
    }
    return undefined
  }

  for (const bin of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]) {
    const found = Bun.which(bin)
    if (found) return found
  }
  return undefined
}

class CdpConnection {
  private readonly socket: WebSocket
  private readonly pending = new Map<number, PendingRequest>()
  private readonly eventListeners = new Map<string, Set<(params: Record<string, unknown>) => void>>()
  private nextId = 1
  private closed = false

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.onmessage = (event) => {
      const parsed = parseJsonRecord(typeof event.data === "string" ? event.data : "")
      if (!parsed) return
      const id = typeof parsed.id === "number" ? parsed.id : undefined
      if (id !== undefined) {
        const waiter = this.pending.get(id)
        if (!waiter) return
        this.pending.delete(id)
        clearTimeout(waiter.timer)
        const errorObj = isRecord(parsed.error) ? parsed.error : undefined
        if (errorObj) {
          const message = typeof errorObj.message === "string" ? errorObj.message : "CDP command failed"
          waiter.reject(new Error(message))
          return
        }
        waiter.resolve(isRecord(parsed.result) ? parsed.result : {})
        return
      }
      const method = typeof parsed.method === "string" ? parsed.method : undefined
      if (!method) return
      const params = isRecord(parsed.params) ? parsed.params : {}
      const listeners = this.eventListeners.get(method)
      if (!listeners) return
      for (const listener of listeners) listener(params)
    }
    socket.onclose = () => {
      this.closed = true
      for (const [, waiter] of this.pending) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error("Browser tab connection closed"))
      }
      this.pending.clear()
    }
  }

  static connect(wsUrl: string): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl)
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error(`Timed out connecting to browser DevTools at ${wsUrl}`))
      }, 10_000)
      socket.onopen = () => {
        clearTimeout(timer)
        resolve(new CdpConnection(socket))
      }
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error(`Failed to connect to browser DevTools at ${wsUrl}`))
      }
    })
  }

  get isOpen() {
    return !this.closed && this.socket.readyState === WebSocket.OPEN
  }

  on(method: string, listener: (params: Record<string, unknown>) => void) {
    const existing = this.eventListeners.get(method)
    if (existing) {
      existing.add(listener)
      return () => existing.delete(listener)
    }
    const set = new Set([listener])
    this.eventListeners.set(method, set)
    return () => set.delete(listener)
  }

  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<Record<string, unknown>> {
    if (!this.isOpen) return Promise.reject(new Error("Browser connection is closed"))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Browser command "${method}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.closed = true
    this.socket.close()
  }
}

class LocalBrowserManager {
  private child: ReturnType<typeof Bun.spawn> | undefined
  private port: number | undefined
  private headlessMode: boolean | undefined
  private browserConn: CdpConnection | undefined
  private activeTabId: string | undefined
  private readonly tabConns = new Map<string, CdpConnection>()
  private readonly consoleLogs = new Map<string, ConsoleEntry[]>()

  async execute(input: CommandInput): Promise<CommandResult> {
    if (input.action === "close") {
      await this.shutdown()
      return { action: "close", summary: "Browser session closed." }
    }

    if (input.action === "open") {
      const headless = input.headless ?? process.env.ONETHY_BROWSER_HEADLESS === "1"
      await this.ensureStarted(headless)
      const targetUrl = normalizeBrowserUrl(input.url ?? "about:blank")
      const tab = await this.openOrReuseTab(targetUrl, input.newTab === true)
      if (targetUrl !== "about:blank") {
        await this.navigateTab(tab.id, targetUrl)
      }
      const snap = await this.captureSnapshot(tab.id)
      return {
        action: "open",
        tabId: tab.id,
        url: snap.url,
        title: snap.title,
        summary: snap.formatted,
      }
    }

    if (input.action === "tabs") {
      const tabs = await this.listTabs()
      const lines = tabs.map((tab, index) => `${index + 1}. [${tab.id}]${tab.active ? " (active)" : ""} ${tab.title || "(untitled)"} — ${tab.url}`)
      return {
        action: "tabs",
        tabId: this.activeTabId,
        summary: lines.length ? `Open tabs:\n${lines.join("\n")}` : "No open browser tabs.",
      }
    }

    if (input.action === "switch_tab") {
      if (!input.tabId) throw new Error("tabId is required for switch_tab.")
      await this.activateTab(input.tabId)
      const snap = await this.captureSnapshot(input.tabId)
      return {
        action: "switch_tab",
        tabId: input.tabId,
        url: snap.url,
        title: snap.title,
        summary: `Switched to tab ${input.tabId}.\n\n${snap.formatted}`,
      }
    }

    if (input.action === "close_tab") {
      const targetId = input.tabId ?? (await this.resolveActiveTabId())
      await this.closeTab(targetId)
      return {
        action: "close_tab",
        tabId: this.activeTabId,
        summary: `Closed tab ${targetId}.`,
      }
    }

    const tabId = input.tabId ?? (await this.resolveActiveTabId())
    await this.activateTab(tabId)

    if (input.action === "navigate") {
      const mode = input.navigation ?? (input.url ? "goto" : "reload")
      if (mode === "goto") {
        if (!input.url) throw new Error("url is required for navigate.")
        const targetUrl = normalizeBrowserUrl(input.url)
        await this.navigateTab(tabId, targetUrl)
      }
      if (mode === "back") await this.navigateHistory(tabId, -1)
      if (mode === "forward") await this.navigateHistory(tabId, 1)
      if (mode === "reload") {
        const conn = await this.connectTab(tabId)
        await this.waitForLoad(conn, () => conn.send("Page.reload", {}))
      }
      const snap = await this.captureSnapshot(tabId)
      return { action: "navigate", tabId, url: snap.url, title: snap.title, summary: snap.formatted }
    }

    if (input.action === "snapshot") {
      const snap = await this.captureSnapshot(tabId)
      return { action: "snapshot", tabId, url: snap.url, title: snap.title, summary: snap.formatted }
    }

    if (input.action === "click") {
      const result = await this.clickElement(tabId, input.ref, input.selector)
      return { action: "click", tabId, url: result.url, title: result.title, summary: result.summary }
    }

    if (input.action === "fill") {
      if (input.text === undefined) throw new Error("text is required for fill.")
      const result = await this.fillElement(tabId, input.ref, input.selector, input.text, input.clear !== false, input.submit === true)
      return { action: "fill", tabId, url: result.url, title: result.title, summary: result.summary }
    }

    if (input.action === "select") {
      const selectedValue = input.value ?? input.text
      if (selectedValue === undefined) throw new Error("value is required for select.")
      const result = await this.selectOption(tabId, input.ref, input.selector, selectedValue)
      return { action: "select", tabId, url: result.url, title: result.title, summary: result.summary }
    }

    if (input.action === "press") {
      if (!input.key) throw new Error("key is required for press.")
      const conn = await this.connectTab(tabId)
      await this.dispatchKey(conn, input.key)
      await Bun.sleep(200)
      const meta = await this.readPageMeta(conn)
      return { action: "press", tabId, url: meta.url, title: meta.title, summary: `Pressed "${input.key}" on ${meta.url}.` }
    }

    if (input.action === "scroll") {
      const direction = input.direction ?? "down"
      const amount = input.amount ?? 600
      const conn = await this.connectTab(tabId)
      await this.evalValue(
        conn,
        `(() => {
          const dir = ${JSON.stringify(direction)};
          const amt = ${JSON.stringify(amount)};
          if (dir === "top") window.scrollTo({ top: 0, behavior: "instant" });
          else if (dir === "bottom") window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
          else window.scrollBy({ top: dir === "up" ? -amt : amt, behavior: "instant" });
          return { x: window.scrollX, y: window.scrollY };
        })()`,
      )
      const snap = await this.captureSnapshot(tabId)
      return { action: "scroll", tabId, url: snap.url, title: snap.title, summary: `Scrolled ${direction}.\n\n${snap.formatted}` }
    }

    if (input.action === "screenshot") {
      const shot = await this.captureScreenshot(tabId, input.fullPage === true)
      return {
        action: "screenshot",
        tabId,
        url: shot.url,
        title: shot.title,
        screenshot: shot.artifact,
        summary: `Captured screenshot of "${shot.title}" (${shot.url}) -> ${shot.artifact.path} (${shot.artifact.bytes} bytes).`,
      }
    }

    if (input.action === "wait") {
      const result = await this.waitForCondition(tabId, input.waitMs, input.selector, input.text, input.timeoutMs ?? 10_000)
      return { action: "wait", tabId, url: result.url, title: result.title, summary: result.summary }
    }

    if (input.action === "evaluate") {
      if (!input.script) throw new Error("script is required for evaluate.")
      const conn = await this.connectTab(tabId)
      const value = await this.evalValue(conn, input.script)
      const serialized = truncate(JSON.stringify(value, null, 2) ?? String(value), MAX_EVALUATE_TEXT)
      const meta = await this.readPageMeta(conn)
      return { action: "evaluate", tabId, url: meta.url, title: meta.title, summary: serialized }
    }

    if (input.action === "console") {
      const entries = this.consoleLogs.get(tabId) ?? []
      const summary = entries.length
        ? entries.map((entry) => `[${entry.level}] ${entry.text}`).join("\n")
        : "No console messages captured for this tab."
      return { action: "console", tabId, summary }
    }

    throw new Error(`Unsupported browser action: ${String(input.action)}`)
  }

  async shutdown() {
    for (const [, conn] of this.tabConns) conn.close()
    this.tabConns.clear()
    this.consoleLogs.clear()
    this.browserConn?.close()
    this.browserConn = undefined
    this.activeTabId = undefined
    this.port = undefined
    this.headlessMode = undefined
    if (this.child) {
      this.child.kill()
      this.child = undefined
    }
  }

  private async ensureStarted(headless: boolean) {
    if (this.port && (await this.isAlive(this.port))) {
      if (this.headlessMode === headless) return
      await this.shutdown()
    }
    const executable = await findBrowserExecutable()
    if (!executable) {
      throw new Error(
        "No Chromium-based browser (Chrome, Edge, Brave, or Chromium) was found. Install Chrome/Edge or set ONETHY_BROWSER_PATH.",
      )
    }
    const profileDir = path.join(Global.Path.data, "browser-profile")
    await fs.mkdir(profileDir, { recursive: true })
    const activePortFile = path.join(profileDir, "DevToolsActivePort")
    await fs.rm(activePortFile, { force: true }).catch(() => undefined)

    const args = [
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--window-size=1280,900",
      ...(headless ? ["--headless=new"] : []),
      "about:blank",
    ]
    const child = Bun.spawn([executable, ...args], {
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    })
    this.child = child
    this.headlessMode = headless

    const port = await this.waitForDebugPort(child, activePortFile, 15_000)
    this.port = port
    const version = await this.fetchJson(`http://127.0.0.1:${port}/json/version`)
    const browserWs = typeof version.webSocketDebuggerUrl === "string" ? version.webSocketDebuggerUrl : undefined
    if (browserWs) {
      this.browserConn = await CdpConnection.connect(browserWs)
    }
  }

  private async waitForDebugPort(child: ReturnType<typeof Bun.spawn>, activePortFile: string, timeoutMs: number): Promise<number> {
    let stderrPort: number | undefined
    if (child.stderr && typeof child.stderr !== "number") {
      const reader = child.stderr.getReader()
      void (async () => {
        const decoder = new TextDecoder()
        let buffer = ""
        while (true) {
          const chunk = await reader.read().catch(() => ({ done: true, value: undefined }))
          if (chunk.done || !chunk.value) break
          buffer += decoder.decode(chunk.value, { stream: true })
          const match = buffer.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
          if (match) {
            stderrPort = Number(match[1])
            break
          }
          if (buffer.length > 8192) buffer = buffer.slice(-2048)
        }
        reader.releaseLock()
      })()
    }

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (stderrPort && (await this.isAlive(stderrPort))) return stderrPort
      const fileText = await Bun.file(activePortFile)
        .text()
        .catch(() => "")
      const firstLine = fileText.split(/\r?\n/)[0]?.trim()
      const filePort = firstLine ? Number(firstLine) : NaN
      if (Number.isInteger(filePort) && filePort > 0 && (await this.isAlive(filePort))) return filePort
      await Bun.sleep(100)
    }
    await this.shutdown()
    throw new Error("Timed out waiting for local Chrome/Edge DevTools port to open.")
  }

  private async isAlive(port: number): Promise<boolean> {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    }).catch(() => undefined)
    return Boolean(res?.ok)
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`DevTools HTTP ${res.status} for ${url}`)
    const data: unknown = await res.json()
    return isRecord(data) ? data : {}
  }

  private async listTargets(): Promise<CdpTarget[]> {
    if (!this.port || !(await this.isAlive(this.port))) {
      throw new Error('Browser is not running. Call web_browser with action "open" and a URL first.')
    }
    const res = await fetch(`http://127.0.0.1:${this.port}/json/list`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`Failed to list browser tabs (HTTP ${res.status})`)
    const data: unknown = await res.json()
    if (!Array.isArray(data)) return []
    return data.filter(isCdpTarget).filter((target) => target.type === "page")
  }

  private async listTabs(): Promise<TabInfo[]> {
    const targets = await this.listTargets()
    return targets.map((target) => ({
      id: target.id,
      title: target.title,
      url: target.url,
      active: target.id === this.activeTabId,
    }))
  }

  private async resolveActiveTabId(): Promise<string> {
    const targets = await this.listTargets()
    if (!targets.length) throw new Error('No open browser tabs. Call web_browser with action "open" first.')
    if (this.activeTabId && targets.some((target) => target.id === this.activeTabId)) return this.activeTabId
    this.activeTabId = targets[0].id
    return this.activeTabId
  }

  private async openOrReuseTab(url: string, newTab: boolean): Promise<CdpTarget> {
    const targets = await this.listTargets()
    if (!newTab && targets.length > 0) {
      const current = targets.find((target) => target.id === this.activeTabId) ?? targets[0]
      if (current.url === "about:blank" || current.url === "chrome://newtab/" || current.url === "edge://newtab/" || !newTab) {
        this.activeTabId = current.id
        await this.activateTab(current.id)
        return current
      }
    }
    if (this.browserConn?.isOpen) {
      const created = await this.browserConn.send("Target.createTarget", { url: "about:blank" })
      const targetId = typeof created.targetId === "string" ? created.targetId : undefined
      if (targetId) {
        this.activeTabId = targetId
        await this.activateTab(targetId)
        const updated = await this.listTargets()
        const match = updated.find((target) => target.id === targetId)
        if (match) return match
      }
    }
    const createdRes = await fetch(`http://127.0.0.1:${this.port}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
      signal: AbortSignal.timeout(5000),
    })
    const createdData: unknown = await createdRes.json()
    if (!isCdpTarget(createdData)) throw new Error("Failed to open a new browser tab.")
    this.activeTabId = createdData.id
    return createdData
  }

  private async activateTab(tabId: string) {
    this.activeTabId = tabId
    if (this.browserConn?.isOpen) {
      await this.browserConn.send("Target.activateTarget", { targetId: tabId }).catch(() => undefined)
      return
    }
    if (this.port) {
      await fetch(`http://127.0.0.1:${this.port}/json/activate/${encodeURIComponent(tabId)}`).catch(() => undefined)
    }
  }

  private async closeTab(tabId: string) {
    const existing = this.tabConns.get(tabId)
    existing?.close()
    this.tabConns.delete(tabId)
    this.consoleLogs.delete(tabId)
    if (this.browserConn?.isOpen) {
      await this.browserConn.send("Target.closeTarget", { targetId: tabId }).catch(() => undefined)
    } else if (this.port) {
      await fetch(`http://127.0.0.1:${this.port}/json/close/${encodeURIComponent(tabId)}`).catch(() => undefined)
    }
    if (this.activeTabId === tabId) {
      const remaining = await this.listTargets().catch(() => [])
      this.activeTabId = remaining[0]?.id
    }
  }

  private async connectTab(tabId: string): Promise<CdpConnection> {
    const existing = this.tabConns.get(tabId)
    if (existing?.isOpen) return existing
    const targets = await this.listTargets()
    const target = targets.find((item) => item.id === tabId)
    if (!target?.webSocketDebuggerUrl) throw new Error(`Tab "${tabId}" is no longer available.`)
    const conn = await CdpConnection.connect(target.webSocketDebuggerUrl)
    this.tabConns.set(tabId, conn)
    await Promise.all([conn.send("Page.enable"), conn.send("Runtime.enable"), conn.send("Log.enable")])
    this.attachConsoleCapture(tabId, conn)
    return conn
  }

  private attachConsoleCapture(tabId: string, conn: CdpConnection) {
    const push = (level: string, text: string) => {
      const list = this.consoleLogs.get(tabId) ?? []
      list.push({ level, text: truncate(text, 1000), time: Date.now() })
      if (list.length > MAX_CONSOLE_ENTRIES) list.splice(0, list.length - MAX_CONSOLE_ENTRIES)
      this.consoleLogs.set(tabId, list)
    }
    conn.on("Runtime.consoleAPICalled", (params) => {
      const level = typeof params.type === "string" ? params.type : "log"
      const args = Array.isArray(params.args) ? params.args : []
      const text = args
        .map((arg) => {
          if (!isRecord(arg)) return String(arg)
          if (typeof arg.value === "string") return arg.value
          if (arg.value !== undefined) return JSON.stringify(arg.value)
          if (typeof arg.description === "string") return arg.description
          return typeof arg.type === "string" ? `[${arg.type}]` : ""
        })
        .filter(Boolean)
        .join(" ")
      if (text) push(level, text)
    })
    conn.on("Runtime.exceptionThrown", (params) => {
      const details = isRecord(params.exceptionDetails) ? params.exceptionDetails : undefined
      const exception = details && isRecord(details.exception) ? details.exception : undefined
      const text =
        (exception && typeof exception.description === "string" ? exception.description : undefined) ??
        (details && typeof details.text === "string" ? details.text : "Uncaught exception")
      push("exception", text)
    })
  }

  private async navigateTab(tabId: string, url: string) {
    const conn = await this.connectTab(tabId)
    await this.waitForLoad(conn, () => conn.send("Page.navigate", { url }))
  }

  private async navigateHistory(tabId: string, delta: -1 | 1) {
    const conn = await this.connectTab(tabId)
    const history = await conn.send("Page.getNavigationHistory")
    const index = typeof history.currentIndex === "number" ? history.currentIndex : 0
    const entries = Array.isArray(history.entries) ? history.entries : []
    const target = entries[index + delta]
    if (!isRecord(target) || typeof target.id !== "number") {
      throw new Error(delta < 0 ? "No previous page in tab history." : "No next page in tab history.")
    }
    await this.waitForLoad(conn, () => conn.send("Page.navigateToHistoryEntry", { entryId: target.id }))
  }

  private async waitForLoad(conn: CdpConnection, trigger: () => Promise<unknown>, timeoutMs = 15_000) {
    let loaded = false
    const unsubscribe = conn.on("Page.loadEventFired", () => {
      loaded = true
    })
    await trigger()
    const deadline = Date.now() + timeoutMs
    while (!loaded && Date.now() < deadline) {
      const state = await this.evalValue(conn, "document.readyState").catch(() => undefined)
      if (state === "complete") break
      await Bun.sleep(150)
    }
    unsubscribe()
    await Bun.sleep(250)
  }

  private async evalValue(conn: CdpConnection, expression: string): Promise<unknown> {
    const res = await conn.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    const exception = isRecord(res.exceptionDetails) ? res.exceptionDetails : undefined
    if (exception) {
      const exObj = isRecord(exception.exception) ? exception.exception : undefined
      const msg =
        (exObj && typeof exObj.description === "string" ? exObj.description : undefined) ??
        (typeof exception.text === "string" ? exception.text : "Script evaluation failed")
      throw new Error(msg)
    }
    const result = isRecord(res.result) ? res.result : undefined
    return result?.value
  }

  private async readPageMeta(conn: CdpConnection): Promise<{ readonly url: string; readonly title: string }> {
    const value = await this.evalValue(conn, "({ url: location.href, title: document.title })").catch(() => undefined)
    if (!isRecord(value)) return { url: "", title: "" }
    return {
      url: typeof value.url === "string" ? value.url : "",
      title: typeof value.title === "string" ? value.title : "",
    }
  }

  private async captureSnapshot(tabId: string) {
    const conn = await this.connectTab(tabId)
    const raw = await this.evalValue(
      conn,
      `(() => {
        const selector = [
          'a[href]',
          'button',
          'input:not([type="hidden"])',
          'textarea',
          'select',
          '[role="button"]',
          '[role="link"]',
          '[role="textbox"]',
          '[role="searchbox"]',
          '[role="combobox"]',
          '[role="checkbox"]',
          '[role="radio"]',
          '[role="switch"]',
          '[role="tab"]',
          '[role="menuitem"]',
          '[contenteditable="true"]'
        ].join(',');
        for (const old of document.querySelectorAll('[data-onethy-ref]')) old.removeAttribute('data-onethy-ref');
        const elements = [];
        const nodes = Array.from(document.querySelectorAll(selector));
        let counter = 1;
        for (const el of nodes) {
          if (elements.length >= ${MAX_SNAPSHOT_ELEMENTS}) break;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          if (style.display === 'none' || style.visibility === 'hidden' || rect.width < 1 || rect.height < 1) continue;
          const ref = 'e' + (counter++);
          el.setAttribute('data-onethy-ref', ref);
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role') || undefined;
          const type = el.getAttribute('type') || undefined;
          const ariaLabel = el.getAttribute('aria-label') || '';
          const id = el.getAttribute('id');
          const labelEl = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]') : null;
          const label = (
            ariaLabel ||
            (labelEl ? labelEl.textContent : '') ||
            el.innerText ||
            el.getAttribute('placeholder') ||
            el.getAttribute('title') ||
            el.getAttribute('name') ||
            el.getAttribute('alt') ||
            ''
          ).replace(/\\s+/g, ' ').trim().slice(0, 120);
          const isPassword = tag === 'input' && type === 'password';
          const value = 'value' in el && typeof el.value === 'string' && el.value
            ? (isPassword ? '••••' : el.value.slice(0, 120))
            : undefined;
          elements.push({
            ref,
            tag,
            role,
            label,
            type,
            value,
            placeholder: el.getAttribute('placeholder') || undefined,
            href: tag === 'a' ? (el.getAttribute('href') || undefined) : undefined,
            disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true') || undefined,
            checked: typeof el.checked === 'boolean' ? el.checked : undefined,
          });
        }
        const text = (document.body ? document.body.innerText : '').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, ${MAX_SNAPSHOT_TEXT});
        return { url: location.href, title: document.title, elements, text };
      })()`,
    )
    const obj = isRecord(raw) ? raw : {}
    const url = typeof obj.url === "string" ? obj.url : ""
    const title = typeof obj.title === "string" ? obj.title : ""
    const text = typeof obj.text === "string" ? obj.text : ""
    const elements = Array.isArray(obj.elements) ? obj.elements.filter(isSnapshotElement) : []
    const formattedElements = elements
      .map((el) => {
        const parts = [`[${el.ref}]`, el.role ? `${el.tag}(${el.role})` : el.tag]
        if (el.type) parts.push(`type=${el.type}`)
        if (el.label) parts.push(`"${el.label}"`)
        if (el.value) parts.push(`value="${el.value}"`)
        if (el.placeholder && el.placeholder !== el.label) parts.push(`placeholder="${el.placeholder}"`)
        if (el.href) parts.push(`href=${el.href.slice(0, 100)}`)
        if (el.checked !== undefined) parts.push(`checked=${String(el.checked)}`)
        if (el.disabled) parts.push("disabled")
        return parts.join(" ")
      })
      .join("\n")
    const formatted = [
      `Page: ${title || "(untitled)"}`,
      `URL: ${url}`,
      "",
      `Interactive elements (${elements.length}):`,
      formattedElements || "(none found)",
      "",
      "Visible text:",
      text || "(empty)",
    ].join("\n")
    return { url, title, elements, text, formatted }
  }

  private async resolveElementCenter(conn: CdpConnection, ref?: string, selector?: string) {
    const css = resolveSelector(ref, selector)
    const raw = await this.evalValue(
      conn,
      `(() => {
        const el = document.querySelector(${JSON.stringify(css)});
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 80)
        };
      })()`,
    )
    if (!isRecord(raw) || typeof raw.x !== "number" || typeof raw.y !== "number") {
      throw new Error(`Element not found for ${ref ? `ref "${ref}"` : `selector "${selector}"`}. Run snapshot to refresh refs.`)
    }
    return {
      x: raw.x,
      y: raw.y,
      tag: typeof raw.tag === "string" ? raw.tag : "",
      text: typeof raw.text === "string" ? raw.text : "",
    }
  }

  private async clickElement(tabId: string, ref?: string, selector?: string) {
    const conn = await this.connectTab(tabId)
    const target = await this.resolveElementCenter(conn, ref, selector)
    await conn.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y, button: "none" })
    await conn.send("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 })
    await conn.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 })
    await Bun.sleep(350)
    const meta = await this.readPageMeta(conn)
    return {
      url: meta.url,
      title: meta.title,
      summary: `Clicked ${ref ?? selector} (${target.tag}${target.text ? ` "${target.text}"` : ""}). Current page: "${meta.title}" (${meta.url}).`,
    }
  }

  private async fillElement(
    tabId: string,
    ref: string | undefined,
    selector: string | undefined,
    text: string,
    clear: boolean,
    submit: boolean,
  ) {
    const conn = await this.connectTab(tabId)
    const css = resolveSelector(ref, selector)
    const target = await this.resolveElementCenter(conn, ref, selector)
    await conn.send("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 })
    await conn.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 })
    await this.evalValue(
      conn,
      `(() => {
        const el = document.querySelector(${JSON.stringify(css)});
        if (!el) throw new Error('Element disappeared');
        el.focus();
        if (${JSON.stringify(clear)}) {
          if ('value' in el) {
            const proto = Object.getPrototypeOf(el);
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, '');
            else el.value = '';
          } else if (el.isContentEditable) {
            el.textContent = '';
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`,
    )
    if (text.length > 0) {
      await conn.send("Input.insertText", { text })
    }
    await this.evalValue(
      conn,
      `(() => {
        const el = document.querySelector(${JSON.stringify(css)});
        if (!el) return;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    )
    if (submit) {
      await this.dispatchKey(conn, "Enter")
      await Bun.sleep(350)
    }
    const meta = await this.readPageMeta(conn)
    return {
      url: meta.url,
      title: meta.title,
      summary: `Filled ${ref ?? selector}${submit ? " and pressed Enter" : ""}. Current page: "${meta.title}" (${meta.url}).`,
    }
  }

  private async selectOption(tabId: string, ref: string | undefined, selector: string | undefined, value: string) {
    const conn = await this.connectTab(tabId)
    const css = resolveSelector(ref, selector)
    const chosen = await this.evalValue(
      conn,
      `(() => {
        const el = document.querySelector(${JSON.stringify(css)});
        if (!el || el.tagName.toLowerCase() !== 'select') throw new Error('Target is not a <select> element');
        const target = ${JSON.stringify(value)};
        const options = Array.from(el.options);
        const match = options.find((opt) => opt.value === target) || options.find((opt) => opt.textContent.trim().toLowerCase() === target.toLowerCase());
        if (!match) throw new Error('Option "' + target + '" not found in select');
        el.value = match.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { value: match.value, label: match.textContent.trim() };
      })()`,
    )
    const meta = await this.readPageMeta(conn)
    const label = isRecord(chosen) && typeof chosen.label === "string" ? chosen.label : value
    return {
      url: meta.url,
      title: meta.title,
      summary: `Selected "${label}" on ${ref ?? selector}.`,
    }
  }

  private async dispatchKey(conn: CdpConnection, key: string) {
    const mapped = KEY_CODES[key]
    if (mapped) {
      await conn.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: key === "Space" ? " " : key,
        code: mapped.code,
        windowsVirtualKeyCode: mapped.keyCode,
        ...(mapped.text ? { text: mapped.text, unmodifiedText: mapped.text } : {}),
      })
      await conn.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: key === "Space" ? " " : key,
        code: mapped.code,
        windowsVirtualKeyCode: mapped.keyCode,
      })
      return
    }
    await conn.send("Input.dispatchKeyEvent", { type: "keyDown", key, text: key.length === 1 ? key : undefined })
    await conn.send("Input.dispatchKeyEvent", { type: "keyUp", key })
  }

  private async captureScreenshot(tabId: string, fullPage: boolean) {
    const conn = await this.connectTab(tabId)
    const meta = await this.readPageMeta(conn)
    const res = await conn.send("Page.captureScreenshot", {
      format: "png",
      ...(fullPage ? { captureBeyondViewport: true } : {}),
    })
    const base64 = typeof res.data === "string" ? res.data : ""
    if (!base64) throw new Error("Browser returned an empty screenshot.")
    const bytes = Buffer.from(base64, "base64")
    const dir = path.join(os.tmpdir(), "onethy-browser")
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `screenshot-${Date.now()}.png`)
    await Bun.write(filePath, bytes)
    return {
      url: meta.url,
      title: meta.title,
      artifact: { path: filePath, base64, bytes: bytes.byteLength } satisfies ScreenshotArtifact,
    }
  }

  private async waitForCondition(
    tabId: string,
    waitMs: number | undefined,
    selector: string | undefined,
    text: string | undefined,
    timeoutMs: number,
  ) {
    const conn = await this.connectTab(tabId)
    if (!selector && !text) {
      const duration = Math.min(Math.max(waitMs ?? 1000, 50), 30_000)
      await Bun.sleep(duration)
      const meta = await this.readPageMeta(conn)
      return { url: meta.url, title: meta.title, summary: `Waited ${duration}ms on ${meta.url}.` }
    }
    const deadline = Date.now() + Math.min(Math.max(timeoutMs, 500), 30_000)
    while (Date.now() < deadline) {
      const matched = await this.evalValue(
        conn,
        `(() => {
          const sel = ${JSON.stringify(selector ?? null)};
          const txt = ${JSON.stringify(text ?? null)};
          const selOk = !sel || Boolean(document.querySelector(sel));
          const txtOk = !txt || Boolean(document.body && document.body.innerText.includes(txt));
          return selOk && txtOk;
        })()`,
      ).catch(() => false)
      if (matched === true) {
        const meta = await this.readPageMeta(conn)
        return {
          url: meta.url,
          title: meta.title,
          summary: `Condition matched (${selector ? `selector="${selector}"` : ""}${selector && text ? ", " : ""}${text ? `text="${text}"` : ""}) on ${meta.url}.`,
        }
      }
      await Bun.sleep(150)
    }
    throw new Error(`Timed out waiting for ${selector ? `selector "${selector}"` : `text "${text}"`}.`)
  }
}

function resolveSelector(ref?: string, selector?: string): string {
  if (ref) return `[data-onethy-ref="${ref.replace(/"/g, "")}"]`
  if (selector) return selector
  throw new Error("Either ref (from snapshot) or CSS selector is required.")
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n...(truncated)`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJsonRecord(text: string): Record<string, unknown> | undefined {
  if (!text) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function isCdpTarget(value: unknown): value is CdpTarget {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.title === "string" &&
    typeof value.url === "string"
  )
}

function isSnapshotElement(value: unknown): value is SnapshotElement {
  return (
    isRecord(value) &&
    typeof value.ref === "string" &&
    typeof value.tag === "string" &&
    typeof value.label === "string"
  )
}

const singleton = new LocalBrowserManager()

process.on("exit", () => {
  void singleton.shutdown()
})

export function execute(input: CommandInput): Promise<CommandResult> {
  return singleton.execute(input)
}

export function shutdown(): Promise<void> {
  return singleton.shutdown()
}
