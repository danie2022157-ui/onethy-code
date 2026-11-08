import crypto from 'node:crypto';

/**
 * Barramento de Mensagens Estruturadas entre Agentes (OmniCode Message Bus)
 * Permite que agentes especialistas conversem, troquem planos, decisões e artefatos
 * com remetente, destinatário, tarefa, carimbo de data/hora e tipo estrito.
 */
export class AgentMessageBus {
  constructor() {
    this.messages = [];
    this.listeners = new Set();
  }

  /**
   * Envia uma mensagem estruturada no barramento
   * @param {Object} param0
   * @param {string} param0.sender - ID do agente remetente (ex: 'supervisor', 'coder')
   * @param {string} [param0.target='*'] - ID do agente destinatário ou '*' para todos
   * @param {string} [param0.taskId] - ID ou título da tarefa relacionada
   * @param {'plan' | 'artifact' | 'review_verdict' | 'handoff' | 'question' | 'status'} param0.type
   * @param {*} param0.payload - Conteúdo ou objeto compartilhado
   * @returns {Object} Mensagem criada e distribuída
   */
  publish({ sender, target = '*', taskId = '', type = 'status', payload = null }) {
    const message = {
      id: crypto.randomUUID(),
      sender,
      target,
      taskId,
      type,
      payload,
      timestamp: Date.now()
    };

    this.messages.push(message);

    for (const listener of this.listeners) {
      try {
        listener(message);
      } catch (err) {
        console.error('[MessageBus Listener Error]', err);
      }
    }

    return message;
  }

  /**
   * Inscreve um ouvinte para receber eventos de mensagens em tempo real
   * @param {Function} callback
   * @returns {Function} Função para cancelar a inscrição
   */
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Retorna o histórico de mensagens filtrado por agente ou tarefa
   */
  getHistory({ agentId = null, taskId = null, type = null } = {}) {
    return this.messages.filter((msg) => {
      if (agentId && msg.sender !== agentId && msg.target !== agentId && msg.target !== '*') {
        return false;
      }
      if (taskId && msg.taskId !== taskId) return false;
      if (type && msg.type !== type) return false;
      return true;
    });
  }

  /**
   * Limpa o barramento
   */
  clear() {
    this.messages = [];
  }
}
