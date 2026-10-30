/**
 * Formatador e UI para o Terminal CLI (100% Standalone)
 * Cores ANSI nativas sem dependências pesadas
 * Inclui os padrões de Agent Modes (build/plan), TODOs, /connect, /diff, /undo e /compact do OpenCode
 */
export const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  // Cores
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  // Bright
  brightGreen: '\x1b[92m',
  brightCyan: '\x1b[96m',
  brightYellow: '\x1b[93m',
  brightMagenta: '\x1b[95m',
  brightBlue: '\x1b[94m',
  gray: '\x1b[90m'
};

export class TerminalUI {
  static banner() {
    console.log(`
${C.bold}${C.brightCyan}╔═══════════════════════════════════════════════════════════════════════════╗
║                   🌌  OMNICODE CLI v1.0 (OPENCODE FORK)                   ║
║       Autonomous Multi-Agent & Multi-Model Orchestration Layer            ║
╚═══════════════════════════════════════════════════════════════════════════╝${C.reset}
${C.gray}⚡ Multi-Modelos:  Claude 3.7 · GPT-4o · Gemini 2.0 Flash · DeepSeek · Ollama
🛠  OpenCode Suite:  /init · /review · /diff · /undo · /compact · /connect · /todos
⌨️  Teclas Rápidas: [Tab] Modo Build/Plan | [Ctrl+T] TODOs | [Ctrl+R] Review | [Ctrl+A] Agentes${C.reset}
`);
  }

  static success(msg) {
    console.log(`${C.green}✔ ${msg}${C.reset}`);
  }

  static info(msg) {
    console.log(`${C.cyan}ℹ ${msg}${C.reset}`);
  }

  static warn(msg) {
    console.log(`${C.yellow}⚠ ${msg}${C.reset}`);
  }

  static error(msg) {
    console.log(`${C.red}✖ ${msg}${C.reset}`);
  }

  static showNoModelsPrompt() {
    console.log(`
${C.bold}${C.brightYellow}┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚠️  NENHUM MODELO DE IA CONECTADO                                           │
│                                                                             │
│ Para os agentes criarem, editarem e pesquisarem código com inteligência     │
│ real, recomendamos conectar pelo menos 1 provedor de IA (API key ou Ollama). │
│                                                                             │
│ • Google Gemini (2.0 Flash - Grátis)    • OpenAI (GPT-4o, o3-mini)          │
│ • Anthropic Claude (3.7 / 3.5 Sonnet)   • DeepSeek (Coder / R1)             │
│ • Groq (Llama 3.3 Ultra Rápido)         • Ollama (Modelos 100% Locais)      │
└─────────────────────────────────────────────────────────────────────────────┘${C.reset}`);
  }

  static section(title) {
    console.log(`\n${C.bold}${C.brightMagenta}=== [ ${title.toUpperCase()} ] ===${C.reset}`);
  }

  static showHelp() {
    this.section('Comandos Prontos do OpenCode & Teclas de Atalho');
    console.log(`
  ${C.bold}${C.brightYellow}⌨️  TECLAS DE ATALHO DO TERMINAL (ACESSO INSTANTÂNEO):${C.reset}
  ${C.bold}[Tab]${C.reset}       Alterna entre os 4 modos (APPROVE -> PLAN -> SMART -> AUTO) ou Autocompleta comandos
  ${C.bold}[Ctrl+T]${C.reset}    Exibe a lista de tarefas e progresso da sessão ativa
  ${C.bold}[Ctrl+R]${C.reset}    Executa imediatamente a revisão e auditoria de código (/review)
  ${C.bold}[Ctrl+P]${C.reset}    Ativa o modo seguro PLAN (somente leitura / exploração)
  ${C.bold}[Ctrl+B]${C.reset}    Ativa o modo AUTO / BUILD (execução com autonomia no workspace)
  ${C.bold}[Ctrl+A]${C.reset}    Lista a equipe de agentes e seus modelos
  ${C.bold}[Ctrl+M]${C.reset}    Lista o catálogo de modelos de IA
  ${C.bold}[Ctrl+L]${C.reset}    Limpa a tela do terminal
  ${C.bold}[Ctrl+H]${C.reset}    Exibe este menu de ajuda
  ${C.bold}[Ctrl+C]${C.reset}    Cancela a operação atual ou encerra

  ${C.bold}${C.brightCyan}🛡️  4 MODOS DE SEGURANÇA & AUTONOMIA (OMNICODE SPEC):${C.reset}
  ${C.bold}/approve${C.reset}                       ${C.brightMagenta}[Padrão de Fábrica]${C.reset} Pede autorização antes de gravar arquivos ou rodar comandos
  ${C.bold}/plan${C.reset}                          ${C.yellow}[Somente Leitura]${C.reset} Análise e exploração segura (mutações de arquivos e shell bloqueados)
  ${C.bold}/smart${C.reset}                         ${C.brightBlue}[Aprovação Inteligente]${C.reset} Auto-aprova ações seguras; pede autorização para alto risco
  ${C.bold}/auto${C.reset}                          ${C.green}[Autonomia Total]${C.reset} Executa tarefas sem confirmação rotineira dentro do workspace
  ${C.bold}/run <missao>${C.reset}                  Executa uma missão multi-agente completa
  ${C.dim}(ou digite qualquer objetivo diretamente no prompt omni> sem barra)${C.reset}

  ${C.bold}${C.brightGreen}🛠️ FLUXO DE CÓDIGO & CONTROLE DE VERSÃO (OPENCODE STYLE):${C.reset}
  ${C.bold}/init${C.reset}                          Inspeciona o repositório e gera o arquivo AGENTS.md
  ${C.bold}/review [alvo]${C.reset}                 Executa auditoria profunda de código e segurança
  ${C.bold}/diff${C.reset}                          Exibe as diferenças (diffs) de arquivos modificados
  ${C.bold}/undo${C.reset}                          Desfaz a última alteração de arquivo feita pelos agentes
  ${C.bold}/todos${C.reset}                         Exibe a lista de tarefas/plano da sessão ativa

  ${C.bold}${C.brightMagenta}🤖 GESTÃO DE AGENTES & MODELOS MULTI-PROVEDOR:${C.reset}
  ${C.bold}/connect <prov> <chave>${C.reset}        Conecta chave de API interativamente (gemini, openai, anthropic, etc.)
  ${C.bold}/agents${C.reset}                        Lista todos os agentes e seus modelos atribuídos
  ${C.bold}/agent create <id> <nome> <papel>${C.reset} Cria um novo agente especialista na equipe
  ${C.bold}/agent model <id> <modelo>${C.reset}         Altera o modelo de um agente
  ${C.bold}/agent remove <id>${C.reset}                Remove um agente customizado
  ${C.bold}/models${C.reset}                        Lista todos os modelos suportados e status de conexão
  ${C.bold}/model add <id> <nome> [url]${C.reset}      Cadastra um endpoint ou modelo customizado

  ${C.bold}${C.brightBlue}📦 SESSÃO, FERRAMENTAS & AMBIENTE:${C.reset}
  ${C.bold}/compact${C.reset}                       Compacta o histórico da sessão para economizar contexto
  ${C.bold}/export [arquivo]${C.reset}              Exporta o relatório completo da sessão em Markdown
  ${C.bold}/tools${C.reset}                         Lista todas as 12 ferramentas ativas (Glob, Edit, Patch, Shell, etc.)
  ${C.bold}/skills${C.reset}                        Lista as skills de engenharia carregadas
  ${C.bold}/workspace${C.reset}                     Lista os arquivos gerados no diretório ./workspace
  ${C.bold}/env${C.reset}                           Exibe status das chaves de API configuradas
  ${C.bold}/simulate${C.reset}                      Ativa/Desativa o modo de demonstração/simulação
  ${C.bold}/clear${C.reset}                         Limpa a tela do terminal
  ${C.bold}/exit${C.reset}                          Encerra o OmniCode
`);
  }

  static showAgents(agents, router) {
    this.section('Equipe de Agentes Cadastrados');
    agents.forEach((ag, idx) => {
      const selectedModel = router ? router.selectModelForAgent(ag) : ag.model;
      const modelTag = ag.model === 'auto'
        ? `${C.brightGreen}auto${C.reset} ${C.gray}(Router escolheu: ${selectedModel})${C.reset}`
        : `${C.brightYellow}${ag.model}${C.reset} ${C.gray}(fixo)${C.reset}`;

      console.log(`  ${idx + 1}. ${C.bold}${C.brightCyan}[${ag.id}]${C.reset} ${C.bold}${ag.name}${C.reset} — ${C.italic}${ag.role}${C.reset}`);
      console.log(`     Modelo: ${modelTag}`);
      console.log(`     Papel: ${C.dim}${ag.description}${C.reset}`);
      console.log('');
    });
  }

  static showModels(models) {
    this.section('Catálogo de Modelos de IA');
    const grouped = {};
    for (const m of models) {
      if (!grouped[m.provider]) grouped[m.provider] = [];
      grouped[m.provider].push(m);
    }

    for (const [provider, list] of Object.entries(grouped)) {
      console.log(`  ${C.bold}${C.brightMagenta}Provedor: ${provider.toUpperCase()}${C.reset}`);
      for (const m of list) {
        const status = m.isConfigured
          ? `${C.brightGreen}[✔ Configurado / Chave OK]${C.reset}`
          : `${C.gray}[○ Sem chave API no .env]${C.reset}`;
        const strengths = (m.strengths || []).join(', ');
        console.log(`    • ${C.bold}${m.id}${C.reset} (${m.name}) ${status}`);
        console.log(`      Contexto: ${(m.contextWindow || 0).toLocaleString()} tokens | Especialidades: ${C.dim}${strengths}${C.reset}`);
      }
      console.log('');
    }
  }

  static showTools(tools) {
    this.section('Hub Global de Ferramentas Ativas (Inspirado no OpenCode)');
    tools.forEach((t, i) => {
      console.log(`  ${i + 1}. ${C.bold}${C.brightGreen}${t.name}${C.reset} [Origem: ${C.dim}${t.source}${C.reset}]`);
      console.log(`     ${C.gray}${t.description}${C.reset}`);
    });
    console.log('');
  }

  static showSkills(skills) {
    this.section('Skills Técnicas Disponíveis');
    if (!skills || skills.length === 0) {
      console.log(`  ${C.gray}Nenhuma skill encontrada em ./skills${C.reset}\n`);
      return;
    }
    skills.forEach((s, i) => {
      console.log(`  ${i + 1}. ${C.bold}${C.cyan}${s}${C.reset}`);
    });
    console.log('');
  }

  static showTodos(todos) {
    this.section('Plano de Trabalho e TODOs da Sessão');
    if (!todos || todos.length === 0) {
      console.log(`  ${C.gray}(Nenhum TODO registrado no momento. Os agentes criam TODOs ao iniciar a missão)${C.reset}\n`);
      return;
    }
    todos.forEach((t, i) => {
      let mark = `${C.gray}[ ]${C.reset}`;
      if (t.status === 'completed') mark = `${C.brightGreen}[✔]${C.reset}`;
      else if (t.status === 'in_progress') mark = `${C.brightYellow}[⏳]${C.reset}`;
      else if (t.status === 'cancelled') mark = `${C.red}[✖]${C.reset}`;
      console.log(`  ${mark} ${i + 1}. ${t.content}`);
    });
    console.log('');
  }

  static showEnvStatus() {
    this.section('Status de Chaves de API e Variáveis de Ambiente');
    const check = (key, label) => {
      const val = process.env[key];
      const isSet = Boolean(val && val.length > 5 && !val.includes('your_'));
      // Segurança: Nunca exibe prefixo, sufixo ou trecho da credencial
      const status = isSet ? `${C.brightGreen}✔ Configurada${C.reset}` : `${C.gray}✖ Não configurada${C.reset}`;
      console.log(`  • ${key.padEnd(22)}: ${status} ${C.dim}[${label}]${C.reset}`);
    };

    check('ANTHROPIC_API_KEY', 'Anthropic Claude');
    check('OPENAI_API_KEY', 'OpenAI GPT-4o / o3-mini');
    check('GEMINI_API_KEY', 'Google Gemini 2.0 / 1.5');
    check('DEEPSEEK_API_KEY', 'DeepSeek Coder / R1');
    check('GROQ_API_KEY', 'Groq (Ultra Rápido)');
    console.log(`  • OLLAMA_BASE_URL       : ${process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1'} ${C.dim}[Modelos Locais]${C.reset}`);
    console.log(`  • WORKSPACE_DIR         : ${process.env.WORKSPACE_DIR || './workspace'} ${C.dim}[Diretório de Trabalho dos Agentes]${C.reset}`);
    console.log('');
  }

  /**
   * Formata evento de agente em tempo real no terminal
   */
  static renderAgentEvent(event) {
    switch (event.type) {
      case 'mission_start':
        console.log(`\n${C.bold}${C.brightCyan}🎯 [MISSÃO INICIADA]:${C.reset} ${C.bold}${event.goal}${C.reset}\n`);
        break;

      case 'mission_plan_ready':
        console.log(`${C.bold}${C.yellow}📋 [PLANO DE EXECUÇÃO GERADO PELO SUPERVISOR]:${C.reset}`);
        event.subtasks.forEach((st, i) => {
          console.log(`   ${i + 1}. [${C.brightMagenta}${st.assignedAgent}${C.reset}] ${st.title}`);
        });
        console.log('');
        break;

      case 'todos_updated':
        console.log(`\n${C.bold}${C.brightYellow}📋 [TODOs ATUALIZADOS - ${event.summary}]:${C.reset}`);
        (event.todos || []).forEach((t, i) => {
          let mark = `${C.gray}[ ]${C.reset}`;
          if (t.status === 'completed') mark = `${C.brightGreen}[✔]${C.reset}`;
          else if (t.status === 'in_progress') mark = `${C.brightYellow}[⏳]${C.reset}`;
          else if (t.status === 'cancelled') mark = `${C.red}[✖]${C.reset}`;
          console.log(`   ${mark} ${i + 1}. ${t.content}`);
        });
        console.log('');
        break;

      case 'orchestrator_delegation':
        console.log(
          `${C.bold}${C.brightBlue}⚡ [DELEGAÇÃO]:${C.reset} ${C.bold}${event.agentName}${C.reset} assumiu a tarefa\n   ↳ Modelo Selecionado: ${C.brightGreen}${event.modelId}${C.reset} | Tarefa: ${C.italic}${event.taskTitle}${C.reset}`
        );
        break;

      case 'agent_thinking':
        console.log(`${C.gray}   🤔 [${event.agentId}] Raciocinando (passo ${event.step} via ${event.modelId})...${C.reset}`);
        break;

      case 'agent_tool_call':
        console.log(
          `   ${C.brightYellow}🛠 [Ferramenta]:${C.reset} ${C.bold}${event.toolName}${C.reset} ${C.dim}(${JSON.stringify(event.args).slice(0, 90)}...)${C.reset}`
        );
        break;

      case 'agent_tool_result':
        const resStr = typeof event.result === 'object' ? JSON.stringify(event.result) : String(event.result);
        console.log(`   ${C.gray}↳ Resultado: ${resStr.slice(0, 110)}${resStr.length > 110 ? '...' : ''}${C.reset}`);
        break;

      case 'agent_message':
        console.log(`\n${C.brightCyan}[${event.agentId}]:${C.reset}\n${event.text}\n`);
        break;

      case 'subtask_completed':
        console.log(`${C.brightGreen}✔ [TAREFA CONCLUÍDA]:${C.reset} ${event.subtask.title}\n`);
        break;

      case 'subtask_failed':
        console.log(`${C.red}✖ [TAREFA FALHOU]:${C.reset} ${event.subtask.title} - ${event.error}\n`);
        break;

      case 'mission_complete':
        console.log(`\n${C.bold}${C.brightGreen}═══════════════════════════════════════════════════════════════════╗${C.reset}`);
        console.log(`${C.bold}${C.brightGreen}  🎉 MISSÃO CONCLUÍDA COM SUCESSO PELA EQUIPE MULTI-AGENTE          ║${C.reset}`);
        console.log(`${C.bold}${C.brightGreen}═══════════════════════════════════════════════════════════════════╝${C.reset}\n`);
        break;

      default:
        break;
    }
  }
}
