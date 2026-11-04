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
  confirm: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Restore requires explicit confirmation. This action is never automatic.",
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
  "Saves a durable Git snapshot of tracked changes; untracked files are NOT included and are never deleted.",
  "- 'create': Creates a named checkpoint before executing risky code changes or running subagents.",
  "- 'list': Lists existing checkpoints, timestamps, and commit/stash pointers.",
  "- 'restore': Applies saved tracked changes only on a clean worktree and the original HEAD, with explicit confirmation.",
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
      code: res.error ? 1 : (res.status ?? 1),
    }
  } catch (e: unknown) {
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

                const head = runGit(rootDir, ["rev-parse", "--verify", "HEAD"])
                const status = runGit(rootDir, ["status", "--porcelain=v1", "--untracked-files=all"])
                if (head.code !== 0 || status.code !== 0 || !/^[a-f0-9]{40}$/i.test(head.stdout.trim())) {
                  return yield* new ToolFailure({ message: "Checkpoint requires a valid Git repository with a HEAD commit." })
                }
                const untracked = status.stdout.split("\n").filter((line) => line.startsWith("?? ") && !line.slice(3).startsWith(".omnicode/checkpoints/"))
                const modifiedFiles = status.stdout.split("\n").filter(Boolean)
                const stashCreate = runGit(rootDir, ["stash", "create", desc])
                if (stashCreate.code !== 0) {
                  return yield* new ToolFailure({ message: "Could not create Git checkpoint: " + stashCreate.stderr })
                }
                const stashHash = stashCreate.stdout.trim()
                if (stashHash && !/^[a-f0-9]{40}$/i.test(stashHash)) {
                  return yield* new ToolFailure({ message: "Git returned an invalid checkpoint reference." })
                }
                // Pin the snapshot so Git garbage collection cannot silently erase the saved commit.
                if (stashHash) {
                  const pinned = runGit(rootDir, ["update-ref", `refs/onethy/checkpoints/${id}`, stashHash])
                  if (pinned.code !== 0) return yield* new ToolFailure({ message: "Could not retain the checkpoint Git object: " + pinned.stderr })
                }
                const newEntry: CheckpointEntry = {
                  id,
                  timestamp: now.toISOString(),
                  description: desc,
                  stashRef: stashHash || undefined,
                  commitHash: head.stdout.trim(),
                  modifiedFiles,
                }
                fs.mkdirSync(checkpointsDir, { recursive: true })
                const list = loadRegistry()
                list.unshift(newEntry)
                saveRegistry(list.slice(0, 20))
                const summary = `Checkpoint '${id}' saved (tracked files only).\n- Base HEAD: ${head.stdout.slice(0, 8)}\n- Changed entries: ${modifiedFiles.length}\n- Untracked files NOT saved: ${untracked.length}\n- Restore requires explicit confirmation and a clean working tree.`
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

                if (!params.confirm) {
                  return yield* new ToolFailure({ message: "Checkpoint restore needs explicit user approval and confirm=true." })
                }
                const status = runGit(rootDir, ["status", "--porcelain=v1", "--untracked-files=all"])
                const head = runGit(rootDir, ["rev-parse", "--verify", "HEAD"])
                if (status.code !== 0 || head.code !== 0) {
                  return yield* new ToolFailure({ message: "Could not verify Git safety before restore." })
                }
                if (status.stdout.trim()) {
                  return yield* new ToolFailure({ message: "Restore refused: working tree has changes. Commit, stash or back them up before restoring. No files were modified." })
                }
                if (!target.commitHash || head.stdout.trim() !== target.commitHash) {
                  return yield* new ToolFailure({ message: "Restore refused: HEAD differs from the checkpoint base. No files were modified." })
                }
                if (target.stashRef) {
                  const pinned = runGit(rootDir, ["rev-parse", "--verify", `refs/onethy/checkpoints/${target.id}`])
                  if (pinned.code !== 0 || pinned.stdout.trim() !== target.stashRef) {
                    return yield* new ToolFailure({ message: "Saved Git checkpoint object is missing or mismatched. No files were modified." })
                  }
                  const applied = runGit(rootDir, ["stash", "apply", "--index", target.stashRef])
                  if (applied.code !== 0) {
                    return yield* new ToolFailure({ message: "Git could not apply the checkpoint: " + (applied.stderr || applied.stdout) + ". Inspect the working tree; a partial apply may have occurred." })
                  }
                }

                const summary = target.stashRef
                  ? `Checkpoint '${target.id}' applied successfully (tracked files only; untracked files were not saved).`
                  : `Checkpoint '${target.id}' had no tracked changes to restore; no files were modified.`
                return {
                  output: { action: "restore", summary },
                  content: summary,
                  metadata: { action: "restore", id: target.id },
                }
              }

              if (params.action === "diff") {
                const diffRes = runGit(rootDir, ["diff", "HEAD", "--stat"])
                if (diffRes.code !== 0) return yield* new ToolFailure({ message: "Could not inspect Git diff: " + diffRes.stderr })
                const summary = diffRes.stdout || "Nenhuma alteração rastreada detectada em relação ao HEAD atual (não é comparação com checkpoint)."
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
