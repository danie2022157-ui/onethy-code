import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Gerenciador de Configuração em 3 Escopos do OmniCode:
 * 1. Global do Usuário (%APPDATA%\omnicode ou ~/.config/omnicode): Provedores, chaves, agentes, skills e MCP globais.
 * 2. Projeto (./.omnicode ou ./config): Sobrescreve ou estende o escopo global no repositório ativo.
 * 3. Sessão: Modos temporários selecionados em runtime (plan, approve, smart, auto).
 */
export class ConfigManager {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.globalDir = this.resolveGlobalDir();
    this.projectDir = path.join(projectRoot, '.omnicode');
    this.legacyProjectConfigDir = path.join(projectRoot, 'config');
  }

  /**
   * Determina o diretório canônico de configuração global de acordo com o SO
   */
  resolveGlobalDir() {
    if (process.env.OMNICODE_CONFIG_DIR) {
      return path.resolve(process.env.OMNICODE_CONFIG_DIR);
    }

    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      return path.join(appData, 'omnicode');
    }

    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(xdgConfig, 'omnicode');
  }

  /**
   * Inicializa diretórios e arquivos padrão no registro global se ainda não existirem
   */
  async ensureGlobalInitialized() {
    await fs.mkdir(this.globalDir, { recursive: true });
    await fs.mkdir(path.join(this.globalDir, 'skills'), { recursive: true });

    // Copia templates padrão do projeto caso a pasta global esteja vazia
    const defaultModelsPath = path.join(this.legacyProjectConfigDir, 'models.json');
    const globalModelsPath = path.join(this.globalDir, 'models.json');
    if (!(await this.fileExists(globalModelsPath)) && (await this.fileExists(defaultModelsPath))) {
      await fs.copyFile(defaultModelsPath, globalModelsPath);
    }

    const defaultAgentsPath = path.join(this.legacyProjectConfigDir, 'agents.json');
    const globalAgentsPath = path.join(this.globalDir, 'agents.json');
    if (!(await this.fileExists(globalAgentsPath)) && (await this.fileExists(defaultAgentsPath))) {
      await fs.copyFile(defaultAgentsPath, globalAgentsPath);
    }

    const defaultMcpPath = path.join(this.legacyProjectConfigDir, 'mcp_servers.json');
    const globalMcpPath = path.join(this.globalDir, 'mcp_servers.json');
    if (!(await this.fileExists(globalMcpPath)) && (await this.fileExists(defaultMcpPath))) {
      await fs.copyFile(defaultMcpPath, globalMcpPath);
    }

    const globalPreferencesPath = path.join(this.globalDir, 'preferences.json');
    if (!(await this.fileExists(globalPreferencesPath))) {
      const initialPreferences = {
        default_autonomy_mode: 'approve',
        reasoning_effort: 'balanced',
        telemetry: false,
        theme: 'omni-dark'
      };
      await fs.writeFile(globalPreferencesPath, JSON.stringify(initialPreferences, null, 2), 'utf-8');
    }
  }

  /**
   * Carrega e mescla as configurações (Global + Projeto)
   */
  async loadEffectiveConfig() {
    await this.ensureGlobalInitialized();

    // 1. Carrega Escopo Global
    const globalPreferences = await this.readJsonSafe(path.join(this.globalDir, 'preferences.json'), { default_autonomy_mode: 'approve' });
    const globalModels = await this.readJsonSafe(path.join(this.globalDir, 'models.json'), { providers: {}, custom_models: [] });
    const globalAgents = await this.readJsonSafe(path.join(this.globalDir, 'agents.json'), { agents: [] });
    const globalMcp = await this.readJsonSafe(path.join(this.globalDir, 'mcp_servers.json'), { mcpServers: {} });

    // 2. Carrega Escopo do Projeto (Prioriza .omnicode/, fallback para config/)
    const projPrefPath = (await this.fileExists(path.join(this.projectDir, 'preferences.json')))
      ? path.join(this.projectDir, 'preferences.json')
      : path.join(this.legacyProjectConfigDir, 'preferences.json');
    const projectPreferences = await this.readJsonSafe(projPrefPath, {});

    const projModelsPath = (await this.fileExists(path.join(this.projectDir, 'models.json')))
      ? path.join(this.projectDir, 'models.json')
      : path.join(this.legacyProjectConfigDir, 'models.json');
    const projectModels = await this.readJsonSafe(projModelsPath, {});

    const projAgentsPath = (await this.fileExists(path.join(this.projectDir, 'agents.json')))
      ? path.join(this.projectDir, 'agents.json')
      : path.join(this.legacyProjectConfigDir, 'agents.json');
    const projectAgents = await this.readJsonSafe(projAgentsPath, {});

    const projMcpPath = (await this.fileExists(path.join(this.projectDir, 'mcp_servers.json')))
      ? path.join(this.projectDir, 'mcp_servers.json')
      : path.join(this.legacyProjectConfigDir, 'mcp_servers.json');
    const projectMcp = await this.readJsonSafe(projMcpPath, {});

    // 3. Mesclagem com precedência: Projeto sobrepõe Global
    const effectivePreferences = { ...globalPreferences, ...projectPreferences };

    const effectiveModels = {
      providers: { ...globalModels.providers, ...(projectModels.providers || {}) },
      custom_models: [
        ...(globalModels.custom_models || []),
        ...(projectModels.custom_models || []).filter(
          (pm) => !(globalModels.custom_models || []).some((gm) => gm.id === pm.id)
        )
      ]
    };

    const effectiveAgents = {
      agents: [
        ...(globalAgents.agents || []),
        ...(projectAgents.agents || []).filter(
          (pa) => !(globalAgents.agents || []).some((ga) => ga.id === pa.id)
        )
      ]
    };

    const effectiveMcp = {
      mcpServers: { ...globalMcp.mcpServers, ...(projectMcp.mcpServers || {}) }
    };

    return {
      globalDir: this.globalDir,
      projectDir: this.projectDir,
      preferences: effectivePreferences,
      modelsConfig: effectiveModels,
      agentsConfig: effectiveAgents,
      mcpConfig: effectiveMcp,
      globalSkillsDir: path.join(this.globalDir, 'skills'),
      projectSkillsDir: path.join(this.projectRoot, 'skills')
    };
  }

  async readJsonSafe(filePath, fallback = {}) {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

