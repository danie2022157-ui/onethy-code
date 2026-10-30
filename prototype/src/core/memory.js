import fs from 'node:fs/promises';

/**
 * Memória Compartilhada do Projeto (Blackboard Pattern)
 * Permite que múltiplos agentes colaborem mantendo o estado comum do repositório e da missão.
 * Inclui Compactação de Contexto e Exportação de Sessão (Padrão OpenCode).
 */
export class SharedProjectMemory {
  constructor(initialGoal = '') {
    this.goal = initialGoal;
    this.subtasks = [];
    this.modifiedFiles = new Set();
    this.readFiles = new Set();
    this.knowledgeNotes = [];
    this.agentContributions = [];
    this.startedAt = new Date().toISOString();
    this.compactedSummary = null;
  }

  setGoal(goal) {
    this.goal = goal;
  }

  setPlan(subtasks) {
    this.subtasks = subtasks.map((st, idx) => ({
      id: `task_${idx + 1}`,
      title: st.title || st,
      assignedAgent: st.agent || 'coder',
      status: 'pending', // pending | in_progress | completed | failed
      result: null
    }));
  }

  updateTaskStatus(taskId, status, result = null) {
    const task = this.subtasks.find((t) => t.id === taskId);
    if (task) {
      task.status = status;
      if (result) task.result = result;
    }
  }

  recordFileTouch(filePath, action = 'modified') {
    if (action === 'modified') {
      this.modifiedFiles.add(filePath);
    } else {
      this.readFiles.add(filePath);
    }
  }

  addNote(agentId, note) {
    this.knowledgeNotes.push({
      agentId,
      timestamp: new Date().toISOString(),
      note
    });
  }

  recordContribution(agentId, summary) {
    this.agentContributions.push({
      agentId,
      summary,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Compacta a memória da sessão (OpenCode Compaction pattern)
   * Reduz o consumo de tokens condensando subtarefas finalizadas e notas antigas.
   */
  compact() {
    const completedTasks = this.subtasks.filter((t) => t.status === 'completed');
    const pendingTasks = this.subtasks.filter((t) => t.status !== 'completed');

    const summaryParts = [
      `[COMPACTAÇÃO]: ${completedTasks.length} tarefas já concluídas para a meta: "${this.goal}".`,
      `Arquivos modificados até o momento: ${Array.from(this.modifiedFiles).join(', ') || 'Nenhum'}.`
    ];

    if (completedTasks.length > 0) {
      summaryParts.push('Principais entregas:');
      completedTasks.forEach((t) => summaryParts.push(`- ${t.title} (${t.assignedAgent})`));
    }

    this.compactedSummary = summaryParts.join('\n');
    // Mantém na lista ativa apenas as tarefas pendentes
    this.subtasks = pendingTasks;
    this.knowledgeNotes = this.knowledgeNotes.slice(-2);

    return this.compactedSummary;
  }

  /**
   * Exporta a sessão completa em formato Markdown legível
   */
  async exportMarkdown(filePath) {
    const md = [
      `# 📋 Relatório de Sessão Omni-Orchestrator`,
      ``,
      `- **Início da Sessão**: ${this.startedAt}`,
      `- **Meta do Usuário**: ${this.goal || 'Sessão Livre / Interativa'}`,
      `- **Arquivos Criados/Modificados**: ${Array.from(this.modifiedFiles).join(', ') || 'Nenhum'}`,
      `- **Arquivos Lidos/Inspecionados**: ${Array.from(this.readFiles).join(', ') || 'Nenhum'}`,
      ``,
      `## 🎯 Plano e Subtarefas`,
      this.subtasks.length > 0
        ? this.subtasks.map((t) => `- [${t.status === 'completed' ? 'x' : ' '}] **[${t.assignedAgent}]** ${t.title}`).join('\n')
        : `Nenhum plano formal registrado.`,
      ``,
      `## 🤖 Contribuições dos Agentes`,
      this.agentContributions.length > 0
        ? this.agentContributions.map((c) => `- **[${c.agentId}]** (${c.timestamp.slice(11, 19)}): ${c.summary}`).join('\n')
        : `Sem contribuições registradas ainda.`,
      ``,
      `## 📝 Notas de Conhecimento`,
      this.knowledgeNotes.length > 0
        ? this.knowledgeNotes.map((n) => `- **[${n.agentId}]**: ${n.note}`).join('\n')
        : `Nenhuma nota adicional registrada.`
    ].join('\n');

    await fs.writeFile(filePath, md, 'utf-8');
    return filePath;
  }

  /**
   * Retorna um snapshot limpo do contexto para alimentar os prompts dos agentes
   */
  getSnapshot() {
    return {
      goal: this.goal,
      compactedSummary: this.compactedSummary,
      currentPlan: this.subtasks.map((t) => `[${t.status.toUpperCase()}] ${t.title} (${t.assignedAgent})`),
      modifiedFiles: Array.from(this.modifiedFiles),
      readFiles: Array.from(this.readFiles),
      keyNotes: this.knowledgeNotes.slice(-5)
    };
  }
}
