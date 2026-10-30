/**
 * Adaptador Universal de Modelos (LLM Provider Interface)
 * Suporta chamadas diretas via Fetch nativo para Anthropic, OpenAI, Gemini, DeepSeek e Ollama.
 * Inclui modo de simulação inteligente para testes imediatos no terminal sem chaves.
 */
export class UniversalModelProvider {
  /**
   * @param {Object} modelsConfig
   * @param {Object} [options]
   * @param {boolean} [options.simulationMode=false]
   */
  constructor(modelsConfig, { simulationMode = false } = {}) {
    this.config = modelsConfig;
    this.simulationMode = Boolean(simulationMode || process.env.SIMULATION_MODE === 'true');
  }

  /**
   * Verifica se há chave de API ou endpoint configurado para o provedor
   */
  hasConfiguredKey(providerKey, providerMeta) {
    if (providerMeta?.isLocal) return true;
    const envKey = providerMeta?.envKey;
    const val = envKey ? process.env[envKey] : null;
    return Boolean(val && val.length > 5 && !val.includes('your_'));
  }

  /**
   * Chamada unificada para qualquer modelo e provedor
   * @param {Object} params
   * @param {string} params.modelId - ID do modelo (ex: 'claude-3-7-sonnet-20250219', 'gpt-4o', 'gemini-2.0-flash', etc.)
   * @param {Array} params.messages - Array de mensagens [{ role: 'system'|'user'|'assistant'|'tool', content, tool_call_id, name }]
   * @param {Array} [params.tools] - Lista de ferramentas do registro global
   * @param {number} [params.temperature=0.2]
   */
  async call({ modelId, messages, tools = [], temperature = 0.2 }) {
    const { providerKey, modelMeta, providerMeta } = this.resolveModel(modelId);
    const hasKey = this.hasConfiguredKey(providerKey, providerMeta);

    // Validação estrita de credenciais: simulação apenas se explicitamente solicitada
    if (!hasKey) {
      if (this.simulationMode) {
        return this.simulateAgentCall({ modelId, modelMeta, messages, tools });
      }
      const envKey = providerMeta?.envKey || 'API_KEY';
      throw new Error(
        `[OmniCode Security] Modelo '${modelId}' (${providerKey}) requer a credencial '${envKey}', que não está configurada.\n` +
        `   • Para conectar: digite '/connect ${providerKey} <chave>' no terminal ou adicione '${envKey}' ao seu .env.\n` +
        `   • Para modo de demonstração/teste imediato sem chaves: execute com a flag '--demo' ou digite '/simulate' no terminal.`
      );
    }

    if (this.simulationMode) {
      return this.simulateAgentCall({ modelId, modelMeta, messages, tools });
    }

    if (providerKey === 'anthropic') {
      return await this.callAnthropic({ modelMeta, providerMeta, messages, tools, temperature });
    } else if (providerKey === 'google') {
      return await this.callGemini({ modelMeta, providerMeta, messages, tools, temperature });
    } else {
      // OpenAI, DeepSeek, Groq e Ollama seguem o padrão OpenAI Chat Completions API
      return await this.callOpenAICompatible({ modelMeta, providerMeta, messages, tools, temperature });
    }
  }

  resolveModel(modelId) {
    // 1. Procura nos provedores padrão
    for (const [pKey, pVal] of Object.entries(this.config.providers || {})) {
      const found = (pVal.models || []).find((m) => m.id === modelId);
      if (found) {
        return { providerKey: pKey, modelMeta: found, providerMeta: pVal };
      }
    }

    // 2. Procura nos custom_models
    const custom = (this.config.custom_models || []).find((m) => m.id === modelId);
    if (custom) {
      return {
        providerKey: custom.protocol || 'openai-compatible',
        modelMeta: custom,
        providerMeta: {
          baseUrl: custom.baseUrl,
          envKey: custom.envKey,
          isLocal: custom.isLocal
        }
      };
    }

    // Fallback: se não achar, assume compatível com OpenAI (ex: Ollama ou endpoint custom)
    return {
      providerKey: 'openai-compatible',
      modelMeta: { id: modelId, name: modelId },
      providerMeta: {
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        envKey: 'OPENAI_API_KEY'
      }
    };
  }

  /**
   * Simulação realista de raciocínio de agentes e execução de ferramentas
   * Permite testar o fluxo multi-agente instantaneamente mesmo sem chaves de API.
   */
  async simulateAgentCall({ modelId, modelMeta, messages, tools }) {
    const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
    const userMsg = messages.find((m) => m.role === 'user')?.content || '';
    const hasToolResult = messages.some((m) => m.role === 'tool');

    const agentIdMatch = systemMsg.match(/\[AGENT_ID:\s*([^\]]+)\]/);
    const agentId = agentIdMatch ? agentIdMatch[1].trim() : '';

    const isSupervisor = agentId === 'supervisor' || systemMsg.includes('Maestro Supervisor');
    const isCoder = agentId === 'coder' || systemMsg.includes('Senior Software Engineer');
    const isReviewer = agentId === 'reviewer' || systemMsg.includes('QA & Security Auditor');
    const isResearcher = agentId === 'researcher' || systemMsg.includes('Web & Tech Researcher');
    const isTerminal = agentId === 'terminal_operator' || systemMsg.includes('DevOps & CLI Runner');

    // Pequena pausa para sensação de raciocínio natural em tempo real
    await new Promise((r) => setTimeout(r, 600));

    // Se a ferramenta já foi executada, conclui a resposta
    if (hasToolResult) {
      if (isCoder) {
        return {
          text: `Implementação técnica finalizada com sucesso via [${modelId}]. Código modular estruturado e salvo no workspace.`,
          toolCalls: []
        };
      }
      if (isReviewer) {
        return {
          text: `Auditoria de código e segurança aprovada via [${modelId}]. Estrutura em total conformidade com as boas práticas. 0 vulnerabilidades.`,
          toolCalls: []
        };
      }
      if (isTerminal) {
        return {
          text: `Verificação de terminal e testes executados via [${modelId}]. Execução concluída com código 0 (sucesso).`,
          toolCalls: []
        };
      }
      if (isResearcher) {
        return {
          text: `Síntese de pesquisa e padrões técnicos consolidados via [${modelId}]. Diretrizes repassadas para o Coder.`,
          toolCalls: []
        };
      }
      return {
        text: `Subtarefa finalizada com sucesso utilizando o modelo [${modelId}].`,
        toolCalls: []
      };
    }

    // Primeiro passo do agente:
    // 1. Supervisor / Maestro
    if (isSupervisor) {
      const plan = {
        plan: [
          { title: `Pesquisar arquitetura e diretrizes para a solução`, agent: 'researcher' },
          { title: `Implementar código-fonte com tratamento de erros no workspace`, agent: 'coder' },
          { title: `Auditar código, validar segurança e realizar testes de qualidade`, agent: 'reviewer' },
          { title: `Executar verificações operacionais no ambiente de terminal`, agent: 'terminal_operator' }
        ]
      };
      return {
        text: JSON.stringify(plan, null, 2),
        toolCalls: [
          {
            id: `call_${Date.now()}_todos`,
            name: 'todowrite',
            args: {
              todos: [
                { content: 'Pesquisar arquitetura e diretrizes para a solução', status: 'in_progress' },
                { content: 'Implementar código-fonte com tratamento de erros no workspace', status: 'pending' },
                { content: 'Auditar código, validar segurança e realizar testes de qualidade', status: 'pending' },
                { content: 'Executar verificações operacionais no ambiente de terminal', status: 'pending' }
              ]
            }
          }
        ]
      };
    }

    // 2. Programador / Coder
    if (isCoder) {
      const combinedText = (userMsg + ' ' + systemMsg).toLowerCase();
      const isPython = combinedText.includes('python') || combinedText.includes('.py') || combinedText.includes('fibonacci');
      const isHtml = combinedText.includes('html') || combinedText.includes('web') || combinedText.includes('site') || combinedText.includes('landing');
      
      let fileName = 'index.js';
      let codeContent = `// Código gerado pelo Agente Coder via ${modelId}\nconsole.log("Omni-Orchestrator: Execução bem-sucedida!");\n`;

      if (isPython) {
        fileName = 'fibonacci.py';
        codeContent = `"""\nScript de Fibonacci gerado pelo Agente Coder via ${modelId}\n"""\n\ndef fibonacci(n):\n    """Retorna os primeiros n termos da sequência de Fibonacci."""\n    if n <= 0:\n        return []\n    if n == 1:\n        return [0]\n    seq = [0, 1]\n    while len(seq) < n:\n        seq.append(seq[-1] + seq[-2])\n    return seq\n\nif __name__ == '__main__':\n    termos = 10\n    resultado = fibonacci(termos)\n    print(f"Primeiros {termos} números de Fibonacci: {resultado}")\n`;
      } else if (isHtml) {
        fileName = 'index.html';
        codeContent = `<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n  <meta charset="UTF-8">\n  <title>Omni Orchestrator App</title>\n  <style>body { font-family: sans-serif; background: #0f172a; color: #fff; padding: 2rem; }</style>\n</head>\n<body>\n  <h1>Omni-Orchestrator Multi-Agent</h1>\n  <p>Aplicativo gerado com sucesso pela equipe de agentes autônomos.</p>\n</body>\n</html>\n`;
      } else {
        fileName = 'app.js';
        codeContent = `/**\n * Módulo gerado pelo Omni-Orchestrator via ${modelId}\n */\nexport function run() {\n  return { status: "success", timestamp: new Date().toISOString() };\n}\n\nconsole.log("Módulo carregado:", run());\n`;
      }

      return {
        text: `Iniciando a criação do arquivo '${fileName}' no workspace...`,
        toolCalls: [
          {
            id: `call_${Date.now()}_coder`,
            name: 'write_file',
            args: {
              filePath: fileName,
              content: codeContent
            }
          }
        ]
      };
    }

    // 3. Revisor / Reviewer
    if (isReviewer) {
      return {
        text: `Inspecionando os arquivos gerados no workspace para auditar código e segurança...`,
        toolCalls: [
          {
            id: `call_${Date.now()}_rev`,
            name: 'list_dir',
            args: { dirPath: '.' }
          }
        ]
      };
    }

    // 4. Operador de Terminal / DevOps
    if (isTerminal) {
      return {
        text: `Executando checagem de integridade e comandos no ambiente...`,
        toolCalls: [
          {
            id: `call_${Date.now()}_devops`,
            name: 'run_terminal_command',
            args: { command: 'node -v' }
          }
        ]
      };
    }

    // 5. Pesquisador / Researcher
    if (isResearcher) {
      return {
        text: `Consultando diretrizes e padrões de engenharia para o projeto...`,
        toolCalls: [
          {
            id: `call_${Date.now()}_res`,
            name: 'consult_skill',
            args: { skillName: 'coding_standards' }
          }
        ]
      };
    }

    // Fallback genérico
    return {
      text: `Tarefa em processamento pelo modelo [${modelId}]. Todos os requisitos foram analisados e validados.`,
      toolCalls: []
    };
  }

  // --- ANTHROPIC CLAUDE ---
  async callAnthropic({ modelMeta, providerMeta, messages, tools, temperature }) {
    const apiKey = process.env[providerMeta.envKey] || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(`Chave ${providerMeta.envKey} não encontrada nas variáveis de ambiente.`);
    }

    let systemPrompt = '';
    const anthropicMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n\n' : '') + msg.content;
      } else if (msg.role === 'tool') {
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            }
          ]
        });
      } else if (msg.role === 'assistant') {
        const content = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.args
            });
          }
        }
        anthropicMessages.push({ role: 'assistant', content });
      } else {
        anthropicMessages.push({ role: 'user', content: msg.content });
      }
    }

    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));

    const body = {
      model: modelMeta.id,
      max_tokens: 4096,
      temperature,
      system: systemPrompt || undefined,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined
    };

    const res = await fetch(`${providerMeta.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API Erro (${res.status}): ${err}`);
    }

    const data = await res.json();
    let text = '';
    const toolCalls = [];

    for (const block of data.content || []) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          args: block.input
        });
      }
    }

    return { text, toolCalls, raw: data };
  }

  // --- GOOGLE GEMINI ---
  async callGemini({ modelMeta, providerMeta, messages, tools, temperature }) {
    const apiKey = process.env[providerMeta.envKey] || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(`Chave ${providerMeta.envKey} não encontrada nas variáveis de ambiente.`);
    }

    let systemInstruction = null;
    const contents = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        const parts = [];
        if (msg.content) parts.push({ text: msg.content });
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: { name: tc.name, args: tc.args }
            });
          }
        }
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        contents.push({
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: msg.name || 'tool',
                response: typeof msg.content === 'object' ? msg.content : { result: msg.content }
              }
            }
          ]
        });
      }
    }

    let functionDeclarations = undefined;
    if (tools && tools.length > 0) {
      functionDeclarations = tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }));
    }

    const body = {
      contents,
      systemInstruction,
      generationConfig: { temperature, maxOutputTokens: 4096 },
      tools: functionDeclarations ? [{ functionDeclarations }] : undefined
    };

    const endpoint = `${providerMeta.baseUrl}/models/${modelMeta.id}:generateContent?key=${apiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API Erro (${res.status}): ${err}`);
    }

    const data = await res.json();
    let text = '';
    const toolCalls = [];

    const candidate = data.candidates?.[0];
    for (const part of candidate?.content?.parts || []) {
      if (part.text) text += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: part.functionCall.name,
          args: part.functionCall.args || {}
        });
      }
    }

    return { text, toolCalls, raw: data };
  }

  // --- OPENAI, DEEPSEEK, GROQ, OLLAMA ---
  async callOpenAICompatible({ modelMeta, providerMeta, messages, tools, temperature }) {
    const apiKey = process.env[providerMeta.envKey] || (providerMeta.isLocal ? 'ollama' : '');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const openAiTools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    const openAiMessages = messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.tool_call_id,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        };
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: m.content || '',
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) }
          }))
        };
      }
      return { role: m.role, content: m.content };
    });

    const body = {
      model: modelMeta.id,
      messages: openAiMessages,
      temperature,
      tools: openAiTools.length > 0 ? openAiTools : undefined
    };

    const res = await fetch(`${providerMeta.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI Compatible API Erro (${res.status}): ${err}`);
    }

    const data = await res.json();
    const message = data.choices?.[0]?.message || {};
    const text = message.content || '';
    const toolCalls = [];

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments);
        } catch {
          parsedArgs = { raw: tc.function.arguments };
        }
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: parsedArgs
        });
      }
    }

    return { text, toolCalls, raw: data };
  }
}
