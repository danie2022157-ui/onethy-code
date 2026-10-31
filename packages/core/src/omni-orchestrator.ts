export * as OmniOrchestrator from "./omni-orchestrator.js"

import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Location } from "./location.js"
import { OmniBus } from "./omni-bus.js"
import { OmniConfig } from "./omni-config.js"

const memoryCooldowns = new Map<string, number>()
let diskCooldownCache: { data: Record<string, number>; ts: number } | undefined

function getAutoModelFilePath(): string {
  const stateDir =
    process.env.OMNICODE_STATE_DIR ||
    (process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "omnicode", "state")
      : path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "omnicode"))
  return path.join(stateDir, "auto-model.json")
}

export function markModelCooldown(providerID: string, modelID: string, durationMs = 5 * 60_000): void {
  const key = `${providerID}/${modelID}`
  const until = Date.now() + durationMs
  memoryCooldowns.set(key, until)
  try {
    const file = getAutoModelFilePath()
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
    const cooldowns: Record<string, number> =
      existing && typeof existing.cooldowns === "object" && existing.cooldowns ? { ...existing.cooldowns } : {}
    cooldowns[key] = until
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ ...existing, cooldowns }, null, 2), "utf8")
    diskCooldownCache = { data: cooldowns, ts: Date.now() }
  } catch {
    // ignore disk errors
  }
}

export function isModelInCooldown(providerID: string, modelID: string): boolean {
  const key = `${providerID}/${modelID}`
  const now = Date.now()
  const memUntil = memoryCooldowns.get(key)
  if (memUntil !== undefined) {
    if (memUntil > now) return true
    memoryCooldowns.delete(key)
  }
  try {
    if (!diskCooldownCache || now - diskCooldownCache.ts > 3000) {
      const file = getAutoModelFilePath()
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
        diskCooldownCache = {
          data: parsed && typeof parsed.cooldowns === "object" && parsed.cooldowns ? parsed.cooldowns : {},
          ts: now,
        }
      } else {
        diskCooldownCache = { data: {}, ts: now }
      }
    }
    const diskUntil = diskCooldownCache.data[key]
    if (typeof diskUntil === "number" && diskUntil > now) {
      return true
    }
  } catch {
    // ignore
  }
  return false
}

export interface AutoCustomizationsConfig {
  enabled: boolean
  useSkills: boolean
  useAgents: boolean
  useMcps: boolean
  useHooks: boolean
  useMods: boolean
  useCommands: boolean
  useSettings: boolean
}

export const DEFAULT_AUTO_CUSTOMIZATIONS: AutoCustomizationsConfig = {
  enabled: true,
  useSkills: true,
  useAgents: true,
  useMcps: true,
  useHooks: true,
  useMods: true,
  useCommands: true,
  useSettings: true,
}

export function getAutoCustomizationsConfig(): AutoCustomizationsConfig {
  if (process.env.OMNICODE_AUTO_CUSTOMIZATIONS) {
    try {
      const parsed = JSON.parse(process.env.OMNICODE_AUTO_CUSTOMIZATIONS)
      if (parsed && typeof parsed === "object") {
        return {
          enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
          useSkills: typeof parsed.useSkills === "boolean" ? parsed.useSkills : true,
          useAgents: typeof parsed.useAgents === "boolean" ? parsed.useAgents : true,
          useMcps: typeof parsed.useMcps === "boolean" ? parsed.useMcps : true,
          useHooks: typeof parsed.useHooks === "boolean" ? parsed.useHooks : true,
          useMods: typeof parsed.useMods === "boolean" ? parsed.useMods : true,
          useCommands: typeof parsed.useCommands === "boolean" ? parsed.useCommands : true,
          useSettings: typeof parsed.useSettings === "boolean" ? parsed.useSettings : true,
        }
      }
    } catch {}
  }
  try {
    const file = getAutoModelFilePath()
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
      if (parsed && typeof parsed.autoCustomizations === "object" && parsed.autoCustomizations) {
        const c = parsed.autoCustomizations
        return {
          enabled: typeof c.enabled === "boolean" ? c.enabled : true,
          useSkills: typeof c.useSkills === "boolean" ? c.useSkills : true,
          useAgents: typeof c.useAgents === "boolean" ? c.useAgents : true,
          useMcps: typeof c.useMcps === "boolean" ? c.useMcps : true,
          useHooks: typeof c.useHooks === "boolean" ? c.useHooks : true,
          useMods: typeof c.useMods === "boolean" ? c.useMods : true,
          useCommands: typeof c.useCommands === "boolean" ? c.useCommands : true,
          useSettings: typeof c.useSettings === "boolean" ? c.useSettings : true,
        }
      }
    }
  } catch {}
  return DEFAULT_AUTO_CUSTOMIZATIONS
}

export function setAutoCustomizationsConfig(config: Partial<AutoCustomizationsConfig>): AutoCustomizationsConfig {
  const current = getAutoCustomizationsConfig()
  const updated: AutoCustomizationsConfig = { ...current, ...config }
  try {
    const file = getAutoModelFilePath()
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ ...existing, autoCustomizations: updated }, null, 2), "utf8")
    process.env.OMNICODE_AUTO_CUSTOMIZATIONS = JSON.stringify(updated)
  } catch {}
  return updated
}

export type TaskCategory =
  | "fast_explore"
  | "external_research"
  | "deep_architecture"
  | "code_implementation"
  | "security_review"
  | "orchestration"

export interface AgentDefinition {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly description: string
  readonly model: string
  readonly capabilities: ReadonlyArray<string>
}

export interface TaskItem {
  readonly id: string
  readonly title: string
  readonly assignedAgent: string
  readonly category?: TaskCategory
  readonly parallel?: boolean
  readonly preferredModel?: string
  status: "pending" | "running" | "completed" | "failed"
  result?: string
}

export interface MissionResult {
  readonly missionId: string
  readonly goal: string
  readonly tasks: ReadonlyArray<TaskItem>
  readonly summary: string
}

export interface ModelRef {
  readonly providerID: string
  readonly id: string
}

export interface RoutedModelSelection {
  readonly category: TaskCategory
  readonly primary?: ModelRef
  readonly fallback?: ModelRef
  readonly thinkingLevel?: "off" | "low" | "medium" | "high" | "max"
}

export interface Interface {
  readonly getAgents: () => Effect.Effect<ReadonlyArray<AgentDefinition>, never>
  readonly planMission: (goal: string) => Effect.Effect<ReadonlyArray<TaskItem>, never>
  readonly planUltrawork: (goal: string) => Effect.Effect<ReadonlyArray<TaskItem>, never>
  readonly planArena: (problem: string, models: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<TaskItem>, never>
  readonly planTeamPipeline: (goal: string) => Effect.Effect<ReadonlyArray<TaskItem>, never>
  readonly classifyCategory: (taskDescription: string, agentId: string) => TaskCategory
  readonly selectModelForAgent: (
    agentId: string,
    taskDescription: string,
    availableModels: ReadonlyArray<ModelRef>,
  ) => Effect.Effect<RoutedModelSelection, never>
  readonly formatBoomerangContract: (agentId: string) => string
  readonly summarizeBoomerang: (rawOutput: string) => string
  readonly verifyCompletion: (input: {
    todosPending: number
    hasUnverifiedEdits: boolean
  }) => Effect.Effect<{ passed: boolean; reminder?: string }, never>
  readonly executeTask: (taskId: string, resultSummary: string) => Effect.Effect<TaskItem, never>
  readonly getActiveTasks: () => Effect.Effect<ReadonlyArray<TaskItem>, never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OmniOrchestrator") {}

const DEFAULT_AGENTS: AgentDefinition[] = [
  {
    id: "supervisor",
    name: "Supervisor Maestro",
    role: "Coordenador e Planejador",
    description: "Analisa a meta, quebra em subtarefas com dependências e consolida o resultado final.",
    model: "auto",
    capabilities: ["planning", "coordination", "synthesis"],
  },
  {
    id: "researcher",
    name: "Explorador Técnico",
    role: "Investigador e Leitor",
    description: "Inspeciona arquivos, busca padrões e reúne contexto sem realizar mutações.",
    model: "auto",
    capabilities: ["code-search", "reading", "architecture-mapping"],
  },
  {
    id: "librarian",
    name: "Bibliotecário Técnico",
    role: "Pesquisador de Documentação e Web",
    description: "Pesquisa documentações oficiais, changelogs, APIs externas e referências técnicas atualizadas.",
    model: "auto",
    capabilities: ["web-search", "docs-lookup", "api-reference"],
  },
  {
    id: "architect",
    name: "Arquiteto de Sistemas",
    role: "Desenho de Contratos e Limites",
    description: "Define interfaces, invariantes de segurança, dependências entre pacotes e arquitetura.",
    model: "auto",
    capabilities: ["architecture", "contracts", "security-boundaries"],
  },
  {
    id: "coder",
    name: "Desenvolvedor Core",
    role: "Implementador de Código",
    description: "Cria, edita e refatora código seguindo rigorosamente os padrões do projeto.",
    model: "auto",
    capabilities: ["editing", "file-write", "refactoring"],
  },
  {
    id: "reviewer",
    name: "Auditor de Qualidade",
    role: "Revisor e Segurança",
    description: "Verifica diffs, executa linters/testes e detecta vulnerabilidades antes da aprovação.",
    model: "auto",
    capabilities: ["code-review", "security-audit", "test-verification"],
  },
]

const CATEGORY_MODEL_PREFERENCES: Record<TaskCategory, ReadonlyArray<string>> = {
  fast_explore: [
    "google/antigravity-gemini-3.8-flash",
    "google/gemini-3.8-flash",
    "openai/gpt-6.1-terra-fast",
    "opencode/nemotron-3.5-super-vl-free",
    "opencode/nemotron-3.5-lightning-free",
    "opencode/glm-5.3-flash-free",
    "opencode/deepseek-v4.1-flash-free",
    "google/gemini-2.5-flash",
  ],
  external_research: [
    "google/antigravity-gemini-3.8-flash",
    "google/gemini-3.8-flash",
    "openai/gpt-5.6-sol",
    "opencode/nemotron-3.5-super-vl-free",
    "opencode/deepseek-v4.1-flash-free",
    "google/gemini-2.5-flash",
  ],
  deep_architecture: [
    "google/gemini-4-argon",
    "openai/gpt-6-luna",
    "openai/gpt-5.6-luna",
    "google/antigravity-claude-opus-4-6-thinking",
    "google/antigravity-claude-sonnet-4-6",
    "openai/gpt-6-astra",
    "anthropic/claude-3-7-sonnet",
    "google/gemini-2.5-pro",
  ],
  code_implementation: [
    "openai/gpt-5.6-luna",
    "openai/gpt-6-luna",
    "google/gemini-4-argon",
    "google/antigravity-gemini-3.8-flash",
    "google/gemini-3.8-flash",
    "openai/gpt-6.1-terra",
    "openai/gpt-5.6-sol",
    "google/antigravity-claude-sonnet-4-6",
    "anthropic/claude-3-7-sonnet",
  ],
  security_review: [
    "google/gemini-4-argon",
    "openai/gpt-6-luna",
    "openai/gpt-5.6-luna",
    "google/antigravity-claude-opus-4-6-thinking",
    "google/antigravity-claude-sonnet-4-6",
    "openai/gpt-6-astra",
    "deepseek/deepseek-reasoner",
  ],
  orchestration: [
    "google/gemini-4-argon",
    "openai/gpt-6-luna",
    "google/antigravity-gemini-3.8-flash",
    "google/gemini-3.8-flash",
    "openai/gpt-5.6-luna",
    "openai/gpt-6-astra",
    "google/antigravity-claude-opus-4-6-thinking",
    "anthropic/claude-3-7-sonnet",
  ],
}

export function classifyTaskCategory(taskDescription: string, agentId: string): TaskCategory {
  const lowerAgent = agentId.toLowerCase()
  const lowerDesc = taskDescription.toLowerCase()
  if (lowerAgent === "explore" || lowerAgent === "researcher") return "fast_explore"
  if (lowerAgent === "librarian") return "external_research"
  if (lowerAgent === "architect") return "deep_architecture"
  if (lowerAgent === "reviewer") return "security_review"
  if (lowerAgent === "coder") return "code_implementation"
  if (/(doc|api|web|referência|changelog|pesquis)/i.test(lowerDesc)) return "external_research"
  if (/(arquitet|schema|contrato|camada|design|segurança)/i.test(lowerDesc)) return "deep_architecture"
  if (/(revis|audit|test|typecheck|regress)/i.test(lowerDesc)) return "security_review"
  if (/(busca|explor|encontr|grep|mapear)/i.test(lowerDesc)) return "fast_explore"
  return "code_implementation"
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* OmniBus.Service
    const tasks: TaskItem[] = []

    const getAgents = Effect.fn("OmniOrchestrator.getAgents")(function* () {
      return [...DEFAULT_AGENTS]
    })

    const planMission = Effect.fn("OmniOrchestrator.planMission")(function* (goal: string) {
      tasks.length = 0

      // Supervisor gera as subtarefas especializadas para a missão
      const subtasks: TaskItem[] = [
        {
          id: `task-${crypto.randomBytes(3).toString("hex")}`,
          title: `Explorar e mapear contexto para: ${goal}`,
          assignedAgent: "researcher",
          status: "pending",
        },
        {
          id: `task-${crypto.randomBytes(3).toString("hex")}`,
          title: `Implementar alterações solicitadas`,
          assignedAgent: "coder",
          status: "pending",
        },
        {
          id: `task-${crypto.randomBytes(3).toString("hex")}`,
          title: `Revisar diff e verificar segurança/testes`,
          assignedAgent: "reviewer",
          status: "pending",
        },
      ]

      tasks.push(...subtasks)

      yield* bus.publish({
        sender: "supervisor",
        type: "plan",
        payload: { goal, subtasks: subtasks.map((t) => ({ id: t.id, title: t.title, agent: t.assignedAgent })) },
      })

      return [...tasks]
    })

    const planUltrawork = Effect.fn("OmniOrchestrator.planUltrawork")(function* (goal: string) {
      tasks.length = 0

      const subtasks: TaskItem[] = [
        {
          id: `ulw-${crypto.randomBytes(3).toString("hex")}`,
          title: `[Paralelo 1] Varredura rápida de arquivos e símbolos para: ${goal}`,
          assignedAgent: "explore",
          category: "fast_explore",
          parallel: true,
          status: "pending",
        },
        {
          id: `ulw-${crypto.randomBytes(3).toString("hex")}`,
          title: `[Paralelo 2] Pesquisa de documentação e contratos de API para: ${goal}`,
          assignedAgent: "librarian",
          category: "external_research",
          parallel: true,
          status: "pending",
        },
        {
          id: `ulw-${crypto.randomBytes(3).toString("hex")}`,
          title: `Validar arquitetura, invariantes de segurança e impacto entre pacotes`,
          assignedAgent: "architect",
          category: "deep_architecture",
          parallel: false,
          status: "pending",
        },
        {
          id: `ulw-${crypto.randomBytes(3).toString("hex")}`,
          title: `Implementar código de produção e testes unitários completos`,
          assignedAgent: "coder",
          category: "code_implementation",
          parallel: false,
          status: "pending",
        },
        {
          id: `ulw-${crypto.randomBytes(3).toString("hex")}`,
          title: `Gate final (Ralph Loop): executar typecheck, testes e auditoria de diff`,
          assignedAgent: "reviewer",
          category: "security_review",
          parallel: false,
          status: "pending",
        },
      ]

      tasks.push(...subtasks)

      yield* bus.publish({
        sender: "supervisor",
        type: "plan",
        payload: {
          mode: "ultrawork",
          goal,
          subtasks: subtasks.map((t) => ({
            id: t.id,
            title: t.title,
            agent: t.assignedAgent,
            category: t.category,
            parallel: t.parallel,
          })),
        },
      })

      return [...tasks]
    })

    const planArena = Effect.fn("OmniOrchestrator.planArena")(function* (
      problem: string,
      models: ReadonlyArray<string>,
    ) {
      tasks.length = 0
      const candidateAgents = ["architect", "reviewer", "coder"]
      const subtasks: TaskItem[] = models.slice(0, 3).map((modelRef, idx) => ({
        id: `arena-${crypto.randomBytes(3).toString("hex")}`,
        title: `[Arena Competidor #${idx + 1} · ${modelRef}] Diagnosticar e propor solução para: ${problem}`,
        assignedAgent: candidateAgents[idx % candidateAgents.length] ?? "architect",
        category: "deep_architecture",
        parallel: true,
        preferredModel: modelRef,
        status: "pending",
      }))

      tasks.push(...subtasks)

      yield* bus.publish({
        sender: "supervisor",
        type: "plan",
        payload: {
          mode: "arena",
          goal: problem,
          models,
          subtasks: subtasks.map((t) => ({
            id: t.id,
            title: t.title,
            agent: t.assignedAgent,
            preferredModel: t.preferredModel,
          })),
        },
      })

      return [...tasks]
    })

    const planTeamPipeline = Effect.fn("OmniOrchestrator.planTeamPipeline")(function* (goal: string) {
      tasks.length = 0

      const subtasks: TaskItem[] = [
        {
          id: `team-spec-${crypto.randomBytes(3).toString("hex")}`,
          title: `[Fase 1 · Especificação] Decompor requisitos, critérios de aceite e escopo: ${goal}`,
          assignedAgent: "planner",
          category: "orchestration",
          parallel: false,
          status: "pending",
        },
        {
          id: `team-arch-${crypto.randomBytes(3).toString("hex")}`,
          title: `[Fase 2 · Arquitetura] Desenhar interfaces, contratos de tipos e limites modulares`,
          assignedAgent: "architect",
          category: "deep_architecture",
          parallel: false,
          status: "pending",
        },
        {
          id: `team-code-${crypto.randomBytes(3).toString("hex")}`,
          title: `[Fase 3 · Implementação] Desenvolver código em conformidade e criar testes`,
          assignedAgent: "coder",
          category: "code_implementation",
          parallel: false,
          status: "pending",
        },
        {
          id: `team-review-${crypto.randomBytes(3).toString("hex")}`,
          title: `[Fase 4 · Auditoria & Gate] Executar testes/typecheck e auditar qualidade/segurança`,
          assignedAgent: "reviewer",
          category: "security_review",
          parallel: false,
          status: "pending",
        },
      ]

      tasks.push(...subtasks)

      yield* bus.publish({
        sender: "supervisor",
        type: "plan",
        payload: {
          mode: "team_pipeline",
          goal,
          subtasks: subtasks.map((t) => ({
            id: t.id,
            title: t.title,
            agent: t.assignedAgent,
            category: t.category,
          })),
        },
      })

      return [...tasks]
    })

    function classifyAvailableModelBucket(model: ModelRef): "efficiency" | "balanced" | "intelligence" {
      const text = `${model.providerID}/${model.id}`.toLowerCase()
      if (/(flash|mini|haiku|nano|lite|small|instant|fast|8b)/.test(text)) return "efficiency"
      if (/(opus|o3|o1|astra|pro|max|reasoner|reasoning|thinking|deep|claude-4-opus|gpt-6)/.test(text)) {
        return "intelligence"
      }
      return "balanced"
    }

    const selectModelForAgent = Effect.fn("OmniOrchestrator.selectModelForAgent")(function* (
      agentId: string,
      taskDescription: string,
      availableModels: ReadonlyArray<ModelRef>,
    ) {
      const category = classifyTaskCategory(taskDescription, agentId)
      const candidates = CATEGORY_MODEL_PREFERENCES[category]
      const matched: ModelRef[] = []

      for (const candidate of candidates) {
        const parts = candidate.split("/")
        const pId = parts[0] ?? ""
        const mId = parts[1] ?? ""
        const found = availableModels.find((m) => m.providerID === pId && m.id === mId)
        if (found) matched.push(found)
      }

      const optimizeTier = process.env.OMNICODE_OPTIMIZE_TIER as
        | "efficiency"
        | "balanced"
        | "intelligence"
        | undefined

      const targetBucket: "efficiency" | "balanced" | "intelligence" =
        optimizeTier === "efficiency"
          ? "efficiency"
          : optimizeTier === "intelligence"
            ? "intelligence"
            : category === "fast_explore" || category === "external_research"
              ? "efficiency"
              : category === "deep_architecture" || category === "security_review" || category === "orchestration"
                ? "intelligence"
                : "balanced"

      const healthyPool = availableModels.filter((m) => !isModelInCooldown(m.providerID, m.id))
      const pool = healthyPool.length > 0 ? healthyPool : availableModels
      const healthyMatched = matched.filter((m) => !isModelInCooldown(m.providerID, m.id))
      const effectiveMatched = healthyMatched.length > 0 ? healthyMatched : matched

      const bucketOrder: ("efficiency" | "balanced" | "intelligence")[] =
        targetBucket === "efficiency"
          ? ["efficiency", "balanced", "intelligence"]
          : targetBucket === "intelligence"
            ? ["intelligence", "balanced", "efficiency"]
            : ["balanced", "intelligence", "efficiency"]

      for (const bucket of bucketOrder) {
        for (const m of pool) {
          if (
            classifyAvailableModelBucket(m) === bucket &&
            !effectiveMatched.some((x) => x.providerID === m.providerID && x.id === m.id)
          ) {
            effectiveMatched.push(m)
          }
        }
      }

      const primary = effectiveMatched[0] ?? pool[0] ?? availableModels[0]
      const fallback =
        effectiveMatched.find((m) => m.providerID !== primary?.providerID || m.id !== primary?.id) ??
        pool.find((m) => m !== primary) ??
        availableModels.find((m) => m !== primary)

      const thinkingLevel: "off" | "low" | "medium" | "high" | "max" =
        category === "fast_explore" || category === "external_research" || agentId === "explore" || agentId === "librarian"
          ? "low"
          : category === "deep_architecture" || category === "security_review" || agentId === "architect" || agentId === "reviewer"
            ? "max"
            : "medium"

      return { category, primary, fallback, thinkingLevel }
    })

    const formatBoomerangContract = (agentId: string) =>
      [
        `[PROTOCOLO BOOMERANG — @${agentId}]`,
        "Ao concluir sua subtarefa, retorne um relatório enxuto e estruturado para economizar tokens da sessão principal:",
        "1. STATUS: concluído | bloqueado",
        "2. ARQUIVOS: caminhos inspecionados ou modificados",
        "3. RESUMO EXECUTIVO: no máximo 8 linhas com as descobertas ou mudanças exatas",
        "4. VERIFICAÇÃO / RISCOS: testes rodados ou pontos de atenção para o próximo agente",
      ].join("\n")

    const summarizeBoomerang = (rawOutput: string) => {
      const trimmed = rawOutput.trim()
      if (trimmed.length <= 2400) return trimmed
      return `${trimmed.slice(0, 2200)}\n\n[... Resumo Boomerang truncado para preservar janela de contexto principal ...]`
    }

    const verifyCompletion = Effect.fn("OmniOrchestrator.verifyCompletion")(function* (input: {
      todosPending: number
      hasUnverifiedEdits: boolean
    }) {
      if (input.todosPending > 0) {
        return {
          passed: false,
          reminder: `[RALPH LOOP ENFORCER] Ainda existem ${input.todosPending} item(ns) pendente(s) na lista Todo. Continue executando até zerar as pendências.`,
        }
      }
      if (input.hasUnverifiedEdits) {
        return {
          passed: false,
          reminder: `[RALPH LOOP ENFORCER] Alterações de código detectadas sem verificação final. Acione @reviewer ou execute typecheck/testes antes de encerrar.`,
        }
      }
      return { passed: true }
    })

    const executeTask = Effect.fn("OmniOrchestrator.executeTask")(function* (taskId: string, resultSummary: string) {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) {
        throw new Error(`Tarefa '${taskId}' não encontrada.`)
      }

      task.status = "completed"
      task.result = resultSummary

      yield* bus.publish({
        sender: task.assignedAgent,
        taskId: task.id,
        type: "status",
        payload: { status: "completed", result: resultSummary },
      })

      return task
    })

    const getActiveTasks = Effect.fn("OmniOrchestrator.getActiveTasks")(function* () {
      return [...tasks]
    })

    return Service.of({
      getAgents,
      planMission,
      planUltrawork,
      planArena,
      planTeamPipeline,
      classifyCategory: classifyTaskCategory,
      selectModelForAgent,
      formatBoomerangContract,
      summarizeBoomerang,
      verifyCompletion,
      executeTask,
      getActiveTasks,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, OmniBus.node, OmniConfig.node],
})

