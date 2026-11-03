export * as OmniSession from "./omni-session.js"

import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Location } from "./location.js"

export interface StoredSession {
  readonly id: string
  readonly goal: string
  readonly mode: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly subtasksCount: number
  readonly messagesCount: number
}

export interface SaveSessionInput {
  readonly id?: string
  readonly goal: string
  readonly mode?: string
  readonly subtasks?: ReadonlyArray<unknown>
  readonly messages?: ReadonlyArray<unknown>
}

export interface Interface {
  readonly save: (input: SaveSessionInput) => Effect.Effect<string, never>
  readonly savePlan: (
    planId: string,
    goal: string,
    tasks: ReadonlyArray<{ id: string; title: string; assignedAgent: string }>,
  ) => Effect.Effect<string, never>
  readonly list: () => Effect.Effect<ReadonlyArray<StoredSession>, never>
  readonly get: (id: string) => Effect.Effect<StoredSession | undefined, never>
  readonly recordMemory: (decision: string) => Effect.Effect<void, never>
  readonly getMemory: () => Effect.Effect<string, never>
}

/** IDs become file names, so reject separators and traversal before touching the disk. */
export function safeMissionID(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error("Invalid mission or session ID")
  }
  return value
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OmniSession") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const workspace = location.directory ?? location.project.canonical ?? location.project.directory

    const sessionsDir = path.join(workspace, ".omnicode", "sessions")
    const plansDir = path.join(workspace, ".omnicode", "plans")
    const memoryPath = path.join(workspace, ".omnicode", "memory.md")

    const init = Effect.promise(async () => {
      await fs.mkdir(sessionsDir, { recursive: true })
      await fs.mkdir(plansDir, { recursive: true })
      try {
        await fs.access(memoryPath)
      } catch {
        const initial = `# 🧠 Memória Durável do Projeto (OmniCode)\n\n> Decisões arquiteturais, convenções e regras acordadas entre sessões.\n\n`
        await fs.writeFile(memoryPath, initial, "utf-8")
      }
    })

    const save = Effect.fn("OmniSession.save")(function* (input: SaveSessionInput) {
      yield* init
      const sessionId = safeMissionID(input.id ?? `ses-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`)
      const sessionFile = path.join(sessionsDir, `${sessionId}.json`)

      const record: StoredSession = {
        id: sessionId,
        goal: input.goal,
        mode: input.mode ?? "approve",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        subtasksCount: input.subtasks?.length ?? 0,
        messagesCount: input.messages?.length ?? 0,
      }

      yield* Effect.promise(async () => {
        await fs.writeFile(sessionFile, JSON.stringify(record, null, 2), "utf-8")
      })

      return sessionId
    })

    const savePlan = Effect.fn("OmniSession.savePlan")(function* (
      planId: string,
      goal: string,
      tasks: ReadonlyArray<{ id: string; title: string; assignedAgent: string }>,
    ) {
      yield* init
      const planFile = path.join(plansDir, `${safeMissionID(planId)}.md`)
      const lines = [
        `# 📋 Plano de Missão OmniCode (${planId})`,
        "",
        `**Data:** ${new Date().toISOString()}`,
        `**Meta:** ${goal}`,
        "",
        "## Subtarefas Orquestradas",
        ...tasks.map((t) => `- [ ] **[${t.id}] (@${t.assignedAgent})** — ${t.title}`),
        "",
      ]
      yield* Effect.promise(async () => {
        await fs.writeFile(planFile, lines.join("\n"), "utf-8")
      })
      return planFile
    })

    const list = Effect.fn("OmniSession.list")(function* () {
      yield* init
      return yield* Effect.promise(async () => {
        try {
          const files = await fs.readdir(sessionsDir)
          const sessions: StoredSession[] = []
          for (const file of files) {
            if (file.endsWith(".json")) {
              const raw = await fs.readFile(path.join(sessionsDir, file), "utf-8")
              sessions.push(JSON.parse(raw))
            }
          }
          return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        } catch {
          return []
        }
      })
    })

    const get = Effect.fn("OmniSession.get")(function* (id: string) {
      yield* init
      return yield* Effect.promise(async () => {
        try {
          const file = path.join(sessionsDir, `${safeMissionID(id)}.json`)
          const raw = await fs.readFile(file, "utf-8")
          return JSON.parse(raw) as StoredSession
        } catch {
          return undefined
        }
      })
    })

    const recordMemory = Effect.fn("OmniSession.recordMemory")(function* (decision: string) {
      yield* init
      yield* Effect.promise(async () => {
        const entry = `- **[${new Date().toISOString().split("T")[0]}]** ${decision}\n`
        await fs.appendFile(memoryPath, entry, "utf-8")
      })
    })

    const getMemory = Effect.fn("OmniSession.getMemory")(function* () {
      yield* init
      return yield* Effect.promise(async () => {
        try {
          return await fs.readFile(memoryPath, "utf-8")
        } catch {
          return ""
        }
      })
    })

    return Service.of({ save, savePlan, list, get, recordMemory, getMemory })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node],
})

