export * as OmniBus from "./omni-bus.js"

import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer, Semaphore } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Location } from "./location.js"

export type MessageType = "plan" | "artifact" | "review_verdict" | "status" | "handoff" | "question"

export interface AgentMessage {
  readonly id: string
  readonly sender: string
  readonly target: string
  readonly taskId: string
  readonly sessionID?: string
  readonly parentSessionID?: string
  readonly type: MessageType
  readonly payload: unknown
  readonly timestamp: number
}

export interface PublishInput {
  readonly sender: string
  readonly target?: string
  readonly taskId?: string
  readonly sessionID?: string
  readonly parentSessionID?: string
  readonly type?: MessageType
  readonly payload?: unknown
}

export interface Interface {
  readonly publish: (input: PublishInput) => Effect.Effect<AgentMessage, never>
  readonly list: () => Effect.Effect<ReadonlyArray<AgentMessage>, never>
  readonly listByTask: (taskId: string) => Effect.Effect<ReadonlyArray<AgentMessage>, never>
  readonly listBySession: (sessionID: string) => Effect.Effect<ReadonlyArray<AgentMessage>, never>
  readonly formatContextDigest: (sessionID?: string, limit?: number) => Effect.Effect<string, never>
  readonly clear: () => Effect.Effect<void, never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OmniBus") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const workspace = location.directory ?? location.project.canonical ?? location.project.directory
    const busFilePath = path.join(workspace, ".omnicode", "bus.json")
    const messages: AgentMessage[] = []
    const persistenceLock = Semaphore.makeUnsafe(1)

    const loadPersisted = Effect.promise(async () => {
      try {
        const raw = await fs.readFile(busFilePath, "utf-8")
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? (parsed as AgentMessage[]) : []
      } catch {
        return []
      }
    })

    const savePersisted = (all: ReadonlyArray<AgentMessage>) =>
      Effect.promise(async () => {
        try {
          await fs.mkdir(path.dirname(busFilePath), { recursive: true })
          const recent = all.slice(-100)
          await fs.writeFile(busFilePath, JSON.stringify(recent, null, 2), "utf-8")
        } catch {
          // Best-effort persistence for cross-session sync
        }
      })

    const mergedMessages = Effect.gen(function* () {
      const disk = yield* loadPersisted
      const byId = new Map<string, AgentMessage>()
      for (const m of disk) byId.set(m.id, m)
      for (const m of messages) byId.set(m.id, m)
      return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp)
    })

    const publish = Effect.fn("OmniBus.publish")(function* (input: PublishInput) {
      const message: AgentMessage = {
        id: crypto.randomUUID(),
        sender: input.sender,
        target: input.target ?? "*",
        taskId: input.taskId ?? "",
        sessionID: input.sessionID,
        parentSessionID: input.parentSessionID,
        type: input.type ?? "status",
        payload: input.payload ?? null,
        timestamp: Date.now(),
      }
      yield* persistenceLock.withPermit(
        Effect.gen(function* () {
          messages.push(message)
          if (process.env.OMNICODE_ACTIVE === "1") {
            const all = yield* mergedMessages
            yield* savePersisted(all)
          }
        }),
      )
      return message
    })

    const list = Effect.fn("OmniBus.list")(function* () {
      return yield* persistenceLock.withPermit(
        process.env.OMNICODE_ACTIVE === "1" ? mergedMessages : Effect.sync(() => [...messages]),
      )
    })

    const listByTask = Effect.fn("OmniBus.listByTask")(function* (taskId: string) {
      const all = yield* list()
      return all.filter((m) => m.taskId === taskId)
    })

    const listBySession = Effect.fn("OmniBus.listBySession")(function* (sessionID: string) {
      const all = yield* list()
      return all.filter(
        (m) =>
          m.target === "*" ||
          m.target === sessionID ||
          m.sessionID === sessionID ||
          m.parentSessionID === sessionID,
      )
    })

    const formatContextDigest = Effect.fn("OmniBus.formatContextDigest")(function* (
      sessionID?: string,
      limit = 6,
    ) {
      const relevant = sessionID ? yield* listBySession(sessionID) : yield* list()
      const recent = relevant.slice(-limit)
      if (recent.length === 0) return ""
      const lines = recent.map((m) => {
        const text =
          typeof m.payload === "string"
            ? m.payload
            : JSON.stringify(m.payload).slice(0, 300)
        return `- [${m.type.toUpperCase()}] de ${m.sender}${m.target !== "*" ? ` -> ${m.target}` : ""}${m.taskId ? ` (${m.taskId})` : ""}: ${text}`
      })
      return ["[BARRAMENTO COMPARTILHADO ENTRE SESSÕES (OmniBus)]", ...lines].join("\n")
    })

    const clear = Effect.fn("OmniBus.clear")(function* () {
      yield* persistenceLock.withPermit(
        Effect.gen(function* () {
          messages.length = 0
          if (process.env.OMNICODE_ACTIVE === "1") yield* savePersisted([])
        }),
      )
    })

    return Service.of({ publish, list, listByTask, listBySession, formatContextDigest, clear })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node],
})
