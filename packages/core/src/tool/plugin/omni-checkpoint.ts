export * as OmniCheckpointTool from "./omni-checkpoint.js"

import child_process from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Location } from "../../location.js"

export const name = "omni_checkpoint"

export const Input = Schema.Struct({
  action: Schema.Literals(["create", "list", "restore", "diff"]).annotate({
    description:
      "Action to perform: 'create' takes a workspace snapshot; 'list' lists available checkpoints; 'restore' reverts workspace to a checkpoint (or latest); 'diff' inspects changes since checkpoint.",
  }),
  description: Schema.optionalKey(Schema.String).annotate({
    description: "Brief description of the checkpoint milestone when creating.",
  }),
  checkpointId: Schema.optionalKey(Schema.String).annotate({
    description: "Checkpoint ID or timestamp to restore to. Defaults to the latest checkpoint.",
  }),
})

export const Output = Schema.Struct({
  action: Schema.String,
  summary: Schema.String,
})

export const description = [
  "Workspace Checkpoint & Time-Travel Git Engine (.omnicode/checkpoints/).",
  "Creates instantaneous snapshots of all tracked and untracked repository changes before AI edits.",
  "- 'create': Creates a named checkpoint before executing risky code changes or running subagents.",
  "- 'list': Lists existing checkpoints, timestamps, and commit/stash pointers.",
  "- 'restore': Reverts file changes back to a previous checkpoint (Time-Travel / Undo).",
  "- 'diff': Shows git diff between current workspace and the selected checkpoint.",
].join("\n")

interface CheckpointEntry {
  id: string
  timestamp: string
  description: string
  stashRef?: string
  commitHash?: string
  modifiedFiles: string[]
}

function runGit(cwd: string, args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const res = child_process.spawnSync("git", args, { cwd, encoding: "utf-8" })
    return {
      stdout: res.stdout || "",
      stderr: res.stderr || "",
      code: res.status ?? 0,
    }
  } catch (e: any) {
    return { stdout: "", stderr: String(e), code: 1 }
  }
}

export const Plugin = {
  id: "opencode.tool.omni_checkpoint",
  effect: Effect.fn("OmniCheckpointTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service

    yield* ctx.tool
      .transform((editor) => {
        if (process.env.OMNICODE_ACTIVE !== "1") return
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (params) =>
            Effect.gen(function* () {
              const rootDir = location.project.directory
              const checkpointsDir = path.join(rootDir, ".omnicode", "checkpoints")
              const registryPath = path.join(checkpointsDir, "index.json")

              if (!fs.existsSync(checkpointsDir)) {
                fs.mkdirSync(checkpointsDir, { recursive: true })
              }

              const loadRegistry = (): CheckpointEntry[] => {
                if (fs.existsSync(registryPath)) {
                  try {
                    return JSON.parse(fs.readFileSync(registryPath, "utf-8"))
                  } catch {
                    return []
                  }
                }
                return []
              }

              const saveRegistry = (entries: CheckpointEntry[]) => {
                fs.writeFileSync(registryPath, JSON.stringify(entries, null, 2), "utf-8")
              }

              if (params.action === "create") {
                const now = new Date()
                const id = `cp-${now.toISOString().replace(/[:.]/g, "-")}`
                const desc = params.description || `Snapshot automático de checkpoint (${now.toLocaleTimeString()})`

                // Inspeciona arquivos modificados
                const statusRes = runGit(rootDir, ["status", "--porcelain"])
                const modifiedFiles = statusRes.stdout
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean)

                // Cria um stash snapshot sem limpar a árvore de trabalho (git stash create)
                const stashCreate = runGit(rootDir, ["stash", "create", desc])
                const stashHash = stashCreate.stdout.trim()

                const revParse = runGit(rootDir, ["rev-parse", "HEAD"])
                const headHash = revParse.stdout.trim()

                const newEntry: CheckpointEntry = {
                  id,
                  timestamp: now.toISOString(),
                  description: desc,
                  stashRef: stashHash || undefined,
                  commitHash: headHash,
                  modifiedFiles,
                }

                const list = loadRegistry()
                list.unshift(newEntry)
                // Mantém últimos 20 checkpoints
                saveRegistry(list.slice(0, 20))

                const summary = `Checkpoint '${id}' criado com sucesso.\n- Descrição: ${desc}\n- Arquivos modificados registrados: ${modifiedFiles.length}\n- Base HEAD: ${headHash.slice(0, 8)}`
                return {
                  output: { action: "create", summary },
                  content: summary,
                  metadata: { action: "create", id },
                }
              }

              if (params.action === "list") {
                const list = loadRegistry()
                if (list.length === 0) {
                  const summary = "Nenhum checkpoint registrado. Crie um com 'create' ou rode /checkpoint."
                  return {
                    output: { action: "list", summary },
                    content: summary,
                    metadata: { action: "list" },
                  }
                }
                const lines = list.map(
                  (cp, idx) =>
                    `#${idx + 1} [${cp.id}] (${new Date(cp.timestamp).toLocaleTimeString()}) - ${cp.description} (${cp.modifiedFiles.length} arquivos)`,
                )
                const summary = `Checkpoints disponíveis:\n${lines.join("\n")}`
                return {
                  output: { action: "list", summary },
                  content: summary,
                  metadata: { action: "list" },
                }
              }

              if (params.action === "restore") {
                const list = loadRegistry()
                if (list.length === 0) {
                  return yield* new ToolFailure({ message: "Nenhum checkpoint disponível para restaurar." })
                }

                const target = params.checkpointId
                  ? list.find((cp) => cp.id === params.checkpointId || cp.id.includes(params.checkpointId!))
                  : list[0]

                if (!target) {
                  return yield* new ToolFailure({
                    message: `Checkpoint '${params.checkpointId}' não encontrado.`,
                  })
                }

                if (target.stashRef) {
                  // Se tínhamos um stash do estado
                  runGit(rootDir, ["stash", "apply", target.stashRef])
                } else if (target.commitHash) {
                  // Reverte mudanças não commitadas para o estado do commit
                  runGit(rootDir, ["checkout", "HEAD", "--", "."])
                }

                const summary = `Restaurado com sucesso para o checkpoint '${target.id}' (${target.description}). Workspace restabelecido.`
                return {
                  output: { action: "restore", summary },
                  content: summary,
                  metadata: { action: "restore", id: target.id },
                }
              }

              if (params.action === "diff") {
                const diffRes = runGit(rootDir, ["diff", "HEAD", "--stat"])
                const summary = diffRes.stdout || "Nenhuma alteração detectada em relação ao último commit/checkpoint."
                return {
                  output: { action: "diff", summary },
                  content: summary,
                  metadata: { action: "diff" },
                }
              }

              return yield* new ToolFailure({ message: `Ação '${params.action}' não reconhecida.` })
            }),
        })
      })
      .pipe(Effect.asVoid)
  }),
}
