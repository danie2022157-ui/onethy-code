export * as OmniShell from "./omni-shell.js"

import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { OmniPath } from "./omni-path.js"
import { Location } from "./location.js"

export interface OmniShellInterface {
  readonly classify: (command: string, cwd: string) => Effect.Effect<
    "safe_inspection" | "mutation" | "destructive" | "blocked",
    ShellGuardError
  >
  readonly validateCwd: (cwd: string) => Effect.Effect<string, ShellGuardError>
}

export class Service extends Context.Service<Service, OmniShellInterface>()("@opencode/OmniShell") {}

export class ShellGuardError extends Error {
  constructor(readonly command: string, readonly reason: string) {
    super(`Omni shell guard blocked '${command}': ${reason}`)
    this.name = "ShellGuardError"
  }
}

const SAFE_PREFIXES = [
  "git status",
  "git diff",
  "git log",
  "git branch",
  "git show",
  "ls",
  "dir",
  "pwd",
  "echo",
  "cat",
  "type",
  "head",
  "tail",
  "node -v",
  "node --version",
  "npm -v",
  "npm --version",
  "python --version",
  "python -v",
  "python3 --version",
  "git --version",
  "whoami",
  "date",
]

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-rf|-r|-f)?\b/i,
  /\bdel\s+(\/s|\/q|\/f)?\b/i,
  /\brmdir\s+(\/s|\/q)?\b/i,
  /\bformat\b/i,
  /\bgit\s+(push|reset\s+--hard|clean\s+-fd)\b/i,
  /\bdrop\s+(database|table)\b/i,
  /\bshutdown\b/i,
]

const COMPOSITION_OPERATORS = /[;&|]/

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const omniPath = yield* OmniPath.Service

    const validateCwdImpl = Effect.fn("OmniShell.validateCwd")(function* (cwd: string) {
      return yield* omniPath.resolve(cwd).pipe(
        Effect.mapError((err) => new ShellGuardError(cwd, err.message)),
      )
    })

    const validateCwd: (cwd: string) => Effect.Effect<string, ShellGuardError> = validateCwdImpl

    const classifyImpl = Effect.fn("OmniShell.classify")(function* (command: string, cwd: string) {
      const validatedCwd = yield* validateCwd(cwd)
      const trimmed = command.trim()

      if (!trimmed) return "mutation"

      if (/\$\(|`|\\\$|\{\s/.test(trimmed)) return "blocked"

      const parts = trimmed.split(COMPOSITION_OPERATORS)
      let overall = "safe_inspection" as "safe_inspection" | "mutation" | "destructive" | "blocked"

      for (const part of parts) {
        const sub = part.trim()
        if (!sub) continue

        const subResult = classifySubcommand(sub, validatedCwd)
        if (subResult === "blocked") return "blocked"
        if (subResult === "destructive") return "destructive"
        if (subResult === "mutation") overall = "mutation"
      }

      return overall
    })

    const classify: (
      command: string,
      cwd: string,
    ) => Effect.Effect<
      "safe_inspection" | "mutation" | "destructive" | "blocked",
      ShellGuardError
    > = classifyImpl

    return Service.of({ classify, validateCwd })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, OmniPath.node],
})

function classifySubcommand(sub: string, _cwd: string): "safe_inspection" | "mutation" | "destructive" | "blocked" {
  const lower = sub.toLowerCase()

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(sub)) return "destructive"
  }

  for (const prefix of SAFE_PREFIXES) {
    if (
      lower === prefix ||
      lower.startsWith(prefix + " ") ||
      lower.startsWith(prefix + "\t")
    ) {
      const rest = sub.slice(prefix.length).trim()
      if (rest && /[;&|>]/.test(rest)) return "blocked"
      if (rest && containsWorkspaceEscape(rest)) return "blocked"
      return "safe_inspection"
    }
  }

  return "mutation"
}

function containsWorkspaceEscape(arg: string): boolean {
  if (arg.includes("..")) return true
  if (/^[a-zA-Z]:[\\/]/.test(arg)) return true
  if (arg.startsWith("\\\\") || arg.startsWith("//")) return true
  return false
}
