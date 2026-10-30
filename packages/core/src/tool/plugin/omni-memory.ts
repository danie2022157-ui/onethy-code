export * as OmniMemoryTool from "./omni-memory.js"

import fs from "node:fs"
import path from "node:path"
import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Location } from "../../location.js"

export const name = "omni_memory"

export const Input = Schema.Struct({
  action: Schema.Literals(["read", "update", "init", "status"]).annotate({
    description:
      "Action to perform: 'read' reads memory bank files; 'update' updates a memory bank file; 'init' initializes the 4 memory bank files; 'status' checks memory bank readiness.",
  }),
  file: Schema.optionalKey(
    Schema.Literals(["project-brief", "system-patterns", "tech-context", "active-context", "all"]),
  ).annotate({
    description: "Specific memory bank file to target.",
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
  "Persistent Project Memory Bank (.omnicode/memory-bank/).",
  "Stores architectural decisions, project requirements, tech stack constraints, and current task focus across sessions.",
  "- 'read': Retrieves memory bank files so agents remember project patterns without context amnesia.",
  "- 'update': Writes or updates 'project-brief', 'system-patterns', 'tech-context', or 'active-context'.",
  "- 'init': Scaffolds the memory bank templates if they do not yet exist.",
  "- 'status': Checks memory bank existence and last modified dates.",
].join("\n")

const TEMPLATES: Record<string, string> = {
  "project-brief.md": [
    "# Project Brief",
    "",
    "## 1. Visão Geral e Objetivos",
    "- Propósito central do projeto.",
    "- Problemas que resolve e valor para os usuários.",
    "",
    "## 2. Requisitos e Escopo",
    "- Funcionalidades essenciais.",
    "- O que está explicitamente FORA de escopo.",
    "",
    "## 3. Critérios de Sucesso",
    "- Estabilidade, cobertura de testes e aderência aos requisitos.",
  ].join("\n"),
  "system-patterns.md": [
    "# System Patterns & Arquitetura",
    "",
    "## 1. Arquitetura Geral",
    "- Camadas do sistema e separação de responsabilidades.",
    "- Direção de dependências e regras de importação.",
    "",
    "## 2. Padrões de Código e Convenções",
    "- Nomenclatura, tratamento de erros e convenções de estilo.",
    "- Regras de schema e tipagem.",
    "",
    "## 3. Decisões Arquiteturais Chave (ADRs)",
    "- Decisões importantes e suas justificativas técnicas.",
  ].join("\n"),
  "tech-context.md": [
    "# Tech Context",
    "",
    "## 1. Stack Tecnológica",
    "- Runtime / Linguagens principais.",
    "- Frameworks, bibliotecas e bancos de dados.",
    "",
    "## 2. Comandos e Scripts de Desenvolvimento",
    "- Testes: comando para rodar testes.",
    "- Build / Lint / Typecheck: scripts de validação.",
    "",
    "## 3. Restrições do Ambiente",
    "- Compatibilidade de SO, variáveis de ambiente e requisitos de segurança.",
  ].join("\n"),
  "active-context.md": [
    "# Active Context",
    "",
    "## 1. Foco Atual",
    "- Funcionalidade ou refatoração sendo desenvolvida no momento.",
    "",
    "## 2. Tarefas e Próximos Passos",
    "- [ ] Próxima tarefa imediata.",
    "",
    "## 3. Descobertas e Decisões Recentes",
    "- Notas para os próximos subagentes e sessões futuras.",
  ].join("\n"),
}

export const Plugin = {
  id: "opencode.tool.omni_memory",
  effect: Effect.fn("OmniMemoryTool.Plugin")(function* (ctx: Context) {
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
              const memoryDir = path.join(rootDir, ".omnicode", "memory-bank")

              const ensureDir = () => {
                if (!fs.existsSync(memoryDir)) {
                  fs.mkdirSync(memoryDir, { recursive: true })
                }
              }

              if (params.action === "init") {
                ensureDir()
                const created: string[] = []
                for (const [filename, template] of Object.entries(TEMPLATES)) {
                  const target = path.join(memoryDir, filename)
                  if (!fs.existsSync(target)) {
                    fs.writeFileSync(target, template, "utf-8")
                    created.push(filename)
                  }
                }
                const summary =
                  created.length > 0
                    ? `Memory Bank inicializado com sucesso em .omnicode/memory-bank/ (${created.join(", ")}).`
                    : "Memory Bank já estava inicializado em .omnicode/memory-bank/."
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
                const files = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md"))
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
                  ensureDir()
                  for (const [filename, template] of Object.entries(TEMPLATES)) {
                    const target = path.join(memoryDir, filename)
                    if (!fs.existsSync(target)) fs.writeFileSync(target, template, "utf-8")
                  }
                }

                const targetFiles =
                  !params.file || params.file === "all"
                    ? ["project-brief.md", "system-patterns.md", "tech-context.md", "active-context.md"]
                    : [`${params.file}.md`]

                const contents: Record<string, string> = {}
                const blocks: string[] = []

                for (const f of targetFiles) {
                  const filePath = path.join(memoryDir, f)
                  if (fs.existsSync(filePath)) {
                    const data = fs.readFileSync(filePath, "utf-8")
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
                ensureDir()
                const fileName = params.file
                  ? params.file.endsWith(".md")
                    ? params.file
                    : `${params.file}.md`
                  : "active-context.md"
                const filePath = path.join(memoryDir, fileName)
                const contentToWrite = params.content ?? ""

                if (params.append && fs.existsSync(filePath)) {
                  fs.appendFileSync(filePath, `\n\n${contentToWrite}`, "utf-8")
                } else {
                  fs.writeFileSync(filePath, contentToWrite, "utf-8")
                }

                const summary = `Arquivo '${fileName}' atualizado no Memory Bank (${path.relative(rootDir, filePath)}).`
                return {
                  output: { action: "update", summary },
                  content: summary,
                  metadata: { action: "update", file: fileName },
                }
              }

              return yield* new ToolFailure({ message: `Ação '${params.action}' não reconhecida.` })
            }),
        })
      })
      .pipe(Effect.asVoid)
  }),
}
