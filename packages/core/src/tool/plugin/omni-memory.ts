export * as OmniMemoryTool from "./omni-memory.js"

import fs from "node:fs"
import path from "node:path"
import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Location } from "../../location.js"
import { Global } from "@opencode/util/global"
import {
  GLOBAL_TEMPLATES,
  PROJECT_TEMPLATES,
  globalMemoryDirectory,
  projectMemoryDirectory,
  memoryFilename,
  globalMemoryFilename,
  readMemoryFile,
  initializeMemoryBank,
  writeMemoryFile,
  deleteMemoryFile,
} from "../../omni-memory-bank.js"

export const name = "omni_memory"

export const Input = Schema.Struct({
  scope: Schema.optionalKey(Schema.Literals(["project", "global"])).annotate({
    description: "project (default) keeps project context isolated; global shares preferences across workspaces.",
  }),
  confirm: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Required to delete or clear global memory (only after the user explicitly asks).",
  }),
  action: Schema.Literals(["read", "update", "init", "status", "delete", "clear"]).annotate({
    description:
      "Action to perform: 'read' reads memory bank files; 'update' updates a memory bank file; 'init' initializes the 4 memory bank files; 'status' checks memory bank readiness; 'delete' deletes a specific memory bank file; 'clear' clears all memory bank files.",
  }),
  file: Schema.optionalKey(
    Schema.String,
  ).annotate({
    description: "Specific memory bank file to target (e.g. 'project-brief', 'system-patterns', 'tech-context', 'active-context', 'all', or filename).",
  }),
  content: Schema.optionalKey(Schema.String).annotate({
    description: "New markdown content when action is 'update'.",
  }),
  append: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Whether to append to the file rather than replace entire content.",
  }),
})

export const Output = Schema.Struct({
  action: Schema.String,
  summary: Schema.String,
  data: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})

export const description = [
  "Persistent project and global memory banks.",
  "scope='project' (default): .omnicode/memory-bank/; scope='global': user config/memory-bank/.",
  "Global memory is available in all projects, but modifications require an explicit user request.",
  "Never store credentials, passwords, tokens, customer data or secrets in global memory.",
  "Stores architectural decisions, project requirements, tech stack constraints, and current task focus across sessions.",
  "- 'read': Retrieves memory bank files so agents remember project patterns without context amnesia.",
  "- 'update': Writes or updates 'project-brief', 'system-patterns', 'tech-context', or 'active-context'.",
  "- 'init': Scaffolds the memory bank templates if they do not yet exist.",
  "- 'status': Checks memory bank existence and last modified dates.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.omni_memory",
  effect: Effect.fn("OmniMemoryTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service
    const global = yield* Global.Service

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
              const scope = params.scope ?? "project"
              const memoryDir = scope === "global"
                ? globalMemoryDirectory(global.config)
                : projectMemoryDirectory(rootDir)
              const templates = scope === "global" ? GLOBAL_TEMPLATES : PROJECT_TEMPLATES
              const scopeLabel = scope === "global" ? "global" : "do projeto"
              const selectFilename = (name: string) =>
                scope === "global" ? globalMemoryFilename(name) : memoryFilename(name)

              if (scope === "global" && (params.action === "delete" || params.action === "clear") && !params.confirm) {
                return yield* new ToolFailure({
                  message: "To delete global memory, ask the user to confirm and set confirm=true.",
                })
              }

              const ensureDir = () => {
                fs.mkdirSync(memoryDir, { recursive: true, mode: 0o700 })
              }

              if (params.action === "init") {
                const created = initializeMemoryBank(memoryDir, templates)
                const summary =
                  created.length > 0
                    ? `Memory Bank ${scopeLabel} inicializado (${created.join(", ")}).`
                    : `Memory Bank ${scopeLabel} já estava inicializado.`
                return {
                  output: { action: "init", summary },
                  content: summary,
                  metadata: { action: "init" },
                }
              }

              if (params.action === "status") {
                if (!fs.existsSync(memoryDir)) {
                  const summary = "Memory Bank não inicializado. Use action 'init' para criar os arquivos modelo."
                  return {
                    output: { action: "status", summary },
                    content: summary,
                    metadata: { action: "status" },
                  }
                }
                const files = fs.readdirSync(memoryDir).filter((f) => {
                  try {
                    selectFilename(f)
                    const stat = fs.lstatSync(path.join(memoryDir, f))
                    return stat.isFile() && !stat.isSymbolicLink()
                  } catch { return false }
                })
                const details = files.map((f) => {
                  const stat = fs.statSync(path.join(memoryDir, f))
                  return `${f} (${stat.size} bytes, modificado em ${stat.mtime.toLocaleTimeString()})`
                })
                const summary = `Memory Bank ativo com ${files.length} arquivos:\n- ${details.join("\n- ")}`
                return {
                  output: { action: "status", summary },
                  content: summary,
                  metadata: { action: "status" },
                }
              }

              if (params.action === "read") {
                if (!fs.existsSync(memoryDir)) {
                  initializeMemoryBank(memoryDir, templates)
                }

                const targetFiles =
                  !params.file || params.file === "all"
                    ? Object.keys(templates)
                    : [selectFilename(params.file)]

                const contents: Record<string, string> = {}
                const blocks: string[] = []

                for (const f of targetFiles) {
                  const data = readMemoryFile(memoryDir, f)
                  if (data !== undefined) {
                    contents[f] = data
                    blocks.push(`=== ${f} ===\n${data}`)
                  }
                }

                const summary = blocks.join("\n\n") || "Nenhum arquivo encontrado no Memory Bank."
                return {
                  output: { action: "read", summary, data: contents },
                  content: summary,
                  metadata: { action: "read" },
                }
              }

              if (params.action === "update") {
                if (scope === "global" && !params.content?.trim()) {
                  return yield* new ToolFailure({
                    message: "Global memory updates require nonempty content. Use delete with confirmation to remove entries.",
                  })
                }
                ensureDir()
                const fileName = selectFilename(params.file ?? (scope === "global" ? "preferences" : "active-context"))
                const contentToWrite = params.content ?? ""
                // New global preferences append by default: never overwrite earlier memory by accident.
                writeMemoryFile(memoryDir, fileName, contentToWrite, params.append ?? (scope === "global"))

                const summary = `Arquivo '${fileName}' atualizado no Memory Bank ${scopeLabel}.`
                return {
                  output: { action: "update", summary },
                  content: summary,
                  metadata: { action: "update", file: fileName },
                }
              }

              if (params.action === "delete") {
                ensureDir()
                const fileName = selectFilename(params.file ?? (scope === "global" ? "preferences" : "active-context"))
                if (deleteMemoryFile(memoryDir, fileName)) {
                  const summary = `Arquivo '${fileName}' excluído do Memory Bank com sucesso.`
                  return {
                    output: { action: "delete", summary },
                    content: summary,
                    metadata: { action: "delete", file: fileName },
                  }
                }
                const summary = `Arquivo '${fileName}' não encontrado no Memory Bank.`
                return {
                  output: { action: "delete", summary },
                  content: summary,
                  metadata: { action: "delete", file: fileName },
                }
              }

              if (params.action === "clear") {
                if (fs.existsSync(memoryDir)) {
                  const files = fs.readdirSync(memoryDir)
                  let count = 0
                  for (const f of files) {
                    try {
                      selectFilename(f)
                      if (deleteMemoryFile(memoryDir, f)) count++
                    } catch {}
                  }
                  const summary = `Banco de memória ${scopeLabel} limpo: ${count} arquivos removidos.`
                  return {
                    output: { action: "clear", summary },
                    content: summary,
                    metadata: { action: "clear" },
                  }
                }
                const summary = "Memory Bank não inicializado."
                return {
                  output: { action: "clear", summary },
                  content: summary,
                  metadata: { action: "clear" },
                }
              }

              return yield* new ToolFailure({ message: `Ação '${params.action}' não reconhecida.` })
            }),
        })
      })
      .pipe(Effect.asVoid)
  }),
}
