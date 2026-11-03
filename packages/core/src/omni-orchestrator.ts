export * as OmniOrchestrator from "./omni-orchestrator.js"

import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Clock, Context, Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Model } from "./model.js"
import { ModelSelectionPolicy } from "./model-selection-policy.js"
import { Location } from "./location.js"
import { OmniBus } from "./omni-bus.js"
import { OmniConfig } from "./omni-config.js"

function getAutoModelFilePath(): string {
  const stateDir =
    process.env.OMNICODE_STATE_DIR ||
    (process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "omnicode", "state")
      : path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "omnicode"))
  return path.join(stateDir, "auto-model.json")
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
  readonly missionID: string
  readonly title: string
  readonly assignedAgent: string
  dependsOn: ReadonlyArray<string>
  readonly acceptanceCriteria: ReadonlyArray<string>
  readonly category?: TaskCategory
  readonly parallel?: boolean
  readonly preferredModel?: string
  status: "pending" | "running" | "completed" | "failed"
  result?: string
  childSessionID?: string
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
  readonly markModelCooldown: (providerID: string, modelID: string, durationMs?: number) => Effect.Effect<void>
  readonly clearModelCooldown: (providerID?: string, modelID?: string) => Effect.Effect<void>
  readonly isModelInCooldown: (providerID: string, modelID: string) => Effect.Effect<boolean>
  readonly getAgents: () => Effect.Effect<ReadonlyArray<AgentDefinition>, never>
  readonly planMission: (goal: string, missionID?: string) => Effect.Effect<ReadonlyArray<TaskItem>, never>
  readonly planUltrawork: (goal: string, missionID?: string) => Effect.Effect<ReadonlyArray<TaskItem>, never>
  readonly planArena: (problem: string, models: ReadonlyArray<string>, missionID?: string) => Effect.Effect<ReadonlyArray<TaskItem>, never>
  readonly planTeamPipeline: (goal: string, missionID?: string) => Effect.Effect<ReadonlyArray<TaskItem>, never>
  readonly classifyCategory: (taskDescription: string, agentId: string) => TaskCategory
  readonly selectModelForAgent: (
    agentId: string,
    taskDescription: string,
    availableModels: ReadonlyArray<Model.Info>,
  ) => Effect.Effect<RoutedModelSelection, never>
  readonly formatBoomerangContract: (agentId: string) => string
  readonly summarizeBoomerang: (rawOutput: string) => string
  readonly verifyCompletion: (input: {
    todosPending: number
    hasUnverifiedEdits: boolean
  }) => Effect.Effect<{ passed: boolean; reminder?: string }, never>
  readonly executeTask: (missionID: string, taskId: string, resultSummary: string) => Effect.Effect<TaskItem, never>
  readonly startTask: (missionID: string, taskId: string, childSessionID?: string) => Effect.Effect<TaskItem, never>
  readonly failTask: (missionID: string, taskId: string, reason: string) => Effect.Effect<TaskItem, never>
  readonly getActiveTasks: (missionID?: string) => Effect.Effect<ReadonlyArray<TaskItem>, never>
  readonly getReadyTasks: (missionID: string) => Effect.Effect<ReadonlyArray<TaskItem>, never>
  readonly getMissionGoal: (missionID: string) => Effect.Effect<string | undefined>
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
    id: "explore",
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

export function classifyTaskCategory(taskDescription: string, agentId: string): TaskCategory {
  const lowerAgent = agentId.toLowerCase()
  if (lowerAgent === "explore" || lowerAgent === "researcher") return "fast_explore"
  if (lowerAgent === "librarian") return "external_research"
  if (lowerAgent === "architect") return "deep_architecture"
  if (lowerAgent === "reviewer") return "security_review"
  if (lowerAgent === "coder") return "code_implementation"
  void taskDescription
  return "code_implementation"
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* OmniBus.Service
    const cooldowns = new Map<string, number>()
    const markModelCooldown = Effect.fn("OmniOrchestrator.markModelCooldown")(function* (
      providerID: string,
      modelID: string,
      durationMs = 5 * 60_000,
    ) {
      cooldowns.set(`${providerID}/${modelID}`, (yield* Clock.currentTimeMillis) + Math.max(0, Math.min(durationMs, 5 * 60_000)))
    })
    const clearModelCooldown = Effect.fn("OmniOrchestrator.clearModelCooldown")(function* (
      providerID?: string,
      modelID?: string,
    ) {
      if (providerID && modelID) cooldowns.delete(`${providerID}/${modelID}`)
      else cooldowns.clear()
    })
    const isModelInCooldown = Effect.fn("OmniOrchestrator.isModelInCooldown")(function* (providerID: string, modelID: string) {
      const key = `${providerID}/${modelID}`
      const until = cooldowns.get(key)
      if (until === undefined) return false
      if (until > (yield* Clock.currentTimeMillis)) return true
      cooldowns.delete(key)
      return false
    })
    const missions = new Map<string, TaskItem[]>()
    const missionGoals = new Map<string, string>()

    const getAgents = Effect.fn("OmniOrchestrator.getAgents")(function* () {
      return [...DEFAULT_AGENTS]
    })

    const planMission = Effect.fn("OmniOrchestrator.planMission")(function* (goal: string, missionID = `mission-${crypto.randomUUID()}`) {

      // Supervisor gera as subtarefas especializadas para a missão
      const subtasks: TaskItem[] = [
        {
          id: `task-${crypto.randomUUID()}`,
          missionID,
          title: `Explorar e mapear contexto para: ${goal}`,
          assignedAgent: "explore",
          dependsOn: [],
          acceptanceCriteria: ["Relevant files and constraints are identified."],
          status: "pending",
        },
        {
          id: `task-${crypto.randomUUID()}`,
          missionID,
          title: `Implementar alterações solicitadas`,
          assignedAgent: "coder",
          dependsOn: [],
          acceptanceCriteria: ["Requested changes are implemented and covered by tests."],
          status: "pending",
        },
        {
          id: `task-${crypto.randomUUID()}`,
          missionID,
          title: `Revisar diff e verificar segurança/testes`,
          assignedAgent: "reviewer",
          dependsOn: [],
          acceptanceCriteria: ["Diff is reviewed and relevant tests pass."],
          status: "pending",
        },
      ]
      subtasks[1].dependsOn = [subtasks[0].id]
      subtasks[2].dependsOn = [subtasks[1].id]

      missions.set(missionID, subtasks)
      missionGoals.set(missionID, goal)

      yield* bus.publish({
        sender: "supervisor",
        type: "plan",
        payload: { missionID, goal, subtasks: subtasks.map((t) => ({ id: t.id, title: t.title, agent: t.assignedAgent, dependsOn: t.dependsOn, acceptanceCriteria: t.acceptanceCriteria })) },
      })

      return subtasks.map((task) => ({ ...task }))
    })

    const planUltrawork = Effect.fn("OmniOrchestrator.planUltrawork")(function* (goal: string, missionID = `mission-${crypto.randomUUID()}`) {

      const subtasks: TaskItem[] = [
        {
          id: `ulw-${crypto.randomUUID()}`,
          missionID,
          title: `[Paralelo 1] Varredura rápida de arquivos e símbolos para: ${goal}`,
          assignedAgent: "explore",
          dependsOn: [],
          acceptanceCriteria: ["Relevant files and symbols are mapped."],
          category: "fast_explore",
          parallel: true,
          status: "pending",
        },
        {
          id: `ulw-${crypto.randomUUID()}`,
          missionID,
          title: `[Paralelo 2] Pesquisa de documentação e contratos de API para: ${goal}`,
          assignedAgent: "librarian",
          dependsOn: [],
          acceptanceCriteria: ["Applicable documentation and API constraints are summarized."],
          category: "external_research",
          parallel: true,
          status: "pending",
        },
        {
          id: `ulw-${crypto.randomUUID()}`,
          missionID,
          title: `Validar arquitetura, invariantes de segurança e impacto entre pacotes`,
          assignedAgent: "architect",
          dependsOn: [],
          acceptanceCriteria: ["Architecture and security impact are documented."],
          category: "deep_architecture",
          parallel: false,
          status: "pending",
        },
        {
          id: `ulw-${crypto.randomUUID()}`,
          missionID,
          title: `Implementar código de produção e testes unitários completos`,
          assignedAgent: "coder",
          dependsOn: [],
          acceptanceCriteria: ["Implementation and unit tests are complete."],
          category: "code_implementation",
          parallel: false,
          status: "pending",
        },
        {
          id: `ulw-${crypto.randomUUID()}`,
          missionID,
          title: `Gate final (Ralph Loop): executar typecheck, testes e auditoria de diff`,
          assignedAgent: "reviewer",
          dependsOn: [],
          acceptanceCriteria: ["Typecheck, tests, and diff audit pass."],
          category: "security_review",
          parallel: false,
          status: "pending",
        },
      ]
      subtasks[2].dependsOn = [subtasks[0].id, subtasks[1].id]
      subtasks[3].dependsOn = [subtasks[2].id]
      subtasks[4].dependsOn = [subtasks[3].id]

      missions.set(missionID, subtasks)
      missionGoals.set(missionID, goal)

      yield* bus.publish({
        sender: "supervisor",
        type: "plan",
        payload: {
          missionID,
          mode: "ultrawork",
          goal,
          subtasks: subtasks.map((t) => ({
            id: t.id,
            title: t.title,
            agent: t.assignedAgent,
            category: t.category,
            parallel: t.parallel,
            dependsOn: t.dependsOn,
            acceptanceCriteria: t.acceptanceCriteria,
          })),
        },
      })

      return subtasks.map((task) => ({ ...task }))
    })

    const planArena = Effect.fn("OmniOrchestrator.planArena")(function* (
      problem: string,
      models: ReadonlyArray<string>,
      missionID = `mission-${crypto.randomUUID()}`,
    ) {
      const candidateAgents = ["architect", "reviewer", "coder"]
      const subtasks: TaskItem[] = models.slice(0, 3).map((modelRef, idx) => ({
        id: `arena-${crypto.randomBytes(3).toString("hex")}`,
        missionID,
        title: `[Arena Competidor #${idx + 1} · ${modelRef}] Diagnosticar e propor solução para: ${problem}`,
        assignedAgent: candidateAgents[idx % candidateAgents.length] ?? "architect",
        category: "deep_architecture",
        parallel: true,
        preferredModel: modelRef,
        status: "pending",
        dependsOn: [],
        acceptanceCriteria: ["Candidate solution is described with supporting rationale."],
      }))

      missions.set(missionID, subtasks)
      missionGoals.set(missionID, problem)

      yield* bus.publish({
        sender: "supervisor",
        type: "plan",
        payload: {
          missionID,
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

      return subtasks.map((task) => ({ ...task }))
    })

    const planTeamPipeline = Effect.fn("OmniOrchestrator.planTeamPipeline")(function* (goal: string, missionID = `mission-${crypto.randomUUID()}`) {

      const subtasks: TaskItem[] = [
        {
          id: `team-spec-${crypto.randomBytes(3).toString("hex")}`,
          missionID,
          title: `[Fase 1 · Especificação] Decompor requisitos, critérios de aceite e escopo: ${goal}`,
          assignedAgent: "planner",
          dependsOn: [],
          acceptanceCriteria: ["Scope, requirements, and acceptance criteria are explicit."],
          category: "orchestration",
          parallel: false,
          status: "pending",
        },
        {
          id: `team-arch-${crypto.randomBytes(3).toString("hex")}`,
          missionID,
          title: `[Fase 2 · Arquitetura] Desenhar interfaces, contratos de tipos e limites modulares`,
          assignedAgent: "architect",
          dependsOn: [],
          acceptanceCriteria: ["Interfaces, contracts, and module boundaries are documented."],
          category: "deep_architecture",
          parallel: false,
          status: "pending",
        },
        {
          id: `team-code-${crypto.randomBytes(3).toString("hex")}`,
          missionID,
          title: `[Fase 3 · Implementação] Desenvolver código em conformidade e criar testes`,
          assignedAgent: "coder",
          dependsOn: [],
          acceptanceCriteria: ["Implementation and tests satisfy the specification."],
          category: "code_implementation",
          parallel: false,
          status: "pending",
        },
        {
          id: `team-review-${crypto.randomBytes(3).toString("hex")}`,
          missionID,
          title: `[Fase 4 · Auditoria & Gate] Executar testes/typecheck e auditar qualidade/segurança`,
          assignedAgent: "reviewer",
          dependsOn: [],
          acceptanceCriteria: ["Tests and typecheck pass; quality and security are reviewed."],
          category: "security_review",
          parallel: false,
          status: "pending",
        },
      ]
      subtasks[1].dependsOn = [subtasks[0].id]
      subtasks[2].dependsOn = [subtasks[1].id]
      subtasks[3].dependsOn = [subtasks[2].id]

      missions.set(missionID, subtasks)
      missionGoals.set(missionID, goal)

      yield* bus.publish({
        sender: "supervisor",
        type: "plan",
        payload: {
          missionID,
          mode: "team_pipeline",
          goal,
          subtasks: subtasks.map((t) => ({
            id: t.id,
            title: t.title,
            agent: t.assignedAgent,
            category: t.category,
            dependsOn: t.dependsOn,
            acceptanceCriteria: t.acceptanceCriteria,
          })),
        },
      })

      return subtasks.map((task) => ({ ...task }))
    })

    const selectModelForAgent = Effect.fn("OmniOrchestrator.selectModelForAgent")(function* (
      agentId: string,
      taskDescription: string,
      availableModels: ReadonlyArray<Model.Info>,
    ) {
      const category = classifyTaskCategory(taskDescription, agentId)
      const coolingDown = new Set(
        (yield* Effect.filter(availableModels, (model) => isModelInCooldown(model.providerID, model.id))).map(
          (model) => `${model.providerID}/${model.id}`,
        ),
      )
      const decision = availableModels.length
        ? ModelSelectionPolicy.select(availableModels, {
            mode: "automatic",
            isCoolingDown: (ref) => coolingDown.has(`${ref.providerID}/${ref.id}`),
          })
        : undefined
      const primary = decision && { providerID: decision.selected.providerID, id: decision.selected.id }
      const fallback = availableModels
        .filter((model) => model.enabled && model.status !== "deprecated")
        .filter((model) => model.providerID !== primary?.providerID || model.id !== primary?.id)
        .sort((left, right) => `${left.providerID}/${left.id}`.localeCompare(`${right.providerID}/${right.id}`))
        .map((model) => ({ providerID: model.providerID, id: model.id }))[0]

      const thinkingLevel: "off" | "low" | "medium" | "high" | "max" = "medium"

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

    const executeTask = Effect.fn("OmniOrchestrator.executeTask")(function* (missionID: string, taskId: string, resultSummary: string) {
      const task = missions.get(missionID)?.find((t) => t.id === taskId)
      if (!task) {
        throw new Error(`Tarefa '${taskId}' não pertence à missão '${missionID}'.`)
      }
      if (task.status !== "running") throw new Error(`Tarefa '${taskId}' não está em execução.`)
      const incomplete = task.dependsOn.filter((dependency) => missions.get(missionID)?.find((candidate) => candidate.id === dependency)?.status !== "completed")
      if (incomplete.length) throw new Error(`Tarefa '${taskId}' depende de tarefas incompletas: ${incomplete.join(", ")}.`)

      task.status = "completed"
      task.result = resultSummary

      yield* bus.publish({
        sender: task.assignedAgent,
        taskId: task.id,
        type: "status",
        payload: { missionID, status: "completed", result: resultSummary },
      })

      return { ...task }
    })

    const startTask = Effect.fn("OmniOrchestrator.startTask")(function* (missionID: string, taskId: string, childSessionID?: string) {
      const task = missions.get(missionID)?.find((item) => item.id === taskId)
      if (!task) throw new Error(`Tarefa '${taskId}' não pertence à missão '${missionID}'.`)
      if (task.status === "running" && childSessionID) {
        task.childSessionID = childSessionID
        return { ...task }
      }
      if (task.status !== "pending") throw new Error(`Tarefa '${taskId}' não está pendente.`)
      const incomplete = task.dependsOn.filter((dependency) => missions.get(missionID)?.find((item) => item.id === dependency)?.status !== "completed")
      if (incomplete.length) throw new Error(`Tarefa '${taskId}' depende de tarefas incompletas: ${incomplete.join(", ")}.`)
      task.status = "running"
      task.childSessionID = childSessionID
      yield* bus.publish({ sender: "supervisor", taskId: task.id, type: "status", payload: { missionID, status: "running", childSessionID } })
      return { ...task }
    })

    const failTask = Effect.fn("OmniOrchestrator.failTask")(function* (missionID: string, taskId: string, reason: string) {
      const task = missions.get(missionID)?.find((item) => item.id === taskId)
      if (!task) throw new Error(`Tarefa '${taskId}' não pertence à missão '${missionID}'.`)
      if (task.status !== "running") throw new Error(`Tarefa '${taskId}' não está em execução.`)
      task.status = "failed"
      task.result = reason
      yield* bus.publish({ sender: task.assignedAgent, taskId: task.id, type: "status", payload: { missionID, status: "failed", result: reason } })
      return { ...task }
    })

    const getActiveTasks = Effect.fn("OmniOrchestrator.getActiveTasks")(function* (missionID?: string) {
      return missionID ? (missions.get(missionID) ?? []).map((task) => ({ ...task })) : []
    })
    const getReadyTasks = Effect.fn("OmniOrchestrator.getReadyTasks")(function* (missionID: string) {
      const tasks = missions.get(missionID) ?? []
      return tasks.filter((task) => task.status === "pending" && task.dependsOn.every((dependency) => tasks.find((candidate) => candidate.id === dependency)?.status === "completed")).map((task) => ({ ...task }))
    })
    const getMissionGoal = Effect.fn("OmniOrchestrator.getMissionGoal")(function* (missionID: string) {
      return missionGoals.get(missionID)
    })

    return Service.of({
      markModelCooldown,
      clearModelCooldown,
      isModelInCooldown,
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
      startTask,
      failTask,
      getActiveTasks,
      getReadyTasks,
      getMissionGoal,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, OmniBus.node, OmniConfig.node],
})
