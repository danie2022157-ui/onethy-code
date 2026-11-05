/**
 * First-party OnethyCode adapter for vercel-labs/agent-desktop (Apache-2.0).
 * The native executable uses the host OS accessibility API, not browser pixels.
 * It must run on the same desktop as the application being controlled.
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

export const actions = [
  "status", "permissions", "version", "list-apps", "list-windows", "list-displays", "list-surfaces",
  "snapshot", "find", "get", "is",
  "click", "double-click", "right-click", "type", "set-value", "clear", "focus", "select",
  "toggle", "check", "uncheck", "expand", "collapse", "scroll", "scroll-to",
  "press", "focus-window", "launch", "close-app", "minimize", "maximize", "restore", "wait",
] as const

export type DesktopAction = (typeof actions)[number]
export type DesktopRequest = {
  action: DesktopAction
  app?: string
  windowId?: string
  ref?: string
  text?: string
  query?: string
  role?: string
  name?: string
  keys?: string
  value?: string
  property?: string
  direction?: "up" | "down" | "left" | "right"
  amount?: number
  waitMs?: number
  headed?: boolean
}
export type DesktopInvocation = {
  args: string[]
  stdin?: string
  resource: string
  requiresApproval: boolean
}
export type DesktopResult = {
  version?: string
  ok: boolean
  command?: string
  data?: unknown
  error?: { code?: string; message?: string; disposition?: unknown }
}

const REF = /^@[a-zA-Z0-9_-]+:e[0-9]+$/
const REF_ACTIONS = new Set<DesktopAction>([
  "get", "is", "click", "double-click", "right-click", "type", "set-value", "clear",
  "focus", "select", "toggle", "check", "uncheck", "expand", "collapse", "scroll", "scroll-to",
])
const SCOPED = new Set<DesktopAction>([
  "snapshot", "find", "list-apps", "list-windows", "list-surfaces", "press",
  "focus-window", "minimize", "maximize", "restore",
])
const READ_ONLY = new Set<DesktopAction>([
  "status", "permissions", "version", "list-apps", "list-windows", "list-displays",
  "list-surfaces", "snapshot", "find", "get", "is", "wait",
])

function required(value: string | undefined, field: string, max = 256) {
  if (!value?.trim() || value.length > max || value.includes("\0")) {
    throw new Error(field + " must be a non-empty string of at most " + max + " characters.")
  }
  return value
}

function reference(value: string | undefined) {
  const id = required(value, "ref")
  if (!REF.test(id)) throw new Error("Use a qualified ref from the latest snapshot (for example @s123:e8).")
  return id
}

/** Build an argv without a shell or caller-supplied arbitrary CLI flags. */
export function buildDesktopInvocation(input: DesktopRequest): DesktopInvocation {
  if (!(actions as readonly string[]).includes(input.action)) throw new Error("Unsupported desktop action.")
  const args: string[] = [input.action]
  const add = (flag: string, value: string | undefined) => {
    if (value !== undefined) args.push(flag + "=" + required(value, flag))
  }
  if (input.headed) args.unshift("--headed")
  if (REF_ACTIONS.has(input.action)) args.push(reference(input.ref))

  if (SCOPED.has(input.action)) {
    add("--app", input.app)
    add("--window-id", input.windowId)
  }

  switch (input.action) {
    case "snapshot":
      // Do not silently read the active app or whole desktop; scope must be explicit.
      if (!input.app && !input.windowId) throw new Error("snapshot requires app or windowId.")
      args.push("-i", "--compact")
      break
    case "find":
      if (!input.app && !input.windowId) throw new Error("find requires app or windowId.")
      add("--text", input.query)
      add("--role", input.role)
      add("--name", input.name)
      if (!input.query && !input.role && !input.name)
        throw new Error("find requires query, role or name.")
      args.push("--limit=30")
      break
    case "get":
      add("--property", input.property)
      break
    case "is":
      add("--property", input.property)
      break
    case "type":
    case "set-value": {
      const text = required(input.text, "text", 10_000)
      if (Buffer.byteLength(text, "utf8") > 10_000) throw new Error("text must be at most 10,000 UTF-8 bytes.")
      args.push("--stdin") // Do not expose typed text in process arguments or diagnostics.
      return {
        args, stdin: text,
        resource: input.action + ":element",
        requiresApproval: true,
      }
    }
    case "select":
      args.push(required(input.value, "value"))
      break
    case "scroll":
      args.push("--direction=" + (input.direction ?? "down"))
      if (input.amount !== undefined) {
        if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > 20)
          throw new Error("amount must be an integer between 1 and 20.")
        args.push("--amount=" + input.amount)
      }
      break
    case "press":
      if (!input.app && !input.windowId) throw new Error("press requires app or windowId.")
      args.push(required(input.keys, "keys", 100))
      break
    case "launch":
    case "close-app":
      args.push(required(input.app, "app"))
      break
    case "focus-window":
      if (!input.app && !input.windowId) throw new Error("focus-window requires app or windowId.")
      break
    case "minimize":
    case "maximize":
    case "restore":
      if (!input.app && !input.windowId) throw new Error(input.action + " requires app or windowId.")
      break
    case "wait":
      if (!Number.isInteger(input.waitMs) || (input.waitMs ?? 0) < 1 || (input.waitMs ?? 0) > 5_000)
        throw new Error("waitMs must be an integer between 1 and 5000.")
      args.push(String(input.waitMs))
      break
  }

  // The desktop can be sensitive even for read-only inspection: permission is
  // required for all operations except local version/health/permission checks.
  return {
    args,
    resource: (input.headed ? "headed:" : "") +
      input.action + ":" + (input.app ?? input.windowId ?? (input.ref ? "element" : "*")),
    requiresApproval: !["status", "permissions", "version"].includes(input.action),
  }
}

/** The npm Windows shim is .cmd; spawn the verified native .exe instead of a shell. */
export function resolveDesktopBinary(env: NodeJS.ProcessEnv = process.env, platform = process.platform, arch = process.arch): string {
  if (env.ONETHY_AGENT_DESKTOP_BIN) return env.ONETHY_AGENT_DESKTOP_BIN
  if (platform !== "win32") return "agent-desktop"
  const executable = "agent-desktop-win32-" + arch + ".exe"
  const roots = [
    ...(env.APPDATA ? [path.join(env.APPDATA, "npm")] : []),
    ...((env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)),
  ]
  for (const root of roots) {
    for (const candidate of [
      path.join(root, "node_modules", "agent-desktop", "bin", executable),
      path.join(root, executable),
      path.join(root, "agent-desktop.exe"),
    ]) {
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        // Try the next known location. Do not invoke a .cmd shim from an agent.
      }
    }
  }
  return "agent-desktop"
}

const MAX_STDOUT = 128 * 1024
const MAX_STDERR = 8 * 1024

/** Bounded synchronous-invocation lifecycle; never logs private desktop contents. */
export function runAgentDesktop(invocation: DesktopInvocation, options?: {
  binary?: string
  timeoutMs?: number
}): Promise<DesktopResult> {
  const binary = options?.binary ?? resolveDesktopBinary()
  const timeoutMs = options?.timeoutMs ?? 25_000
  return new Promise((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    let finished = false
    let truncated = false
    const child = spawn(binary, invocation.args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const finish = (error?: Error, value?: DesktopResult) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value!)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error("Agent Desktop timed out. Retry only if the command can be safely repeated."))
    }, timeoutMs)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
      if (Buffer.byteLength(stdout, "utf8") > MAX_STDOUT) {
        truncated = true
        child.kill()
        finish(new Error("Agent Desktop returned an oversized response. Narrow the app or query."))
      }
    })
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_STDERR)
    })
    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(err.code === "ENOENT"
        ? new Error("Agent Desktop native binary not found. Install agent-desktop on the machine running OnethyCode (npm install -g agent-desktop), then run desktop_control status.")
        : new Error("Agent Desktop could not start: " + err.message))
    })
    child.on("close", (code) => {
      if (finished || truncated) return
      let parsed: DesktopResult
      try {
        parsed = JSON.parse(stdout.trim()) as DesktopResult
      } catch {
        finish(new Error("Agent Desktop did not return a valid JSON response (exit " + code + "). " + stderr.slice(0, 250)))
        return
      }
      if (!parsed || typeof parsed.ok !== "boolean") {
        finish(new Error("Agent Desktop returned an invalid response envelope."))
        return
      }
      if (code !== 0 || !parsed.ok) {
        finish(new Error("Agent Desktop " + (parsed.error?.code ?? "error") + ": " +
          (parsed.error?.message ?? "Action failed") +
          ". Do not retry mutations without inspecting the current UI."))
        return
      }
      finish(undefined, parsed)
    })
    child.stdin.on("error", () => undefined)
    child.stdin.end(invocation.stdin ?? "")
  })
}

export function formatDesktopResult(result: DesktopResult, action: DesktopAction): string {
  // Native CLI redacts stdin-based typed values; keep our tool output redacted too.
  if (action === "type" || action === "set-value") {
    return JSON.stringify({ ok: result.ok, command: action, message: "Text delivered; resnapshot to verify." })
  }
  const output = JSON.stringify(result)
  return output.length > 32_000
    ? output.slice(0, 32_000) + "\n[Desktop output truncated: narrow the query or app.]"
    : output
}
