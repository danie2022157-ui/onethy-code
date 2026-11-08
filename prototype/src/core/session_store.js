import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Gerenciador de Sessões Persistentes e Memória de Projeto (OmniCode Session & Memory Store)
 * 1. Sessões: Armazenamento durável em JSON/SQLite sob .omnicode/sessions/.
 * 2. Memória de Projeto: Decisões e convenções técnicas salvas em .omnicode/memory.md.
 * 3. Permite listar (/sessions), retomar (/resume <id>) e recuperar decisões passadas.
 */
export class SessionStore {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.sessionsDir = path.join(projectRoot, '.omnicode', 'sessions');
    this.projectMemoryPath = path.join(projectRoot, '.omnicode', 'memory.md');
  }

  async init() {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    // Cria arquivo de memória do projeto se não existir
    try {
      await fs.access(this.projectMemoryPath);
    } catch {
      const initialMemory = `# 🧠 Memória e Decisões Duráveis do Projeto\n\n> Este arquivo registra convenções, decisões arquiteturais e padrões acordados nas sessões do OmniCode.\n\n`;
      await fs.writeFile(this.projectMemoryPath, initialMemory, 'utf-8');
    }
  }

  /**
   * Salva uma sessão no disco
   */
  async saveSession({ id, goal, mode, subtasks = [], messages = [], todos = [] }) {
    await this.init();
    const sessionId = id || `session-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);

    const data = {
      id: sessionId,
      goal,
      mode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      subtasks,
      todos,
      messagesCount: messages.length,
      messages: messages.slice(-50) // Mantém as últimas 50 mensagens estruturadas
    };

    await fs.writeFile(sessionFile, JSON.stringify(data, null, 2), 'utf-8');
    return sessionId;
  }

  /**
   * Lista todas as sessões salvas do projeto
   */
  async listSessions() {
    await this.init();
    const files = await fs.readdir(this.sessionsDir).catch(() => []);
    const sessions = [];

    for (const f of files) {
      if (f.endsWith('.json')) {
        try {
          const raw = await fs.readFile(path.join(this.sessionsDir, f), 'utf-8');
          const parsed = JSON.parse(raw);
          sessions.push({
            id: parsed.id,
            goal: parsed.goal || 'Sem objetivo declarado',
            mode: parsed.mode || 'approve',
            createdAt: parsed.createdAt,
            subtasksCount: (parsed.subtasks || []).length,
            todosCount: (parsed.todos || []).length
          });
        } catch {}
      }
    }

    // Ordena da mais recente para a mais antiga
    return sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Retoma os dados de uma sessão existente por ID
   */
  async loadSession(sessionId) {
    await this.init();
    const cleanId = sessionId.replace(/\.json$/, '');
    const sessionFile = path.join(this.sessionsDir, `${cleanId}.json`);

    try {
      const raw = await fs.readFile(sessionFile, 'utf-8');
      return JSON.parse(raw);
    } catch {
      throw new Error(`Sessão '${sessionId}' não encontrada em ${this.sessionsDir}.`);
    }
  }

  /**
   * Registra uma decisão durável na Memória do Projeto (.omnicode/memory.md)
   */
  async recordProjectDecision(title, decision) {
    await this.init();
    const entry = `\n### 📌 ${title} (${new Date().toISOString().slice(0, 10)})\n${decision}\n`;
    await fs.appendFile(this.projectMemoryPath, entry, 'utf-8');
  }

  /**
   * Lê a memória de decisões do projeto para contextualizar os agentes
   */
  async getProjectMemory() {
    await this.init();
    try {
      return await fs.readFile(this.projectMemoryPath, 'utf-8');
    } catch {
      return '';
    }
  }
}
