import fs from 'node:fs/promises';

/**
 * Roteador Inteligente de Modelos
 * 1. Permite adicionar modelos dinamicamente (OpenAI, Claude, Gemini, DeepSeek, Ollama, Custom).
 * 2. Escolhe automaticamente o melhor modelo para cada agente e tarefa com base em critérios
 *    (habilidade requerida, custo, contexto, chaves de API disponíveis).
 * 3. Permite sobrescrever e travar modelos manualmente.
 */
export class ModelRouter {
  constructor(modelsConfig, configPath) {
    this.config = modelsConfig;
    this.configPath = configPath;
  }

  /**
   * Retorna todos os modelos cadastrados no sistema (padrão + custom)
   */
  getAllModels() {
    const list = [];

    // Modelos dos provedores nativos
    for (const [providerKey, provider] of Object.entries(this.config.providers || {})) {
      for (const m of provider.models || []) {
        list.push({
          ...m,
          provider: providerKey,
          isConfigured: this.isModelConfigured(providerKey, provider.envKey, provider.isLocal)
        });
      }
    }

    // Modelos customizados adicionados pelo usuário
    for (const m of this.config.custom_models || []) {
      list.push({
        ...m,
        provider: m.provider || 'custom',
        isConfigured: this.isModelConfigured(m.provider, m.envKey, m.isLocal)
      });
    }

    return list;
  }

  /**
   * Verifica se a chave de API ou endpoint local está disponível
   */
  isModelConfigured(providerKey, envKey, isLocal) {
    if (isLocal) {
      return Boolean(process.env.ENABLE_OLLAMA === 'true' || (process.env.OLLAMA_BASE_URL && process.env.OLLAMA_BASE_URL.length > 5));
    }
    if (!envKey) return true;
    const val = process.env[envKey];
    return Boolean(val && val.length > 5 && !val.includes('your_'));
  }

  /**
   * Seleciona o melhor modelo para um agente com base no seu papel e tarefa
   * @param {Object} agentDef - Definição do agente (id, role, preferred_model_criteria, model)
   * @param {string} [taskHint] - Dica sobre a tarefa atual (ex: 'coding', 'review', 'research')
   */
  selectModelForAgent(agentDef, taskHint = '') {
    // 1. Se o agente tem um modelo explícito fixado diferente de 'auto'
    if (agentDef.model && agentDef.model !== 'auto') {
      const explicit = this.getAllModels().find((m) => m.id === agentDef.model);
      if (explicit) return explicit.id;
      return agentDef.model;
    }

    // 2. Modo 'auto': O orquestrador escolhe o melhor modelo disponível
    const available = this.getAllModels().filter((m) => m.isConfigured);
    // Se nenhuma chave configurada no momento, avalia o catálogo completo para indicar o modelo ideal
    const candidates = available.length > 0 ? available : this.getAllModels();

    if (candidates.length === 0) {
      return 'claude-3-7-sonnet-20250219';
    }

    const desiredStrengths = [...(agentDef.preferred_model_criteria?.strengths || [])];
    if (taskHint) desiredStrengths.push(taskHint);

    // Pontua cada modelo disponível
    let bestModel = candidates[0];
    let highestScore = -1;

    for (const model of candidates) {
      let score = 0;
      const strengths = model.strengths || [];

      // Pontua correspondência de habilidades
      for (const req of desiredStrengths) {
        if (strengths.includes(req)) score += 3;
      }

      // Pontuação por janela de contexto
      if (agentDef.preferred_model_criteria?.minContextWindow) {
        if ((model.contextWindow || 0) >= agentDef.preferred_model_criteria.minContextWindow) {
          score += 2;
        }
      }

      // Preferência natural por especialidade técnica
      if (agentDef.id === 'supervisor' && (model.id.includes('claude-3-7') || model.id.includes('gpt-4o') || model.id.includes('gemini-1.5-pro'))) score += 3;
      if (agentDef.id === 'coder' && (model.id.includes('claude') || model.id.includes('coder'))) score += 4;
      if (agentDef.id === 'reviewer' && (model.id.includes('gpt-4o') || model.id.includes('o3') || model.id.includes('reasoner'))) score += 4;
      if (agentDef.id === 'researcher' && (model.id.includes('gemini') || model.id.includes('flash'))) score += 4;
      if (agentDef.id === 'terminal_operator' && (model.id.includes('haiku') || model.id.includes('flash') || model.id.includes('mini'))) score += 4;

      if (score > highestScore) {
        highestScore = score;
        bestModel = model;
      }
    }

    return bestModel.id;
  }

  /**
   * Adiciona dinamicamente um novo modelo ao sistema e persiste no arquivo de configuração
   */
  async addCustomModel({ id, name, provider = 'openai-compatible', baseUrl, envKey, strengths = [], contextWindow = 128000, isLocal = false }) {
    if (!id || !name) {
      throw new Error(`ID e Nome do modelo são obrigatórios.`);
    }

    const newModel = {
      id,
      name,
      provider,
      baseUrl: baseUrl || 'https://api.openai.com/v1',
      envKey: envKey || 'CUSTOM_API_KEY',
      strengths: Array.isArray(strengths) ? strengths : [strengths],
      contextWindow: Number(contextWindow) || 128000,
      isLocal: Boolean(isLocal),
      addedAt: new Date().toISOString()
    };

    if (!Array.isArray(this.config.custom_models)) {
      this.config.custom_models = [];
    }

    // Remove se já existia com o mesmo ID
    this.config.custom_models = this.config.custom_models.filter((m) => m.id !== id);
    this.config.custom_models.push(newModel);

    // Salva no disco
    if (this.configPath) {
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    }

    return newModel;
  }
}
