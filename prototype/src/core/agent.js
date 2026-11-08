/**
 * Classe do Agente Especialista Autônomo (Ciclo ReAct: Pensar -> Agir -> Observar -> Concluir)
 */
export class AutonomousAgent {
  /**
   * @param {Object} params
   * @param {string} params.id
   * @param {string} params.name
   * @param {string} params.role
   * @param {string} params.systemPrompt
   * @param {string} params.modelId - ID do modelo atribuído (ex: 'claude-3-7-sonnet', 'gpt-4o', etc.)
   * @param {import('../models/provider.js').UniversalModelProvider} params.provider
   * @param {import('../hub/registry.js').ToolRegistry} params.toolsRegistry
   * @param {Function} [params.onEvent] - Callback para emissão de pensamentos e ações em tempo real
   */
  constructor({ id, name, role, systemPrompt, modelId, provider, toolsRegistry, onEvent = () => {} }) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.systemPrompt = systemPrompt;
    this.modelId = modelId;
    this.provider = provider;
    this.toolsRegistry = toolsRegistry;
    this.onEvent = onEvent;
  }

  /**
   * Executa uma tarefa atribuída pelo orquestrador
   * @param {string} taskDescription
   * @param {Object} [sharedContext={}] - Contexto global compartilhado entre os agentes
   * @param {number} [maxSteps=10] - Limite de passos para evitar loops infinitos
   */
  async runTask(taskDescription, sharedContext = {}, maxSteps = 10) {
    this.onEvent({
      type: 'agent_start',
      agentId: this.id,
      agentName: this.name,
      modelId: this.modelId,
      task: taskDescription
    });

    // Constrói prompt de sistema incluindo contexto compartilhado e diretrizes
    const contextSnippet = Object.keys(sharedContext).length > 0
      ? `\n\n[CONTEXTO COMPARTILHADO DA EQUIPE]:\n${JSON.stringify(sharedContext, null, 2)}`
      : '';

    const messages = [
      {
        role: 'system',
        content: `[AGENT_ID: ${this.id}] [ROLE: ${this.role}]\n${this.systemPrompt}${contextSnippet}\n\nVocê tem acesso a ferramentas de manipulação de arquivos, terminal, busca web e skills. Use-as sempre que necessário para inspecionar, executar e testar o código.`
      },
      {
        role: 'user',
        content: `Sua tarefa é:\n${taskDescription}\n\nExecute as ações necessárias e entregue uma conclusão clara do que foi realizado.`
      }
    ];

    const tools = this.toolsRegistry.getDefinitions();
    let currentStep = 0;
    let finalAnswer = '';

    while (currentStep < maxSteps) {
      currentStep++;

      this.onEvent({
        type: 'agent_thinking',
        agentId: this.id,
        step: currentStep,
        modelId: this.modelId
      });

      // Chama o modelo correspondente via Universal Provider
      let response;
      try {
        response = await this.provider.call({
          modelId: this.modelId,
          messages,
          tools
        });
      } catch (err) {
        this.onEvent({
          type: 'agent_error',
          agentId: this.id,
          error: err.message
        });
        return {
          agentId: this.id,
          success: false,
          error: err.message,
          stepsCompleted: currentStep
        };
      }

      const { text, toolCalls } = response;

      if (text) {
        this.onEvent({
          type: 'agent_message',
          agentId: this.id,
          text
        });
      }

      // Adiciona a resposta do assistente ao histórico
      messages.push({
        role: 'assistant',
        content: text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined
      });

      // Se o modelo não chamou ferramentas, ele concluiu a tarefa
      if (!toolCalls || toolCalls.length === 0) {
        finalAnswer = text;
        break;
      }

      // Executa as ferramentas chamadas pelo modelo
      for (const call of toolCalls) {
        this.onEvent({
          type: 'agent_tool_call',
          agentId: this.id,
          toolName: call.name,
          args: call.args
        });

        // Executa a ferramenta no Registro Global
        const result = await this.toolsRegistry.execute(call.name, call.args);

        this.onEvent({
          type: 'agent_tool_result',
          agentId: this.id,
          toolName: call.name,
          result
        });

        // Registra o resultado para o modelo continuar seu raciocínio
        messages.push({
          role: 'tool',
          name: call.name,
          tool_call_id: call.id,
          content: typeof result === 'string' ? result : JSON.stringify(result)
        });
      }
    }

    this.onEvent({
      type: 'agent_complete',
      agentId: this.id,
      agentName: this.name,
      finalAnswer
    });

    return {
      agentId: this.id,
      success: true,
      result: finalAnswer,
      steps: currentStep
    };
  }
}
