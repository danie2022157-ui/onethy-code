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
import { OmniSession } from "./omni-session.js"
import { OmniTaskGraph } from "./omni-task-graph.js"

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
  readonly category?: TaskCategory
  readonly parallel?: boolean
  /** Dependencies are used by custom graph missions; absent for legacy plans. */
  readonly dependsOn?: ReadonlyArray<string>
  readonly preferredModel?: string
  status: "pending" | "running" | "completed" | "failed"
  result?: string
}

export type TaskTransition = "complete" | "fail" | "retry"

/** State changes are explicit; planning a task is not proof that an agent ran it. */
export function assertTaskTransition(task: Pick<TaskItem, "id" | "status">, transition: TaskTransition) {
  const required: TaskItem["status"] = transition === "retry" ? "failed" : "running"
  if (task.status !== required) {
    throw new Error(`Cannot ${transition} task '${task.id}': expected ${required}, got ${task.status}.`)
  }
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
  readonly createMission: (goal: string, missionID: string, tasks: ReadonlyArray<OmniTaskGraph.Definition>) => Effect.Effect<ReadonlyArray<TaskItem>, never>
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
  readonly getActiveTasks: (missionID?: string) => Effect.Effect<ReadonlyArray<TaskItem>, never>
  /** Claims the next runnable stage while respecting parallel flags and a concurrency limit. */
  readonly claimReadyTasks: (missionID: string, maxParallel?: number) => Effect.Effect<ReadonlyArray<TaskItem>, never>
  readonly failTask: (missionID: string, taskId: string, reason: string) => Effect.Effect<TaskItem, never>
  readonly retryTask: (missionID: string, taskId: string) => Effect.Effect<TaskItem, never>
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
    const store = yield* OmniSession.Service
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
    const missionTasks = Effect.fn("OmniOrchestrator.missionTasks")(function* (missionID: string) {
      const existing = missions.get(missionID)
      if (existing) return existing
      const persisted = yield* store.loadMissionTasks(missionID)
      if (!persisted) return undefined
      // A task left "running" after a crash has no live worker. Require an explicit retry.
      const restored: TaskItem[] = persisted.map((task) => task.status === "running"
        ? { ...task, status: "failed", result: "Interrupted by OnethyCode restart; retry required" }
        : { ...task })
      missions.set(missionID, restored)
      if (persisted.some((task) => task.status === "running")) yield* store.saveMissionTasks(missionID, restored)
      return restored
    })

    const getAgents = Effect.fn("OmniOrchestrator.getAgents")(function* () {
      return [...DEFAULT_AGENTS]
    })

    const assertNewMission = Effect.fn("OmniOrchestrator.assertNewMission")(function* (missionID: string, goal: string) {
      if (!goal.trim()) throw new Error("Mission goal cannot be empty")
      if (yield* missionTasks(missionID)) throw new Error(`Mission '${missionID}' already exists. Reuse its tasks instead of overwriting history.`)
    })

    const createMission = Effect.fn("OmniOrchestrator.createMission")(function* (
      goal: string, missionID: string, definitions: ReadonlyArray<OmniTaskGraph.Definition>,
    ) {
      OmniTaskGraph.validate(definitions)
      yield* assertNewMission(missionID, goal)
      const tasks: TaskItem[] = definitions.map((task) => ({
        id: task.id,
        missionID,
        title: task.title.trim(),
        assignedAgent: task.assignedAgent,
        dependsOn: [...(task.dependsOn ?? [])],
        parallel: true,
        status: "pending",
      }))
      yield* store.saveMissionTasks(missionID, tasks)
      missions.set(missionID, tasks)
      yield* bus.publish({
        sender: "supervisor", type: "plan",
        payload: {
          missionID, goal, mode: "dependency_graph",
          subtasks: tasks.map((task) => ({
            id: task.id, title: task.title, agent: task.assignedAgent, dependsOn: task.dependsOn,
          })),
        },
      })
      return tasks.map((task) => ({ ...task }))
    })

    const planMission = Effect.fn("OmniOrchestrator.planMission")(function* (goal: string, missionID = `mission-${crypto.randomUUID()}`) {
      yield* assertNewMission(missionID, goal)

      // Supervisor gera as subtarefas especializadas para a missão
      const subtasks: TaskItem[] = [
        {
          id: `task-${crypto.randomUUID()}`,
          missionID,
          title: `Explorar e mapear contexto para: ${goal}`,
          assignedAgent: "researcher",
          status: "pending",
        },
        {
          id: `task-${crypto.randomUUID()}`,
          missionID,
          title: `Implementar alterações solicitadas`,
          assignedAgent: "coder",
          status: "pending",
        },
        {
          id: `task-${crypto.randomUUID()}`,
          missionID,
          title: `Revisar diff e verificar segurança/testes`,
          assignedAgent: "reviewer",
          status: "pending",
        },
      ]

      missions.set(missionID, subtasks)
      yield* store.saveMissionTasks(missionID, subtasks)

      yield* bus.publish({
        sender: "supervisor",
        type: "plan",
        payload: { missionID, goal, subtasks: subtasks.map((t) => ({ id: t.id, title: t.title, agent: t.assignedAgent })) },
      })

      return subtasks.map((task) => ({ ...task }))
    })

    const planUltrawork = Effect.fn("OmniOrchestrator.planUltrawork")(function* (goal: string, missionID = `mission-${crypto.randomUUID()}`) {
      yield* assertNewMission(missionID, goal)

      const subtasks: TaskItem[] = [
        {
          id: `ulw-${crypto.randomUUID()}`,
          missionID,
          title: `[Paralelo 1] Varredura rápida de arquivos e símbolos para: ${goal}`,
          assignedAgent: "explore",
          category: "fast_explore",
          parallel: true,
          status: "pending",
        },
        {
          id: `ulw-${crypto.randomUUID()}`,
          missionID,
          title: `[Paralelo 2] Pesquisa de documentação e contratos de API para: ${goal}`,
          assignedAgent: "librarian",
          category: "external_research",
          parallel: true,
          status: "pending",
        },
        {
          id: `ulw-${crypto.randomUUID()}`,
          missionID,
          title: `Validar arquitetura, invariantes de segurança e impacto entre pacotes`,
          assignedAgent: "architect",
          category: "deep_architecture",
          parallel: false,
          status: "pending",
        },
        {
          id: `ulw-${crypto.randomUUID()}`,
          missionID,
          title: `Implementar código de produção e testes unitários completos`,
          assignedAgent: "coder",
          category: "code_implementation",
          parallel: false,
          status: "pending",
        },
        {
          id: `ulw-${crypto.randomUUID()}`,
          missionID,
          title: `Gate final (Ralph Loop): executar typecheck, testes e auditoria de diff`,
          assignedAgent: "reviewer",
          category: "security_review",
          parallel: false,
          status: "pending",
        },
      ]

      missions.set(missionID, subtasks)
      yield* store.saveMissionTasks(missionID, subtasks)

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
      yield* assertNewMission(missionID, problem)
      if (models.length === 0) throw new Error("Arena requires at least one candidate model")
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
      }))

      missions.set(missionID, subtasks)
      yield* store.saveMissionTasks(missionID, subtasks)

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
      yield* assertNewMission(missionID, goal)

      const subtasks: TaskItem[] = [
        {
          id: `team-spec-${crypto.randomBytes(3).toString("hex")}`,
          missionID,
          title: `[Fase 1 · Especificação] Decompor requisitos, critérios de aceite e escopo: ${goal}`,
          assignedAgent: "planner",
          category: "orchestration",
          parallel: false,
          status: "pending",
        },
        {
          id: `team-arch-${crypto.randomBytes(3).toString("hex")}`,
          missionID,
          title: `[Fase 2 · Arquitetura] Desenhar interfaces, contratos de tipos e limites modulares`,
          assignedAgent: "architect",
          category: "deep_architecture",
          parallel: false,
          status: "pending",
        },
        {
          id: `team-code-${crypto.randomBytes(3).toString("hex")}`,
          missionID,
          title: `[Fase 3 · Implementação] Desenvolver código em conformidade e criar testes`,
          assignedAgent: "coder",
          category: "code_implementation",
          parallel: false,
          status: "pending",
        },
        {
          id: `team-review-${crypto.randomBytes(3).toString("hex")}`,
          missionID,
          title: `[Fase 4 · Auditoria & Gate] Executar testes/typecheck e auditar qualidade/segurança`,
          assignedAgent: "reviewer",
          category: "security_review",
          parallel: false,
          status: "pending",
        },
      ]

      missions.set(missionID, subtasks)
      yield* store.saveMissionTasks(missionID, subtasks)

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
      const policy = {
        mode: "automatic" as const,
        requiredTypes: ["chat"],
        requiredCapabilities: { tools: true },
        rankBy: category === "fast_explore" || category === "external_research"
          ? "cost" as const
          : category === "deep_architecture" || category === "security_review"
            ? "context" as const
            : "newest" as const,
        isCoolingDown: (ref: Model.Ref) => coolingDown.has(`${ref.providerID}/${ref.id}`),
      }
      const eligible = availableModels.filter((model) =>
        model.enabled && model.status !== "deprecated" &&
        (model.type ?? "chat") === "chat" && model.capabilities.tools,
      )
      const decision = eligible.length ? ModelSelectionPolicy.select(eligible, policy) : undefined
      const primary = decision && { providerID: decision.selected.providerID, id: decision.selected.id }
      const alternates = eligible.filter((model) => model.providerID !== primary?.providerID || model.id !== primary?.id)
      const secondary = alternates.length ? ModelSelectionPolicy.select(alternates, policy).selected : undefined
      const fallback = secondary && { providerID: secondary.providerID, id: secondary.id }

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
      const tasks = yield* missionTasks(missionID)
      const task = tasks?.find((t) => t.id === taskId)
      if (!task) {
        throw new Error(`Tarefa '${taskId}' não pertence à missão '${missionID}'.`)
      }

      assertTaskTransition(task, "complete")
      if (!resultSummary.trim()) throw new Error("Completed tasks must include a result summary.")
      const next = tasks!.map((entry) => entry.id === taskId
        ? { ...entry, status: "completed" as const, result: resultSummary.slice(0, 8000) }
        : { ...entry })
      yield* store.saveMissionTasks(missionID, next)
      missions.set(missionID, next)
      const completed = next.find((entry) => entry.id === taskId)!

      yield* bus.publish({
        sender: task.assignedAgent,
        taskId: task.id,
        type: "status",
        payload: { missionID, status: "completed", result: completed.result },
      })

      return { ...completed }
    })

    /** Claim one sequential task or a contiguous batch of parallel tasks; never skip an unfinished stage. */
    const claimReadyTasks = Effect.fn("OmniOrchestrator.claimReadyTasks")(function* (missionID: string, maxParallel = 3) {
      const tasks = yield* missionTasks(missionID)
      if (!tasks || !Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 8) return []
      // Graph missions can dispatch non-contiguous independent tasks. Legacy stage order remains intact.
      if (tasks.some((task) => task.dependsOn !== undefined)) {
        const claimable = OmniTaskGraph.ready(tasks, maxParallel)
        for (const task of claimable) {
          task.status = "running"
          yield* bus.publish({
            sender: "supervisor", target: task.assignedAgent, taskId: task.id,
            type: "status", payload: { missionID, status: "running" },
          })
        }
        if (claimable.length) yield* store.saveMissionTasks(missionID, tasks)
        return claimable.map((task) => ({ ...task }))
      }
      const running = tasks.filter((task) => task.status === "running")
      if (running.some((task) => !task.parallel)) return []
      const remaining = maxParallel - running.length
      if (remaining < 1) return []
      const next = tasks.findIndex((task) => task.status === "pending")
      if (next < 0 || tasks.slice(0, next).some((task) => task.status === "failed")) return []
      const first = tasks[next]
      if (!first.parallel && running.length > 0) return []
      // Never start work past a failed stage or a serial dependency.
      const boundary = tasks.findIndex(
        (task, index) => index >= next && (!task.parallel || task.status !== "pending"),
      )
      const claimable = first.parallel
        ? tasks.slice(next, boundary < 0 ? undefined : boundary).slice(0, remaining)
        : [first]
      for (const task of claimable) {
        task.status = "running"
        yield* bus.publish({
          sender: "supervisor",
          target: task.assignedAgent,
          taskId: task.id,
          type: "status",
          payload: { missionID, status: "running" },
        })
      }
      yield* store.saveMissionTasks(missionID, tasks)
      return claimable.map((task) => ({ ...task }))
    })

    const failTask = Effect.fn("OmniOrchestrator.failTask")(function* (missionID: string, taskId: string, reason: string) {
      const tasks = yield* missionTasks(missionID)
      const task = tasks?.find((entry) => entry.id === taskId)
      if (!task) throw new Error(`Task '${taskId}' does not belong to mission '${missionID}'.`)
      assertTaskTransition(task, "fail")
      const next = tasks!.map((entry) => entry.id === taskId
        ? { ...entry, status: "failed" as const, result: reason.slice(0, 8000) }
        : { ...entry })
      yield* store.saveMissionTasks(missionID, next)
      missions.set(missionID, next)
      const failed = next.find((entry) => entry.id === taskId)!
      yield* bus.publish({
        sender: task.assignedAgent,
        taskId,
        type: "status",
        payload: { missionID, status: "failed", reason: failed.result },
      })
      return { ...failed }
    })

    const retryTask = Effect.fn("OmniOrchestrator.retryTask")(function* (missionID: string, taskId: string) {
      const tasks = yield* missionTasks(missionID)
      const task = tasks?.find((entry) => entry.id === taskId)
      if (!task) throw new Error("Unknown task or mission")
      assertTaskTransition(task, "retry")
      const next = tasks!.map((entry) => entry.id === taskId
        ? { ...entry, status: "pending" as const, result: undefined }
        : { ...entry })
      yield* store.saveMissionTasks(missionID, next)
      missions.set(missionID, next)
      return { ...next.find((entry) => entry.id === taskId)! }
    })

    const getActiveTasks = Effect.fn("OmniOrchestrator.getActiveTasks")(function* (missionID?: string) {
      const tasks = missionID ? yield* missionTasks(missionID) : undefined
      return tasks?.map((task) => ({ ...task })) ?? []
    })

    return Service.of({
      markModelCooldown,
      clearModelCooldown,
      isModelInCooldown,
      getAgents,
      planMission,
      createMission,
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
      claimReadyTasks,
      failTask,
      retryTask,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, OmniBus.node, OmniConfig.node, OmniSession.node],
})
