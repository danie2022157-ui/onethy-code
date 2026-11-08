export * as OmniCommitTool from "./omni-commit.js"

import child_process from "node:child_process"
import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Location } from "../../location.js"
import { isSensitiveCommitPath, parseChangedGitPaths } from "../../omni-commit-safety.js"

export const name = "omni_commit"

export const Input = Schema.Struct({
  action: Schema.Literals(["status", "generate_message", "commit_all"]).annotate({
    description:
      "Action: 'status' inspects staged/unstaged changes; 'generate_message' suggests a conventional commit message; 'commit_all' stages all files and commits.",
  }),
  message: Schema.optionalKey(Schema.String).annotate({
    description:
      "Commit message string. If omitted during 'commit_all', a conventional commit message is generated automatically.",
  }),
})

export const Output = Schema.Struct({
  action: Schema.String,
  summary: Schema.String,
  suggestedMessage: Schema.optionalKey(Schema.String),
  commitHash: Schema.optionalKey(Schema.String),
})

export const description = [
  "Intelligent Conventional Git Commit Engine (Aider pattern).",
  "Analyzes working tree modifications, diff hunks, and package scopes to generate conventional commit messages (feat, fix, refactor, perf, chore, test).",
  "- 'status': Shows modified, added, and deleted files with git diff summary.",
  "- 'generate_message': Produces a conventional commit message based on modified files.",
  "- 'commit_all': Stages all modified files and commits atomically.",
].join("\n")

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

function deriveConventionalCommit(files: string[]): string {
  if (files.length === 0) return "chore: update repository files"

  const hasTui = files.some((f) => f.includes("packages/tui") || f.includes("tui/"))
  const hasCore = files.some((f) => f.includes("packages/core") || f.includes("core/"))
  const hasCli = files.some((f) => f.includes("packages/cli") || f.includes("cli/"))
  const hasTest = files.some((f) => f.includes("test") || f.includes("spec"))
  const hasDocs = files.some((f) => f.endsWith(".md") || f.includes("doc"))

  const scope = hasTui && hasCore ? "tui,core" : hasTui ? "tui" : hasCore ? "core" : hasCli ? "cli" : undefined
  const scopeStr = scope ? `(${scope})` : ""

  const isFix = files.some((f) => /fix|bug|patch/i.test(f))
  const isDocOnly = hasDocs && files.every((f) => f.endsWith(".md"))

  if (isDocOnly) return `docs: update documentation`
  if (hasTest && files.length <= 2) return `test${scopeStr}: update tests`
  if (isFix) return `fix${scopeStr}: resolve issues and refine implementation`

  const basenames = files
    .slice(0, 3)
    .map((f) => f.split("/").pop()?.replace(/\.[^.]+$/, ""))
    .filter(Boolean)
  return `feat${scopeStr}: implement ${basenames.join(", ")} updates`
}

export const Plugin = {
  id: "opencode.tool.omni_commit",
  effect: Effect.fn("OmniCommitTool.Plugin")(function* (ctx: Context) {
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

              const statusRes = runGit(rootDir, ["status", "--porcelain"])
              if (statusRes.code !== 0) return yield* new ToolFailure({ message: "Cannot inspect Git status: " + statusRes.stderr })
              const statusLines = statusRes.stdout
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)

              const modifiedFiles = statusLines.map((l) => l.slice(3).trim())

              if (params.action === "status") {
                if (statusLines.length === 0) {
                  const summary = "Árvore de trabalho limpa. Nenhuma alteração pendente para commit."
                  return {
                    output: { action: "status", summary },
                    content: summary,
                    metadata: { action: "status" },
                  }
                }
                const diffStat = runGit(rootDir, ["diff", "--stat"]).stdout
                const summary = `Arquivos modificados (${statusLines.length}):\n${statusLines.join("\n")}\n\nDiff resumo:\n${diffStat}`
                return {
                  output: { action: "status", summary },
                  content: summary,
                  metadata: { action: "status", count: statusLines.length },
                }
              }

              if (params.action === "generate_message") {
                if (statusLines.length === 0) {
                  const summary = "Nenhum arquivo alterado para gerar mensagem de commit."
                  return {
                    output: { action: "generate_message", summary, suggestedMessage: "chore: no changes" },
                    content: summary,
                    metadata: { action: "generate_message" },
                  }
                }
                const msg = deriveConventionalCommit(modifiedFiles)
                const summary = `Mensagem convencional sugerida:\n${msg}`
                return {
                  output: { action: "generate_message", summary, suggestedMessage: msg },
                  content: summary,
                  metadata: { action: "generate_message", suggestedMessage: msg },
                }
              }

              if (params.action === "commit_all") {
                if (statusLines.length === 0) {
                  return yield* new ToolFailure({
                    message: "Nada para commitar: a árvore de trabalho está limpa.",
                  })
                }

                // Never bulk-stage credentials, Onethy runtime memory or saved sessions.
                // Run a separate -z preflight so unusual filenames cannot bypass filtering.
                const pending = runGit(rootDir, ["status", "--porcelain=v1", "--untracked-files=all", "-z"])
                if (pending.code !== 0) return yield* new ToolFailure({ message: "Cannot inspect pending Git files." })
                const risky = parseChangedGitPaths(pending.stdout).filter(isSensitiveCommitPath)
                if (risky.length > 0) return yield* new ToolFailure({
                  message: "Bulk commit blocked: sensitive/runtime files detected (" + risky.join(", ") + "). Review and stage allowed files manually.",
                })

                // git add -A
                const addRes = runGit(rootDir, ["add", "-A"])
                if (addRes.code !== 0) {
                  return yield* new ToolFailure({
                    message: `Erro ao adicionar arquivos ao git: ${addRes.stderr}`,
                  })
                }

                const commitMsg = params.message?.trim() || deriveConventionalCommit(modifiedFiles)
                const commitRes = runGit(rootDir, ["commit", "-m", commitMsg])

                if (commitRes.code !== 0) {
                  return yield* new ToolFailure({
                    message: `Erro ao executar git commit: ${commitRes.stderr || commitRes.stdout}`,
                  })
                }

                const hashRes = runGit(rootDir, ["rev-parse", "HEAD"])
                const hash = hashRes.stdout.trim()

                const summary = `✅ Commit realizado com sucesso!\n- Hash: ${hash.slice(0, 8)}\n- Mensagem: "${commitMsg}"\n- Arquivos commitados: ${modifiedFiles.length}`
                return {
                  output: {
                    action: "commit_all",
                    summary,
                    commitHash: hash,
                    suggestedMessage: commitMsg,
                  },
                  content: summary,
                  metadata: { action: "commit_all", commitHash: hash },
                }
              }

              return yield* new ToolFailure({ message: `Ação '${params.action}' não reconhecida.` })
            }),
        })
      })
      .pipe(Effect.asVoid)
  }),
}
