export type MemoryScope = "project" | "global"

export interface MemoryFileInfo {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly relativePath: string
  readonly description: string
  readonly defaultContent: string
}

export const PROJECT_MEMORY_TEMPLATES: Record<string, { label: string; description: string; defaultContent: string }> = {
  "project-brief.md": {
    label: "Project Brief",
    description: "Core vision, high-level scope, key requirements and target users.",
    defaultContent: `# Project Brief

## 1. Visão Geral e Objetivos
- Propósito central do projeto.
- Problemas que resolve e valor para os usuários.

## 2. Requisitos e Escopo
- Funcionalidades essenciais.
- O que está explicitamente FORA de escopo.

## 3. Critérios de Sucesso
- Estabilidade, cobertura de testes e aderência aos requisitos.
`,
  },
  "system-patterns.md": {
    label: "System Patterns",
    description: "Architectural patterns, key conventions, data flow, and code structure.",
    defaultContent: `# System Patterns & Arquitetura

## 1. Arquitetura Geral
- Camadas do sistema e separação de responsabilidades.
- Direção de dependências e regras de importação.

## 2. Padrões de Código e Convenções
- Nomenclatura, tratamento de erros e convenções de estilo.
- Regras de schema e tipagem.

## 3. Decisões Arquiteturais Chave (ADRs)
- Decisões importantes e suas justificativas técnicas.
`,
  },
  "tech-context.md": {
    label: "Tech Context",
    description: "Technology stack, dependencies, runtime environments, and development commands.",
    defaultContent: `# Tech Context

## 1. Stack Tecnológica
- Runtime / Linguagens principais.
- Frameworks, bibliotecas e bancos de dados.

## 2. Comandos e Scripts de Desenvolvimento
- Testes: comando para rodar testes.
- Build / Lint / Typecheck: scripts de validação.

## 3. Restrições do Ambiente
- Compatibilidade de SO, variáveis de ambiente e requisitos de segurança.
`,
  },
  "active-context.md": {
    label: "Active Context",
    description: "Current sprint, immediate goals, active decisions and next steps.",
    defaultContent: `# Active Context

## 1. Foco Atual
- Funcionalidade ou refatoração sendo desenvolvida no momento.

## 2. Tarefas e Próximos Passos
- [ ] Próxima tarefa imediata.

## 3. Descobertas e Decisões Recentes
- Notas para os próximos subagentes e sessões futuras.
`,
  },
}

export const GLOBAL_MEMORY_TEMPLATES: Record<string, { label: string; description: string; defaultContent: string }> = {
  "preferences.md": {
    label: "User Preferences",
    description: "Coding style preferences, favorite tools, and global conventions.",
    defaultContent: `# Preferências globais de desenvolvimento

Preferências que devem valer em todos os projetos Onethy Code.
Não armazenar chaves de API, tokens, senhas nem dados privados de clientes.
`,
  },
  "rules.md": {
    label: "Global Rules",
    description: "User-wide safety and behavioral rules applied to all projects.",
    defaultContent: `# Regras globais

Convenções gerais e limites para os agentes em todos os projetos.
As regras deste arquivo não substituem permissões nem as instruções do sistema.
`,
  },
  "knowledge.md": {
    label: "Global Knowledge",
    description: "Cross-project knowledge base, tips, and reusable patterns.",
    defaultContent: `# Conhecimento reutilizável

Descobertas técnicas reutilizáveis entre projetos, sem dados confidenciais.
`,
  },
}

export function getMemoryFilePath(scope: MemoryScope, filename: string): string {
  // The app's file API is Location-scoped; never pretend this relative path is the global config bank.
  if (scope === "global") throw new Error("Global memory is only available through the Core memory service.")
  return `.omnicode/memory-bank/${filename}`
}

export function getMemoryFiles(scope: MemoryScope): MemoryFileInfo[] {
  const templates = scope === "global" ? GLOBAL_MEMORY_TEMPLATES : PROJECT_MEMORY_TEMPLATES
  if (scope === "global") return []
  return Object.entries(templates).map(([name, meta]) => ({
    id: name,
    name,
    label: meta.label,
    relativePath: getMemoryFilePath(scope, name),
    description: meta.description,
    defaultContent: meta.defaultContent,
  }))
}
