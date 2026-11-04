export * as ConfigMcpPlugin from "./mcp.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Document, type Entry } from "@opencode/schema/config"
import type { ServerConfig } from "@opencode/schema/mcp"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Stream } from "effect"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import { Config } from "../../config.js"
import { Mcp } from "../../mcp/index.js"

export const Plugin = define({
  id: "opencode.config.mcp",
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx.event.subscribe({ types: ["config.updated"] }))
  }),
})

export const register = Effect.fn("ConfigMCPPlugin.register")(function* (
  events: Stream.Stream<{ readonly type: string }, unknown>,
) {
  const config = yield* Config.Service
  const mcp = yield* Mcp.Service
  const fsOpt = yield* Effect.serviceOption(FSUtil.Service)
  const loaded = { entries: [] as Entry[], directoryServers: new Map<string, ServerConfig>() }

  const scanDirectoryMcps = Effect.fnUntraced(function* (entries: Entry[]) {
    const found = new Map<string, ServerConfig>()
    if (process.env.OMNICODE_ACTIVE !== "1" || fsOpt._tag === "None") return found
    const fs = fsOpt.value
    const roots = config.compatibility ? yield* config.compatibility() : { claude: [], agents: [] }
    const directories = [
      ...entries.flatMap((entry) => (entry.type === "directory" ? [entry.path] : [])),
      ...roots.claude,
      ...roots.agents,
    ]
    const files = new Set<string>()
    for (const directory of directories) {
      const scanned = yield* fs
        .scan("{mcp,mcps}/**/*.{json,jsonc}", { cwd: directory, absolute: true, dot: true, symlink: false })
        .pipe(Effect.orElseSucceed(() => [] as string[]))
      for (const file of scanned.slice(0, 150)) files.add(file)
      // Import familiar MCP configurations from Claude, Cursor and VS Code as disabled-by-default.
      // A file on disk must never grant itself execution permission.
      const explicit = [
        "mcp.json", "mcp.jsonc", ".mcp.json", ".mcp.jsonc",
        ".cursor/mcp.json", ".cursor/mcp.jsonc",
        ".vscode/mcp.json", ".vscode/mcp.jsonc",
        ".claude/mcp.json", ".claude/mcp.jsonc",
        ".agents/mcp.json", ".agents/mcp.jsonc",
      ]
      for (const relative of explicit) {
        const pathname = directory + "/" + relative
        if (yield* fs.isFile(pathname).pipe(Effect.orElseSucceed(() => false))) files.add(pathname)
      }
    }
    for (const file of [...files].toSorted()) {
      const root = directories.find((directory) => isContained(directory, file))
      if (!root) continue
      const [realRoot, realFile] = yield* Effect.all([fs.realPath(root), fs.realPath(file)]).pipe(
        Effect.orElseSucceed(() => [undefined, undefined] as const),
      )
      if (!realRoot || !realFile || !isContained(realRoot, realFile)) continue
      const text = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
      if (!text || Buffer.byteLength(text, "utf8") > 128 * 1024) continue
      for (const [safeName, server] of decodeDiscovered(text)) {
        if (found.has(safeName)) {
          yield* Effect.logWarning("ignoring colliding discovered MCP server name", { name: safeName })
          continue
        }
        found.set(safeName, server)
      }
    }
    return found
  })

  const refreshEntries = Effect.gen(function* () {
    const entries = yield* config.entries()
    const dirServers = yield* scanDirectoryMcps(entries)
    loaded.entries = entries
    loaded.directoryServers = dirServers
  })

  yield* events.pipe(
    Stream.filter((event) => event.type === "config.updated"),
    Stream.runForEach(() =>
      refreshEntries.pipe(
        Effect.andThen(mcp.reload()),
        Effect.catchCause((cause) => Effect.logError("failed to reload MCP config", { cause })),
      ),
    ),
    Effect.ignore,
    Effect.forkScoped({ startImmediately: true }),
  )

  if (process.env.OMNICODE_ACTIVE === "1") {
    yield* config.changes().pipe(
      Stream.filter((update) => /\b(mcp|mcps)\b/i.test(update.path)),
      Stream.debounce("150 millis"),
      Stream.runForEach(() =>
        refreshEntries.pipe(
          Effect.andThen(mcp.reload()),
          Effect.catchCause(() => Effect.void),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }

  // Subscribe before the initial load so updates racing it trigger a rebuild.
  yield* refreshEntries
  yield* mcp.transform((editor) => {
    const documents = loaded.entries.filter((entry): entry is Document => entry.type === "document")
    // Global timeout defaults merge in config order; each server can override them.
    const timeout = Object.assign(
      {},
      ...documents.flatMap((entry) => (entry.info.mcp?.timeout ? [entry.info.mcp.timeout] : [])),
    )
    const servers = mergeServers(loaded.directoryServers, documents)
    for (const [name, server] of servers) {
      if (editor.get(name)) continue
      editor.set(name, { ...server, timeout: { ...timeout, ...server.timeout } })
    }
  })
})

export function decodeDiscovered(text: string) {
  const found = new Map<string, ServerConfig>()
  try {
    const errors: ParseError[] = []
    const parsed = parseJsonc(text, errors, { allowTrailingComma: true }) as
      | { mcpServers?: unknown; servers?: unknown; mcp?: unknown }
      | undefined
    if (errors.length || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) return found
    const nested = parsed.mcp && typeof parsed.mcp === "object" && !Array.isArray(parsed.mcp)
      ? parsed.mcp as { servers?: unknown }
      : undefined
    const rawServers = parsed.mcpServers ?? parsed.servers ?? nested?.servers ?? parsed.mcp ?? {}
    if (!rawServers || typeof rawServers !== "object" || Array.isArray(rawServers)) return found
    for (const [rawName, value] of Object.entries(rawServers)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue
      const srv = value as Record<string, unknown>
      const safeName = discoveredName(rawName)
      if (
        !safeName ||
        found.has(safeName) ||
        /\$\{input:|<your-|your[-_](api[-_])?(key|token)|<personal-access-token>/i.test(JSON.stringify(srv))
      )
        continue
      const common = {
        // Discovered files cannot approve themselves; only canonical config can enable a server.
        disabled: true,
        ...(typeof srv.codemode === "boolean" ? { codemode: srv.codemode } : {}),
        ...(isTimeout(srv.timeout) ? { timeout: srv.timeout } : {}),
        ...(isProtocol(srv.protocol) ? { protocol: srv.protocol } : {}),
      }
      if (typeof srv.url === "string" && /^https?:\/\//i.test(srv.url)) {
        found.set(safeName, {
          type: "remote",
          url: srv.url,
          ...common,
          ...(isStringRecord(srv.headers) ? { headers: srv.headers } : {}),
          ...(srv.oauth === false || isOAuth(srv.oauth) ? { oauth: srv.oauth } : {}),
        })
        continue
      }
      if (typeof srv.command !== "string" && !Array.isArray(srv.command)) continue
      const command = typeof srv.command === "string" ? [srv.command] : srv.command.filter((arg): arg is string => typeof arg === "string")
      if (!command.length) continue
      if (process.platform === "win32" && ["npx", "npm", "pnpm", "yarn"].includes(command[0])) command[0] += ".cmd"
      found.set(safeName, {
        type: "local",
        command: [...command, ...(Array.isArray(srv.args) ? srv.args.map(String) : [])],
        ...common,
        ...(isStringRecord(srv.env) ? { environment: srv.env } : isStringRecord(srv.environment) ? { environment: srv.environment } : {}),
      })
    }
  } catch {}
  return found
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((item) => typeof item === "string")
}

export function discoveredName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, "-")
}

export function mergeServers(discovered: Map<string, ServerConfig>, documents: readonly Document[]) {
  const servers = new Map(discovered)
  for (const document of documents) {
    const config = document.info.mcp
    for (const [name, server] of Object.entries(config?.servers ?? {})) servers.set(name, server)
    // An explicit enable/disable entry is trusted config, unlike auto-discovered MCP files.
    // Apply it after this layer's full definitions, preserving higher-precedence overrides.
    for (const [name, enabled] of Object.entries(config?.overrides ?? {})) {
      const previous = servers.get(name)
      if (previous) servers.set(name, { ...previous, disabled: !enabled })
    }
  }
  return servers
}

export function isContained(root: string, target: string) {
  return FSUtil.contains(root, target)
}

function isTimeout(value: unknown): value is { startup?: number; catalog?: number; execution?: number } {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((item) => typeof item === "number" && item > 0)
}

function isProtocol(value: unknown): value is "legacy" | "auto" | "2026-07-28" {
  return value === "legacy" || value === "auto" || value === "2026-07-28"
}

function isOAuth(value: unknown): value is Record<string, string> {
  return isStringRecord(value)
}
