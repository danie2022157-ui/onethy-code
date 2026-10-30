/**
 * Global Tool & Capability Registry
 * Todas as ferramentas nativas, ferramentas de servidores MCP e Skills
 * são registradas aqui e ficam disponíveis universalmente para TODOS os modelos e agentes.
 */
export class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.mcpSources = new Map();
  }

  /**
   * Registra uma ferramenta globalmente.
   * @param {Object} toolDef
   * @param {string} toolDef.name - Nome único da ferramenta
   * @param {string} toolDef.description - Descrição para o modelo entender quando chamar
   * @param {Object} toolDef.parameters - JSON Schema dos parâmetros esperados
   * @param {Function} toolDef.execute - Função de execução (async)
   * @param {string} [toolDef.source='native'] - Origem ('native', 'mcp:<serverId>', 'skill')
   */
  register(toolDef) {
    if (!toolDef.name || typeof toolDef.execute !== 'function') {
      throw new Error(`Ferramenta inválida. Requer 'name' e 'execute'.`);
    }
    this.tools.set(toolDef.name, {
      name: toolDef.name,
      description: toolDef.description || '',
      parameters: toolDef.parameters || { type: 'object', properties: {} },
      execute: toolDef.execute,
      source: toolDef.source || 'native'
    });
  }

  /**
   * Retorna uma ferramenta pelo nome
   */
  get(name) {
    return this.tools.get(name);
  }

  /**
   * Executa uma ferramenta com validação e captura de erros
   */
  async execute(name, args) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Ferramenta '${name}' não encontrada no registro global.`);
    }
    try {
      return await tool.execute(args || {});
    } catch (err) {
      return {
        isError: true,
        error: err.message || String(err)
      };
    }
  }

  /**
   * Retorna as definições de ferramentas formatadas no padrão JSON Schema universal
   * compatível com OpenAI, Anthropic, Gemini e DeepSeek.
   */
  getDefinitions() {
    const defs = [];
    for (const tool of this.tools.values()) {
      defs.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      });
    }
    return defs;
  }

  /**
   * Lista resumo das ferramentas carregadas
   */
  listSummary() {
    const list = [];
    for (const [name, tool] of this.tools.entries()) {
      list.push({
        name,
        source: tool.source,
        description: tool.description.slice(0, 80) + (tool.description.length > 80 ? '...' : '')
      });
    }
    return list;
  }
}

// Instância singleton global do registro
export const globalToolRegistry = new ToolRegistry();
