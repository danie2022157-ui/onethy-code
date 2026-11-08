import fs from 'node:fs/promises';
import { AutonomousAgent } from './agent.js';
import { SharedProjectMemory } from './memory.js';
import { AgentMessageBus } from './bus.js';
import { SessionStore } from './session_store.js';

/**
 * Maestro Orchestrator
 * Coordena a equipe de agentes com múltiplos modelos, barramento de mensagens e memória persistente.
 * Suporta criação dinâmica de agentes, atribuição flexível de modelos e persistência de sessões.
 */
export class MaestroOrchestrator {
  /**
   * @param {Object} params
   * @param {Object} params.agentsConfig
   * @param {string} [params.configPath]
   * @param {import('./router.js').ModelRouter} params.router
   * @param {import('../models/provider.js').UniversalModelProvider} params.provider
   * @param {import('../hub/registry.js').ToolRegistry} params.toolsRegistry
   * @param {Function} [params.onEvent]
   */
  constructor({ agentsConfig, configPath = null, router, provider, toolsRegistry, onEvent = () => {} }) {
    this.agentsConfig = agentsConfig;
    this.configPath = configPath;
    this.router = router;
    this.provider = provider;
    this.toolsRegistry = toolsRegistry;
    this.onEvent = onEvent;
    this.memory = new SharedProjectMemory();
    this.bus = new AgentMessageBus();
    this.sessionStore = new SessionStore();
  }

  /**
   * Retorna a lista atual de agentes cadastrados
   */
  getAgents() {
    return this.agentsConfig.agents || [];
  }

  /**
   * Cria e registra um novo agente na equipe
   */
  async addAgent({ id, name, role, description = '', model = 'auto', strengths = [], system_prompt = '' }) {
    if (!id || !name || !role) {
      throw new Error(`ID, Nome e Papel (Role) são obrigatórios para criar um agente.`);
    }

    const cleanId = id.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '_');
    const existingIndex = this.agentsConfig.agents.findIndex((a) => a.id === cleanId);

    const newAgent = {
      id: cleanId,
      name: name.trim(),
      role: role.trim(),
      description: description.trim() || `Especialista em ${role}`,
      model: model || 'auto',
      preferred_model_criteria: {
        strengths: Array.isArray(strengths) && strengths.length > 0 ? strengths : ['coding', 'tool-use'],
        minContextWindow: 64000
      },
      system_prompt: system_prompt.trim() || `Você é o ${name}, atuando como ${role}. Execute suas tarefas com precisão técnica e utilize as ferramentas adequadas.`
    };

    if (existingIndex >= 0) {
      this.agentsConfig.agents[existingIndex] = newAgent;
    } else {
      this.agentsConfig.agents.push(newAgent);
    }

    await this.saveAgentsConfig();
    return newAgent;
  }

  /**
   * Altera o modelo de um agente
   */
  async updateAgentModel(agentId, modelId) {
    const agent = this.agentsConfig.agents.find((a) => a.id === agentId);
    if (!agent) {
      throw new Error(`Agente '${agentId}' não encontrado.`);
    }
    agent.model = modelId;
    await this.saveAgentsConfig();
    return agent;
  }

  /**
   * Remove um agente da equipe
   */
  async removeAgent(agentId) {
    const initialLen = this.agentsConfig.agents.length;
    this.agentsConfig.agents = this.agentsConfig.agents.filter((a) => a.id !== agentId);
    if (this.agentsConfig.agents.length === initialLen) {
      throw new Error(`Agente '${agentId}' não encontrado.`);
    }
    await this.saveAgentsConfig();
    return true;
  }

  /**
   * Cria dinamicamente um agente especialista sob demanda
   */
  createDynamicAgent(agentId, taskTitle) {
    const formattedName = agentId
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const newAgent = {
      id: agentId,
      name: `${formattedName} Specialist`,
      role: `Especialista Dinâmico para ${agentId}`,
      description: `Agente criado dinamicamente pelo orquestrador para a tarefa: ${taskTitle}`,
      model: 'auto',
      preferred_model_criteria: {
        strengths: [agentId, 'tool-use', 'coding'],
        minContextWindow: 64000
      },
      system_prompt: `Você é o especialista autônomo ${formattedName}. Sua missão específica é executar com perfeição a tarefa: "${taskTitle}". Utilize as ferramentas do sistema conforme necessário.`
    };

    this.agentsConfig.agents.push(newAgent);
    this.saveAgentsConfig().catch(() => {});
    return newAgent;
  }

  /**
   * Salva as configurações de agentes atualizadas no disco
   */
  async saveAgentsConfig() {
    if (this.configPath) {
      await fs.writeFile(this.configPath, JSON.stringify(this.agentsConfig, null, 2), 'utf-8');
    }
  }

  /**
   * Executa uma missão completa de programação ou orquestração
   * @param {string} userGoal - Objetivo informado pelo usuário
   * @param {Object} [options]
   * @param {string} [options.sessionId] - ID da sessão para persistência
   */
  async executeMission(userGoal, { sessionId = null } = {}) {
    this.memory = new SharedProjectMemory(userGoal);
    this.bus.clear();
    this.onEvent({ type: 'mission_start', goal: userGoal });

    // Recupera memória durável do projeto (decisões passadas)
    const projectDecisions = await this.sessionStore.getProjectMemory();

    // 1. Etapa de Planejamento com o Agente Supervisor
    const supervisorDef = this.agentsConfig.agents.find((a) => a.id === 'supervisor') || this.agentsConfig.agents[0];
    const supervisorModel = this.router.selectModelForAgent(supervisorDef, 'planning');

    this.onEvent({
      type: 'orchestrator_delegation',
      agentName: supervisorDef.name,
      modelId: supervisorModel,
      taskTitle: 'Planejamento e Decomposição de Tarefas da Missão'
    });

    const supervisorAgent = new AutonomousAgent({
      ...supervisorDef,
      modelId: supervisorModel,
      provider: this.provider,
      toolsRegistry: this.toolsRegistry,
      onEvent: this.onEvent
    });

    const availableAgentsSummary = this.agentsConfig.agents
      .map((a) => `- ${a.id} (${a.name}): ${a.role}`)
      .join('\n');

    let memoryContext = '';
    if (projectDecisions && projectDecisions.trim().length > 50) {
      memoryContext = `\n[MEMÓRIA E DECISÕES ANTERIORES DO PROJETO]:\n${projectDecisions}\n`;
    }

    const planPrompt = `O usuário deseja atingir o seguinte objetivo no projeto:\n"${userGoal}"\n${memoryContext}\nAgentes disponíveis na equipe:\n${availableAgentsSummary}\n\nAnalise o objetivo e crie um plano com 2 a 5 subtarefas estruturadas. Para cada tarefa, indique qual agente especialista é o mais recomendado.\n\nResponda estritamente em formato JSON com o seguinte formato:\n{\n  "plan": [\n    {"title": "Descrição clara da tarefa 1", "agent": "id_do_agente"},\n    {"title": "Descrição clara da tarefa 2", "agent": "id_do_agente"}\n  ]\n}`;

    let planData = null;
    try {
      const planResult = await supervisorAgent.runTask(planPrompt, {}, 3);
      if (planResult && planResult.result) {
        const jsonMatch = planResult.result.match(/\{[\s\S]*"plan"[\s\S]*\}/);
        if (jsonMatch) {
          planData = JSON.parse(jsonMatch[0]);
        }
      }
    } catch {
      // Fallback em caso de parse ou falha de rede
    }

    if (!planData || !Array.isArray(planData.plan) || planData.plan.length === 0) {
      planData = {
        plan: [
          { title: `Pesquisar ou inspecionar estrutura necessária para: ${userGoal.slice(0, 60)}`, agent: 'researcher' },
          { title: `Implementar a solução de código para: ${userGoal.slice(0, 60)}`, agent: 'coder' },
          { title: `Revisar código, testar e validar execução`, agent: 'reviewer' }
        ]
      };
    }

    this.memory.setPlan(planData.plan);
    this.bus.publish({
      sender: 'supervisor',
      type: 'plan',
      payload: planData.plan
    });

    this.onEvent({
      type: 'mission_plan_ready',
      subtasks: this.memory.subtasks
    });

    // 2. Executa as tarefas sequencialmente delegando para os especialistas
    for (const subtask of this.memory.subtasks) {
      this.memory.updateTaskStatus(subtask.id, 'in_progress');
      this.onEvent({ type: 'subtask_start', subtask });

      let agentDef = this.agentsConfig.agents.find((a) => a.id === subtask.assignedAgent);
      if (!agentDef) {
        agentDef = this.createDynamicAgent(subtask.assignedAgent, subtask.title);
      }

      const selectedModel = this.router.selectModelForAgent(agentDef, subtask.title);

      this.onEvent({
        type: 'orchestrator_delegation',
        subtaskId: subtask.id,
        agentName: agentDef.name,
        modelId: selectedModel,
        taskTitle: subtask.title
      });

      const workerAgent = new AutonomousAgent({
        ...agentDef,
        modelId: selectedModel,
        provider: this.provider,
        toolsRegistry: this.toolsRegistry,
        onEvent: this.onEvent
      });

      const taskResult = await workerAgent.runTask(subtask.title, this.memory.getSnapshot(), 10);

      if (taskResult.success) {
        const resultSummary = typeof taskResult.result === 'string' ? taskResult.result : JSON.stringify(taskResult.result);
        this.memory.updateTaskStatus(subtask.id, 'completed', resultSummary);
        this.memory.recordContribution(agentDef.id, (resultSummary || '').slice(0, 200));

        this.bus.publish({
          sender: agentDef.id,
          taskId: subtask.id,
          type: 'artifact',
          payload: (resultSummary || '').slice(0, 500)
        });

        this.onEvent({ type: 'subtask_completed', subtask, result: resultSummary });
      } else {
        this.memory.updateTaskStatus(subtask.id, 'failed', taskResult.error);
        this.bus.publish({
          sender: agentDef.id,
          taskId: subtask.id,
          type: 'status',
          payload: { error: taskResult.error }
        });
        this.onEvent({ type: 'subtask_failed', subtask, error: taskResult.error });
      }
    }

    // 3. Salva a sessão no disco de forma persistente
    const savedSessionId = await this.sessionStore.saveSession({
      id: sessionId,
      goal: userGoal,
      subtasks: this.memory.subtasks,
      messages: this.bus.messages,
      todos: this.memory.subtasks.map((s) => ({ content: s.title, status: s.status }))
    }).catch(() => null);

    this.onEvent({
      type: 'mission_complete',
      goal: userGoal,
      sessionId: savedSessionId,
      summary: this.memory.getSnapshot()
    });

    return {
      goal: userGoal,
      sessionId: savedSessionId,
      snapshot: this.memory.getSnapshot()
    };
  }
}
