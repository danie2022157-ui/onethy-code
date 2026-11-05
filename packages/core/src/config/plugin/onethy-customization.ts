export * as OnethyCustomizationPlugin from "./onethy-customization.js"

import path from "node:path"
import { readdir, readFile, lstat } from "node:fs/promises"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Global } from "@opencode/util/global"
import { Location } from "../../location.js"

/**
 * First-party adapters for selected OnethyCode hooks and mods.
 * External Claude hook scripts and mod modules are NEVER executed. Only
 * descriptive JSON descriptors with an explicit enabled: true are applied.
 */
type Descriptor = {
  readonly enabled?: boolean
  readonly implementation?: string
  readonly kind?: string
}

async function readEnabled(root: string, kind: "hooks" | "mods") {
  const directory = path.join(root, kind, "onethy")
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  const active = new Set<string>()
  for (const item of entries) {
    if (!item.isFile() || !/^[a-z0-9][a-z0-9-]*\.json$/.test(item.name)) continue
    const filepath = path.join(directory, item.name)
    if (!(await lstat(filepath)).isFile()) continue
    try {
      const content = await readFile(filepath, "utf8")
      if (content.length > 12_000) continue
      const value: Descriptor = JSON.parse(content)
      if (value?.enabled !== true || value.kind !== (kind === "hooks" ? "hook" : "mod")) continue
      if (kind === "hooks" && ["protected-push", "conventional-commits"].includes(value.implementation ?? "")) {
        active.add(value.implementation!)
      }
      if (kind === "mods" && value.implementation === "secret-redactor") active.add("secret-redactor")
    } catch {
      // Invalid or incomplete third-party metadata is ignored, not executed.
    }
  }
  return active
}
const conventional = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)(\([^()\r\n]+\))?!?: .+/i
function hookViolation(command: string, enabled: ReadonlySet<string>) {
  if (enabled.has("protected-push") && /\bgit\s+push\b[^\r\n]*(?:\s|\/)(?:main|master|develop)(?=\s|$|[;&|])/i.test(command)) {
    return "OnethyCode native hook: direct push to a protected branch requires a pull request"
  }
  if (enabled.has("conventional-commits")) {
    const match = command.match(/\bgit\s+commit\b[^\r\n]*?\s-m\s+(?:"([^"]+)"|'([^']+)')/i)
    const message = match?.[1] ?? match?.[2]
    if (message && !conventional.test(message)) {
      return "OnethyCode native hook: commit message must follow Conventional Commits"
    }
  }
  return undefined
}

const secretRules: ReadonlyArray<RegExp> = [
  /\bghp_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{25,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}\b/gi,
]
function redact(text: string) {
  return secretRules.reduce((value, pattern) => value.replace(pattern, "[REDACTED]"), text)
}

export const Plugin = define({
  id: "opencode.config.onethy.customizations",
  effect: Effect.fn("OnethyCodeCustomizations")(function* (ctx) {
    if (process.env.OMNICODE_ACTIVE !== "1") return
    const global = yield* Global.Service
    const location = yield* Location.Service
    const roots = [...new Set([global.config, path.join(location.project.directory, ".opencode")])]
    const active = { hooks: new Set<string>(), mods: new Set<string>() }
    const refresh = Effect.promise(async () => {
      const hooks = new Set<string>()
      const mods = new Set<string>()
      for (const root of roots) {
        for (const name of await readEnabled(root, "hooks")) hooks.add(name)
        for (const name of await readEnabled(root, "mods")) mods.add(name)
      }
      active.hooks = hooks
      active.mods = mods
    }).pipe(Effect.catch((error) => Effect.logWarning("OnethyCode native descriptors unavailable", { error })))
    yield* refresh
    yield* ctx.event.subscribe({ types: ["config.updated"] }).pipe(
      Stream.runForEach(() => refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* ctx.permission.hook("evaluate", (event) => Effect.sync(() => {
      if (event.action !== "bash" && event.action !== "shell") return
      for (const resource of event.resources) {
        const reason = hookViolation(resource, active.hooks)
        if (!reason) continue
        event.effect = "deny"
        event.message = reason
        return
      }
    }))
    yield* ctx.tool.hook("execute.after", (event) => Effect.sync(() => {
      if (event.status !== "completed" || !active.mods.has("secret-redactor")) return
      const result = event.result
      if (typeof result.content === "string") {
        event.result = { ...result, content: redact(result.content) }
        return
      }
      if (!Array.isArray(result.content)) return
      event.result = {
        ...result,
        content: result.content.map((item) =>
          item.type === "text" ? { ...item, text: redact(item.text) } : item,
        ),
      }
    }))
  }),
})
