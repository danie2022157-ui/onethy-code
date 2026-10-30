export * as ConfigMcpPlugin from "./mcp.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Document, type Entry } from "@opencode/schema/config"
import type { ServerConfig } from "@opencode/schema/mcp"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Stream } from "effect"
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
    for (const entry of entries) {
      if (entry.type !== "directory") continue
      const files = yield* fs
        .scan("{mcp,mcps}/**/*.json", { cwd: entry.path, absolute: true, dot: true, symlink: true })
        .pipe(Effect.orElseSucceed(() => [] as string[]))
      for (const file of files.toSorted()) {
        const text = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
        if (!text) continue
        try {
          const parsed = JSON.parse(text)
          const rawServers = parsed?.mcpServers ?? parsed?.servers ?? {}
          if (!rawServers || typeof rawServers !== "object") continue
          for (const [rawName, srv] of Object.entries<Record<string, unknown>>(rawServers)) {
            const safeName = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, "-")
            if (!srv || typeof srv !== "object") continue
            const serialized = JSON.stringify(srv)
            if (
              /<your-|YOUR_[A-Z0-9_]*(KEY|TOKEN)|your[-_](api[-_])?(key|token)|<personal-access-token>|\$\{input:/i.test(
                serialized,
              )
            ) {
              continue
            }
            if (typeof srv.url === "string" && srv.url.startsWith("http")) {
              found.set(safeName, {
                type: "remote",
                url: srv.url,
                disabled: typeof srv.disabled === "boolean" ? srv.disabled : true,
              })
            } else if (typeof srv.command === "string") {
              const args = Array.isArray(srv.args) ? srv.args.map(String) : []
              found.set(safeName, {
                type: "local",
                command: [srv.command, ...args],
                disabled: typeof srv.disabled === "boolean" ? srv.disabled : true,
              })
            } else if (Array.isArray(srv.command)) {
              found.set(safeName, {
                type: "local",
                command: srv.command.map(String),
                disabled: typeof srv.disabled === "boolean" ? srv.disabled : true,
              })
            }
          }
        } catch {}
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
    const servers = new Map<string, ServerConfig>(loaded.directoryServers)
    for (const document of documents) {
      for (const [name, server] of Object.entries(document.info.mcp?.servers ?? {})) {
        servers.set(name, server)
      }
    }
    for (const [name, server] of servers) {
      if (editor.get(name)) continue
      editor.set(name, { ...server, timeout: { ...timeout, ...server.timeout } })
    }
  })
})
