#!/usr/bin/env node

/**
 * Omni-Orchestrator CLI (100% Standalone)
 * Orquestrador Multi-Agente & Multi-Modelo Autônomo com a Suíte Completa de Comandos do OpenCode:
 * /init, /review, /diff, /undo, /compact, /connect, /todos, /build, /plan, /agents, /models, /export
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { exec } from 'node:child_process';

import { TerminalUI, C } from './cli/terminal_ui.js';
import { MaestroOrchestrator } from './core/orchestrator.js';
import { ModelRouter } from './core/router.js';
import { UniversalModelProvider } from './models/provider.js';
import { globalToolRegistry } from './hub/registry.js';
import { registerFileTools, undoLastFileChange, fileBackupStack } from './hub/file_tools.js';
import { registerShellTools } from './hub/shell_tools.js';
import { registerWebTools } from './hub/web_tools.js';
import { SkillLoader } from './hub/skill_loader.js';
import { McpClientManager } from './hub/mcp_client.js';
import { CodeReviewer } from './core/reviewer.js';
import { inspectAndInitRepository } from './core/init_helper.js';
import { ConfigManager } from './core/config_manager.js';
import { OpenCodeTUI } from './cli/interactive_tui.js';

// Carrega variáveis do .env nativamente no Node.js caso o arquivo exista
try {
  process.loadEnvFile('.env');
} catch {
  // .env não encontrado ou não criado ainda
}

async function loadJsonSafe(filePath, defaultVal = {}) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return defaultVal;
  }
}

/**
 * Salva ou atualiza uma chave de API no arquivo .env
 */
async function saveEnvKey(envKeyName, keyValue) {
  const envPath = path.join(process.cwd(), '.env');
  let currentContent = '';
  try {
    currentContent = await fs.readFile(envPath, 'utf-8');
  } catch {
    try {
      currentContent = await fs.readFile(path.join(process.cwd(), '.env.example'), 'utf-8');
    } catch {
      currentContent = '';
    }
  }

  const regex = new RegExp(`^${envKeyName}=.*`, 'm');
  let updatedContent = '';
  if (regex.test(currentContent)) {
    updatedContent = currentContent.replace(regex, `${envKeyName}=${keyValue}`);
  } else {
    updatedContent = currentContent ? `${currentContent}\n${envKeyName}=${keyValue}` : `${envKeyName}=${keyValue}`;
  }

  await fs.writeFile(envPath, updatedContent, 'utf-8');
  process.env[envKeyName] = keyValue;
}

/**
 * Exibe diff de arquivos estilo OpenCode
 */
async function showDiff(workspaceDir) {
  return new Promise((resolve) => {
    exec('git diff --color', { cwd: process.cwd() }, (err, stdout) => {
      if (!err && stdout && stdout.trim()) {
        console.log(`\n${C.bold}${C.brightMagenta}=== [ GIT DIFF ] ===${C.reset}\n`);
        console.log(stdout);
        resolve(true);
      } else {
        if (fileBackupStack.length > 0) {
          console.log(`\n${C.bold}${C.brightMagenta}=== [ ARQUIVOS MODIFICADOS NA SESSÃO ] ===${C.reset}\n`);
          fileBackupStack.forEach((b, i) => {
            console.log(`  ${i + 1}. 📄 ${C.bold}${b.filePath}${C.reset} (${b.content === null ? 'Novo arquivo criado' : 'Arquivo modificado'})`);
          });
          console.log('');
        } else {
          console.log(`\n${C.gray}Nenhuma alteração pendente detectada no repositório ou workspace.${C.reset}\n`);
        }
        resolve(false);
      }
    });
  });
}

/**
 * Assistente Interativo de Conexão de Modelos de IA (/connect)
 */
async function runInteractiveConnect(rl, router) {
  let connecting = true;

  while (connecting) {
    TerminalUI.section('Assistente de Conexão de Modelos de IA (OmniCode)');
    console.log(`  Escolha o provedor de IA que deseja conectar:\n`);
    console.log(`  ${C.bold}[1] Google Gemini${C.reset}    ${C.green}★ Grátis / Recomendado (Gemini 2.0 Flash - 1M Contexto)${C.reset}`);
    console.log(`  ${C.bold}[2] OpenAI${C.reset}           ${C.gray}GPT-4o, GPT-4o-mini, o3-mini${C.reset}`);
    console.log(`  ${C.bold}[3] Anthropic Claude${C.reset} ${C.gray}Claude 3.7 Sonnet, Claude 3.5 Sonnet & Haiku${C.reset}`);
    console.log(`  ${C.bold}[4] DeepSeek${C.reset}         ${C.gray}DeepSeek Chat & DeepSeek Reasoner (R1)${C.reset}`);
    console.log(`  ${C.bold}[5] Groq${C.reset}             ${C.gray}Llama 3.3 70B & Mixtral (Incrível velocidade)${C.reset}`);
    console.log(`  ${C.bold}[6] Ollama (Local)${C.reset}   ${C.gray}Modelos 100% locais no seu PC (deepseek-coder, llama3)${C.reset}`);
    console.log(`  ${C.bold}[0] Voltar ao Terminal${C.reset}\n`);

    const choice = (await rl.question(`  ${C.bold}Digite sua opção [1-6 ou 0]: ${C.reset}`)).trim();

    if (choice === '0' || choice === '') {
      break;
    }

    let providerKey = '';
    let providerName = '';
    let envVar = '';
    let helpUrl = '';
    let isLocal = false;

    switch (choice) {
      case '1':
        providerKey = 'gemini';
        providerName = 'Google Gemini';
        envVar = 'GEMINI_API_KEY';
        helpUrl = 'https://aistudio.google.com/app/apikey (100% gratuito)';
        break;
      case '2':
        providerKey = 'openai';
        providerName = 'OpenAI';
        envVar = 'OPENAI_API_KEY';
        helpUrl = 'https://platform.openai.com/api-keys';
        break;
      case '3':
        providerKey = 'anthropic';
        providerName = 'Anthropic Claude';
        envVar = 'ANTHROPIC_API_KEY';
        helpUrl = 'https://console.anthropic.com/settings/keys';
        break;
      case '4':
        providerKey = 'deepseek';
        providerName = 'DeepSeek';
        envVar = 'DEEPSEEK_API_KEY';
        helpUrl = 'https://platform.deepseek.com/api_keys';
        break;
      case '5':
        providerKey = 'groq';
        providerName = 'Groq';
        envVar = 'GROQ_API_KEY';
        helpUrl = 'https://console.groq.com/keys';
        break;
      case '6':
        providerKey = 'ollama';
        providerName = 'Ollama (Modelos Locais)';
        envVar = 'OLLAMA_BASE_URL';
        helpUrl = 'Certifique-se de que o Ollama está rodando no seu terminal (ollama serve)';
        isLocal = true;
        break;
      default:
        TerminalUI.warn('Opção inválida. Escolha entre 1 e 6, ou 0 para voltar.');
        continue;
    }

    console.log(`\n  ${C.bold}${C.brightCyan}► Conectando ${providerName}:${C.reset}`);
    console.log(`  ${C.gray}Dica: ${helpUrl}${C.reset}`);

    let promptMsg = `  ${C.bold}Cole sua API Key (ou Enter para cancelar): ${C.reset}`;
    if (isLocal) {
      promptMsg = `  ${C.bold}URL da API do Ollama [padrão: http://127.0.0.1:11434/v1]: ${C.reset}`;
    }

    const inputVal = (await rl.question(promptMsg)).trim();

    if (!inputVal && !isLocal) {
      TerminalUI.warn('Nenhuma chave fornecida. Operação cancelada.');
    } else {
      const finalVal = isLocal ? (inputVal || 'http://127.0.0.1:11434/v1') : inputVal;
      if (isLocal) {
        process.env.ENABLE_OLLAMA = 'true';
        await saveEnvKey('ENABLE_OLLAMA', 'true');
      }

      await saveEnvKey(envVar, finalVal);
      TerminalUI.success(`${providerName} conectado com sucesso! Salvo no arquivo .env.`);
    }

    const more = await rl.question(`\n  ${C.bold}Deseja conectar outro provedor agora? [s/N]: ${C.reset}`);
    const cleanMore = more.trim().toLowerCase();
    if (cleanMore !== 's' && cleanMore !== 'sim' && cleanMore !== 'y' && cleanMore !== 'yes') {
      connecting = false;
    }
  }

  const configuredCount = router.getAllModels().filter((m) => m.isConfigured).length;
  console.log(`\n  ${C.green}✔ Status atualizado: ${configuredCount} modelo(s) de IA conectado(s) e ativo(s).${C.reset}\n`);
}

async function main() {
  const projectRoot = process.cwd();

  // 1. Carrega configuração nos 3 escopos (Global do Usuário + Projeto + Sessão)
  const configManager = new ConfigManager(projectRoot);
  const effectiveConfig = await configManager.loadEffectiveConfig();

  const {
    globalDir,
    projectDir,
    preferences,
    modelsConfig,
    agentsConfig,
    mcpConfig,
    globalSkillsDir,
    projectSkillsDir
  } = effectiveConfig;

  // Diretório sandbox de trabalho dos agentes
  const workspaceDir = process.env.WORKSPACE_DIR
    ? path.resolve(projectRoot, process.env.WORKSPACE_DIR)
    : path.join(projectRoot, 'workspace');
  await fs.mkdir(workspaceDir, { recursive: true });

  // Contexto de Sessão com os 4 modos de autonomia (plan, approve, smart, auto)
  const sessionContext = {
    mode: preferences.default_autonomy_mode || 'approve',
    todos: [],
    onEvent: TerminalUI.renderAgentEvent,
    requestApproval: async ({ mode, actionType, details }) => {
      if (!process.stdin.isTTY) return true;
      process.stdout.write(`\n${C.bold}${C.brightYellow}⚠️  [PEDIDO DE APROVAÇÃO (${mode.toUpperCase()})]:${C.reset}\n`);
      if (actionType === 'file_write') {
        process.stdout.write(`   Autorizar alteração/criação do arquivo '${details.filePath}'? [S/n]: `);
      } else if (actionType === 'file_delete') {
        process.stdout.write(`   Autorizar EXCLUSÃO do arquivo '${details.filePath}'? [s/N]: `);
      } else if (actionType === 'shell_exec') {
        process.stdout.write(`   Autorizar execução do comando shell '${details.command}'? [S/n]: `);
      } else {
        process.stdout.write(`   Autorizar ação '${actionType}'? [S/n]: `);
      }
      return new Promise((resolve) => {
        const onData = (data) => {
          process.stdin.removeListener('data', onData);
          const answer = data.toString().trim().toLowerCase();
          if (actionType === 'file_delete') {
            resolve(answer === 's' || answer === 'sim' || answer === 'y' || answer === 'yes');
          } else {
            resolve(answer === '' || answer === 's' || answer === 'sim' || answer === 'y' || answer === 'yes');
          }
        };
        process.stdin.once('data', onData);
      });
    }
  };

  // 2. Inicializa o Hub Universal de Ferramentas
  registerFileTools(globalToolRegistry, workspaceDir, sessionContext);
  registerShellTools(globalToolRegistry, workspaceDir, sessionContext);
  registerWebTools(globalToolRegistry);

  // Carrega skills tanto do projeto quanto do registro global
  const skillLoader = new SkillLoader(globalToolRegistry, [projectSkillsDir, globalSkillsDir]);
  await skillLoader.loadAll();

  // Inicializa servidores MCP da configuração mesclada
  const mcpManager = new McpClientManager(globalToolRegistry);
  const mcpTempPath = path.join(globalDir, 'effective_mcp.json');
  await fs.writeFile(mcpTempPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
  await mcpManager.initFromConfig(mcpTempPath);

  // 3. Inicializa Roteador, Provedor e Orquestrador
  const router = new ModelRouter(modelsConfig, path.join(globalDir, 'models.json'));
  const provider = new UniversalModelProvider(modelsConfig);
  const orchestrator = new MaestroOrchestrator({
    agentsConfig,
    configPath: path.join(globalDir, 'agents.json'),
    router,
    provider,
    toolsRegistry: globalToolRegistry,
    onEvent: (event) => {
      if (event.type === 'todos_updated') {
        sessionContext.todos = event.todos;
      }
      TerminalUI.renderAgentEvent(event);
    }
  });

  // Limpeza de processos filhos ao sair
  process.on('SIGINT', () => {
    mcpManager.destroy();
    process.exit(0);
  });

  // 4. Modo Execução Direta via Argumentos de Linha de Comando (CLI)
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const command = args[0].toLowerCase();

    if (command === '--help' || command === '-h') {
      TerminalUI.banner();
      TerminalUI.showHelp();
      process.exit(0);
    }

    if (command === '--agents') {
      TerminalUI.banner();
      TerminalUI.showAgents(orchestrator.getAgents(), router);
      process.exit(0);
    }

    if (command === '--models') {
      TerminalUI.banner();
      TerminalUI.showModels(router.getAllModels());
      process.exit(0);
    }

    if (command === '--tools') {
      TerminalUI.banner();
      TerminalUI.showTools(globalToolRegistry.listSummary());
      process.exit(0);
    }

    if (command === '--diff' || command === '/diff') {
      TerminalUI.banner();
      await showDiff(workspaceDir);
      process.exit(0);
    }

    if (command === '--undo' || command === '/undo') {
      TerminalUI.banner();
      try {
        const res = await undoLastFileChange();
        TerminalUI.success(`Desfeito com sucesso: ${res.filePath} (${res.action})`);
      } catch (err) {
        TerminalUI.warn(err.message);
      }
      process.exit(0);
    }

    if (command === '--init' || command === '/init') {
      TerminalUI.banner();
      TerminalUI.info('Executando inspeção detalhada do repositório para gerar/atualizar o AGENTS.md...');
      const result = await inspectAndInitRepository(projectRoot);
      console.log(`  • Ecossistema detectado: ${result.projectType}`);
      console.log(`  • Diretórios de código: ${result.mainDirs.join(', ') || 'Raiz'}`);
      TerminalUI.success(`Arquivo AGENTS.md gravado em: ${result.targetPath} (${result.alreadyExisted ? 'preservou instruções anteriores' : 'novo contexto inicial'})`);
      process.exit(0);
    }

    if (command === '--review' || command === '/review') {
      TerminalUI.banner();
      const targetArg = args.slice(1).join(' ');
      TerminalUI.info(`Executando auditoria real de código ${targetArg ? `para: ${targetArg}` : 'no workspace'}...`);
      const reviewer = new CodeReviewer({ workspaceDir, router, provider });
      const result = await reviewer.review(targetArg);
      console.log(`\n${result.report}`);
      TerminalUI.success(`Revisão de código concluída (${result.filesChecked} arquivo(s) auditado(s)).`);
      process.exit(0);
    }

    // Se passou um texto como objetivo direto:
    TerminalUI.banner();
    const isDemo = args.includes('--demo') || args.includes('--simulate') || process.env.SIMULATION_MODE === 'true';
    if (isDemo) {
      provider.simulationMode = true;
      TerminalUI.info('Modo de Demonstração / Simulação ativado explicitamente (--demo).');
    }

    const filteredArgs = args.filter((a) => a !== '--demo' && a !== '--simulate');
    if (filteredArgs.length === 0) {
      TerminalUI.showHelp();
      process.exit(0);
    }

    const configuredCount = router.getAllModels().filter((m) => m.isConfigured).length;
    if (configuredCount === 0 && !isDemo) {
      TerminalUI.warn(
        `Nenhum modelo de IA conectado (sem chaves no .env).\n  • Para chamadas reais: use o comando 'omnicode' interativo para conectar ou preencha o .env.\n  • Para testar imediatamente a orquestração em simulação: execute com a flag '--demo'.\n`
      );
    }

    const userGoal = filteredArgs.join(' ');
    await orchestrator.executeMission(userGoal);
    mcpManager.destroy();
    process.exit(0);
  }

  // 5. Modo Interativo no Terminal (REPL)
  TerminalUI.banner();
  TerminalUI.info(`Registro Global do Usuário : ${globalDir}`);
  TerminalUI.info(`Diretório de Trabalho Sandbox: ${workspaceDir}`);
  TerminalUI.info(`Modo Inicial de Autonomia    : [${sessionContext.mode.toUpperCase()}]`);

  const commandsList = [
    '/approve', '/plan', '/smart', '/auto', '/build', '/init', '/review', '/diff',
    '/undo', '/compact', '/export', '/connect', '/todos', '/agents', '/models',
    '/tools', '/skills', '/env', '/simulate', '/workspace', '/clear', '/exit',
    '/agent create', '/agent model', '/agent remove', '/model add'
  ];

  const getPromptTag = (m) => {
    let color = C.brightCyan;
    if (m === 'plan') color = C.yellow;
    else if (m === 'approve') color = C.brightMagenta;
    else if (m === 'smart') color = C.brightBlue;
    else if (m === 'auto' || m === 'build') color = C.brightGreen;
    return `${C.bold}${color}omni (${m})>${C.reset} `;
  };

  const modesOrder = ['approve', 'plan', 'smart', 'auto'];

  const rl = readline.createInterface({
    input,
    output,
    completer: (line) => {
      // Se linha vazia e pressionou Tab: alterna entre os 4 modos (approve -> plan -> smart -> auto)
      if (!line.trim()) {
        const currentIdx = modesOrder.indexOf(sessionContext.mode);
        const nextIdx = (currentIdx + 1) % modesOrder.length;
        sessionContext.mode = modesOrder[nextIdx];
        process.stdout.write(`\r${C.bold}${C.brightYellow}⚡ Modo de autonomia alterado para [${sessionContext.mode.toUpperCase()}] via [Tab]${C.reset}\n`);
        return [[], ''];
      }
      const hits = commandsList.filter((c) => c.startsWith(line));
      return [hits.length ? hits : commandsList, line];
    }
  });

  // Checa status de chaves e conexão de modelos
  let configuredModelsCount = router.getAllModels().filter((m) => m.isConfigured).length;
  if (configuredModelsCount === 0) {
    TerminalUI.showNoModelsPrompt();

    // Se estiver em um terminal interativo real (TTY), sugere e guia a conexão
    if (process.stdin.isTTY) {
      console.log(`  ${C.brightCyan}Deseja conectar uma chave de API ou Ollama local agora?${C.reset}`);
      const answer = await rl.question(`  ${C.bold}Conectar modelo agora? [S/n]: ${C.reset}`);
      const cleanAnswer = answer.trim().toLowerCase();

      if (cleanAnswer === '' || cleanAnswer === 's' || cleanAnswer === 'sim' || cleanAnswer === 'y' || cleanAnswer === 'yes') {
        await runInteractiveConnect(rl, router);
        configuredModelsCount = router.getAllModels().filter((m) => m.isConfigured).length;
      } else {
        console.log(`\n  ${C.gray}ℹ Continuando no Modo de Demonstração / Simulação.${C.reset}`);
        console.log(`  ${C.gray}Você pode conectar uma chave a qualquer momento com o comando ${C.bold}/connect${C.reset} ou no ${C.bold}.env${C.reset}.\n`);
      }
    } else {
      console.log(`  ${C.gray}Ambiente não-interativo: executando em Modo Demonstração.${C.reset}\n`);
    }
  }

  if (configuredModelsCount > 0) {
    TerminalUI.success(`${configuredModelsCount} modelo(s) com chave de API / endpoint local prontos para uso.`);
  }

  console.log(`\nDigite sua missão (ex: ${C.italic}'Crie uma calculadora em Python'${C.reset}) ou ${C.bold}/help${C.reset} para comandos:\n`);

  // Interceptador de teclas rápidas diretas do CLI (Estilo OpenCode)
  process.stdin.on('keypress', (char, key) => {
    if (!key) return;

    // Ctrl+T: Exibir TODOs da sessão
    if (key.ctrl && key.name === 't') {
      process.stdout.write('\n');
      TerminalUI.showTodos(sessionContext.todos);
      process.stdout.write(getPromptTag(sessionContext.mode));
      return;
    }

    // Ctrl+A: Listar agentes
    if (key.ctrl && key.name === 'a') {
      process.stdout.write('\n');
      TerminalUI.showAgents(orchestrator.getAgents(), router);
      process.stdout.write(getPromptTag(sessionContext.mode));
      return;
    }

    // Ctrl+M: Listar modelos
    if (key.ctrl && key.name === 'm') {
      process.stdout.write('\n');
      TerminalUI.showModels(router.getAllModels());
      process.stdout.write(getPromptTag(sessionContext.mode));
      return;
    }

    // Ctrl+P: Ativar modo PLAN
    if (key.ctrl && key.name === 'p') {
      sessionContext.mode = 'plan';
      process.stdout.write(`\n${C.yellow}⚡ Modo [PLAN] ativado via [Ctrl+P]${C.reset}\n`);
      process.stdout.write(getPromptTag('plan'));
      return;
    }

    // Ctrl+B: Ativar modo BUILD
    if (key.ctrl && key.name === 'b') {
      sessionContext.mode = 'build';
      process.stdout.write(`\n${C.brightGreen}⚡ Modo [BUILD] ativado via [Ctrl+B]${C.reset}\n`);
      process.stdout.write(getPromptTag('build'));
      return;
    }

    // Ctrl+H ou F1: Ajuda
    if ((key.ctrl && key.name === 'h') || key.name === 'f1') {
      process.stdout.write('\n');
      TerminalUI.showHelp();
      process.stdout.write(getPromptTag(sessionContext.mode));
      return;
    }

    // Ctrl+L: Limpar tela
    if (key.ctrl && key.name === 'l') {
      console.clear();
      TerminalUI.banner();
      process.stdout.write(getPromptTag(sessionContext.mode));
      return;
    }
  });

  // Inicializa o TUI Interativo idêntico ao OpenCode (com autocomplete ao digitar '/', mouse e navegação)
  const tui = new OpenCodeTUI({
    sessionContext,
    workspaceDir,
    configuredModelsCount
  });

  while (true) {
    try {
      tui.configuredModelsCount = router.getAllModels().filter((m) => m.isConfigured).length;
      const line = await tui.prompt();
      const trimmed = (line || '').trim();

      if (!trimmed) continue;

      // Comandos de controle
      if (trimmed === '/exit' || trimmed === 'exit' || trimmed === 'quit') {
        TerminalUI.info('Encerrando Omni-Orchestrator. Até logo!');
        break;
      }

      if (trimmed === '/clear' || trimmed === 'clear' || trimmed === 'cls') {
        console.clear();
        TerminalUI.banner();
        continue;
      }

      if (trimmed === '/help' || trimmed === 'help') {
        TerminalUI.showHelp();
        continue;
      }

      // Alternar os 4 modos de autonomia (OmniCode Specification)
      if (trimmed === '/approve' || trimmed === '/mode approve') {
        sessionContext.mode = 'approve';
        TerminalUI.info(`Modo [APPROVE] ativado (Padrão de Segurança): Solicita confirmação antes de gravar arquivos ou executar comandos shell.`);
        continue;
      }

      if (trimmed === '/plan' || trimmed === '/mode plan') {
        sessionContext.mode = 'plan';
        TerminalUI.info(`Modo [PLAN] ativado: Somente leitura e planejamento. Mutações de arquivo e comandos externos bloqueados.`);
        continue;
      }

      if (trimmed === '/smart' || trimmed === '/mode smart') {
        sessionContext.mode = 'smart';
        TerminalUI.info(`Modo [SMART] ativado: Auto-aprova inspeções locais e solicita confirmação para ações de alto risco.`);
        continue;
      }

      if (trimmed === '/auto' || trimmed === '/mode auto' || trimmed === '/build' || trimmed === '/mode build') {
        sessionContext.mode = 'auto';
        TerminalUI.info(`Modo [AUTO] ativado: Execução autônoma dentro dos limites canônicos do workspace.`);
        continue;
      }

      if (trimmed === '/todos' || trimmed === 'todos') {
        TerminalUI.showTodos(sessionContext.todos);
        continue;
      }

      // Comando /connect: Assistente Interativo ou Conexão Direta (OpenCode pattern)
      if (trimmed === '/connect' || trimmed === '/connec') {
        await runInteractiveConnect(rl, router);
        continue;
      }

      if (trimmed.startsWith('/connect') || trimmed.startsWith('/connec')) {
        const parts = trimmed.split(/\s+/);
        if (parts.length < 3) {
          await runInteractiveConnect(rl, router);
          continue;
        }

        const providerName = parts[1].toLowerCase();
        const keyOrUrl = parts[2];
        let envVar = null;

        if (providerName.includes('gemini') || providerName.includes('google')) envVar = 'GEMINI_API_KEY';
        else if (providerName.includes('openai')) envVar = 'OPENAI_API_KEY';
        else if (providerName.includes('anthropic') || providerName.includes('claude')) envVar = 'ANTHROPIC_API_KEY';
        else if (providerName.includes('deepseek')) envVar = 'DEEPSEEK_API_KEY';
        else if (providerName.includes('groq')) envVar = 'GROQ_API_KEY';
        else if (providerName.includes('ollama')) {
          envVar = 'OLLAMA_BASE_URL';
          process.env.ENABLE_OLLAMA = 'true';
        }

        if (!envVar) {
          TerminalUI.error(`Provedor desconhecido: '${providerName}'. Suportados: gemini, openai, anthropic, deepseek, groq, ollama.`);
          continue;
        }

        await saveEnvKey(envVar, keyOrUrl);
        TerminalUI.success(`Chave/Endpoint para '${providerName}' configurado em .env e ativado com sucesso!`);
        continue;
      }

      // Comando /diff (OpenCode pattern)
      if (trimmed === '/diff' || trimmed === 'diff') {
        await showDiff(workspaceDir);
        continue;
      }

      // Comando /undo (OpenCode pattern)
      if (trimmed === '/undo' || trimmed === 'undo') {
        try {
          const res = await undoLastFileChange();
          if (res.action === 'deleted') {
            TerminalUI.success(`Desfeito com sucesso: novo arquivo '${res.filePath}' foi removido.`);
          } else {
            TerminalUI.success(`Desfeito com sucesso: '${res.filePath}' restaurado para a versão anterior.`);
          }
        } catch (err) {
          TerminalUI.warn(err.message);
        }
        continue;
      }

      // Comando /compact (OpenCode pattern)
      if (trimmed === '/compact' || trimmed === 'compact') {
        const summary = orchestrator.memory.compact();
        TerminalUI.success(`Memória de sessão compactada com sucesso! Consumo de tokens reduzido.`);
        console.log(`  ${C.gray}${summary}${C.reset}\n`);
        continue;
      }

      // Comando /export (OpenCode pattern)
      if (trimmed.startsWith('/export') || trimmed === 'export') {
        const parts = trimmed.split(/\s+/);
        const fileName = parts[1] || `SESSION_REPORT_${Date.now()}.md`;
        const exportPath = path.resolve(process.cwd(), fileName);
        await orchestrator.memory.exportMarkdown(exportPath);
        TerminalUI.success(`Relatório completo da sessão exportado em: ${exportPath}`);
        continue;
      }

      // Comando /init: Inspeciona o repositório e gera/atualiza AGENTS.md preservando dados
      if (trimmed === '/init' || trimmed.startsWith('/init ')) {
        TerminalUI.info('Executando inspeção detalhada do repositório para gerar/atualizar o AGENTS.md...');
        const result = await inspectAndInitRepository(projectRoot);
        console.log(`  • Ecossistema detectado: ${result.projectType}`);
        console.log(`  • Diretórios de código: ${result.mainDirs.join(', ') || 'Raiz'}`);
        TerminalUI.success(`Arquivo AGENTS.md gravado em: ${result.targetPath} (${result.alreadyExisted ? 'preservou instruções anteriores' : 'novo contexto inicial'})`);
        continue;
      }

      // Comando /review: Revisa o código gerado no workspace com evidências reais
      if (trimmed === '/review' || trimmed.startsWith('/review ')) {
        const targetArg = trimmed.slice(7).trim();
        TerminalUI.info(`Executando auditoria real de código ${targetArg ? `para: ${targetArg}` : 'no workspace'}...`);
        const reviewer = new CodeReviewer({ workspaceDir, router, provider });
        const result = await reviewer.review(targetArg);
        console.log(`\n${result.report}`);
        TerminalUI.success(`Revisão de código concluída (${result.filesChecked} arquivo(s) auditado(s)).`);
        continue;
      }

      if (trimmed === '/agents' || trimmed === 'agents') {
        TerminalUI.showAgents(orchestrator.getAgents(), router);
        continue;
      }

      if (trimmed === '/models' || trimmed === 'models') {
        TerminalUI.showModels(router.getAllModels());
        continue;
      }

      if (trimmed === '/tools' || trimmed === 'tools') {
        TerminalUI.showTools(globalToolRegistry.listSummary());
        continue;
      }

      if (trimmed === '/skills' || trimmed === 'skills') {
        TerminalUI.showSkills(skillLoader.getSkillsSummary());
        continue;
      }

      if (trimmed === '/env' || trimmed === 'env') {
        TerminalUI.showEnvStatus();
        continue;
      }

      if (trimmed === '/simulate' || trimmed === 'simulate') {
        provider.simulationMode = !provider.simulationMode;
        TerminalUI.info(`Modo de Simulação agora está: ${provider.simulationMode ? 'ATIVADO' : 'DESATIVADO'}`);
        continue;
      }

      if (trimmed === '/workspace' || trimmed === 'workspace') {
        try {
          const files = await fs.readdir(workspaceDir);
          TerminalUI.section(`Arquivos no Workspace (${workspaceDir})`);
          if (files.length === 0) {
            console.log(`  ${C.gray}(Diretório vazio no momento)${C.reset}\n`);
          } else {
            files.forEach((f) => console.log(`  📄 ${f}`));
            console.log('');
          }
        } catch (err) {
          TerminalUI.error(`Erro ao listar workspace: ${err.message}`);
        }
        continue;
      }

      // Comando /sessions: Lista as sessões salvas no projeto
      if (trimmed === '/sessions' || trimmed === 'sessions') {
        const list = await orchestrator.sessionStore.listSessions();
        TerminalUI.section('Sessões Salvas do Projeto (.omnicode/sessions)');
        if (list.length === 0) {
          console.log(`  ${C.gray}(Nenhuma sessão salva ainda)${C.reset}\n`);
        } else {
          list.forEach((s, idx) => {
            console.log(`  ${idx + 1}. ${C.bold}${C.brightCyan}[${s.id}]${C.reset} ${s.goal}`);
            console.log(`     Criada: ${C.gray}${new Date(s.createdAt).toLocaleString()}${C.reset} | Subtarefas: ${s.subtasksCount}`);
          });
          console.log('');
        }
        continue;
      }

      // Comando /resume <sessionId>
      if (trimmed.startsWith('/resume')) {
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) {
          TerminalUI.warn('Uso: /resume <id_da_sessao>');
          continue;
        }
        try {
          const sessionData = await orchestrator.sessionStore.loadSession(parts[1]);
          TerminalUI.success(`Sessão '${sessionData.id}' retomada!`);
          console.log(`  Objetivo original: ${sessionData.goal}`);
          sessionContext.todos = sessionData.todos || [];
          TerminalUI.showTodos(sessionContext.todos);
        } catch (err) {
          TerminalUI.error(err.message);
        }
        continue;
      }

      // Comando /decision <texto>
      if (trimmed.startsWith('/decision')) {
        const text = trimmed.slice(9).trim();
        if (!text) {
          TerminalUI.warn('Uso: /decision <Título> - <Descrição da decisão>');
          continue;
        }
        await orchestrator.sessionStore.recordProjectDecision('Decisão de Projeto', text);
        TerminalUI.success('Decisão gravada com sucesso na Memória do Projeto (.omnicode/memory.md)!');
        continue;
      }

      // Comando: /agent create <id> <nome> <papel> [modelo]
      if (trimmed.startsWith('/agent create ')) {
        const parts = trimmed.slice(14).trim().split(/\s+/);
        if (parts.length < 3) {
          TerminalUI.warn(`Uso: /agent create <id> <nome> <papel> [modelo]`);
          TerminalUI.warn(`Exemplo: /agent create tester "Tester Pro" "Criação de Testes Unitários" auto`);
          continue;
        }
        const [id, name, role, model = 'auto'] = parts;
        try {
          const created = await orchestrator.addAgent({ id, name, role, model });
          TerminalUI.success(`Agente '${created.name}' [${created.id}] cadastrado com sucesso! Modelo: ${created.model}`);
        } catch (err) {
          TerminalUI.error(`Erro ao criar agente: ${err.message}`);
        }
        continue;
      }

      // Comando: /agent model <id> <modelo>
      if (trimmed.startsWith('/agent model ')) {
        const parts = trimmed.slice(13).trim().split(/\s+/);
        if (parts.length < 2) {
          TerminalUI.warn(`Uso: /agent model <agentId> <modelId>`);
          TerminalUI.warn(`Exemplo: /agent model coder claude-3-7-sonnet-20250219`);
          continue;
        }
        const [agentId, modelId] = parts;
        try {
          const updated = await orchestrator.setAgentModel(agentId, modelId);
          TerminalUI.success(`Modelo do agente '${updated.name}' alterado para: ${updated.model}`);
        } catch (err) {
          TerminalUI.error(`Erro ao alterar modelo: ${err.message}`);
        }
        continue;
      }

      // Comando: /agent remove <id>
      if (trimmed.startsWith('/agent remove ')) {
        const agentId = trimmed.slice(14).trim();
        try {
          await orchestrator.removeAgent(agentId);
          TerminalUI.success(`Agente '${agentId}' removido com sucesso.`);
        } catch (err) {
          TerminalUI.error(`Erro ao remover agente: ${err.message}`);
        }
        continue;
      }

      // Comando: /model add <id> <nome> [endpoint]
      if (trimmed.startsWith('/model add')) {
        const parts = trimmed.slice(10).trim().split(/\s+/);
        if (parts.length < 2) {
          TerminalUI.warn(`Uso: /model add <id> <nome> [baseUrl]`);
          TerminalUI.warn(`Exemplo: /model add mistral-local "Mistral 7B Local" http://127.0.0.1:11434/v1`);
          continue;
        }
        const [id, name, baseUrl = 'http://127.0.0.1:11434/v1'] = parts;
        try {
          const added = await router.addCustomModel({
            id,
            name,
            baseUrl,
            isLocal: baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost')
          });
          TerminalUI.success(`Modelo customizado '${added.name}' adicionado com sucesso!`);
        } catch (err) {
          TerminalUI.error(`Erro ao cadastrar modelo: ${err.message}`);
        }
        continue;
      }

      // Se começa com /run ou é uma instrução livre em linguagem natural
      let goal = trimmed;
      if (goal.startsWith('/run ')) {
        goal = goal.slice(5).trim();
      }

      // Executa a missão com o orquestrador
      await orchestrator.executeMission(goal);
    } catch (err) {
      TerminalUI.error(`Erro durante execução: ${err.message}`);
    }
  }

  rl.close();
  mcpManager.destroy();
}

main().catch((err) => {
  console.error(`Erro fatal:`, err);
  process.exit(1);
});
