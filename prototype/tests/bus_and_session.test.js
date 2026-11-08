import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

import { AgentMessageBus } from '../src/core/bus.js';
import { SessionStore } from '../src/core/session_store.js';

test('AgentMessageBus: Publicação, inscrição e filtragem de mensagens', () => {
  const bus = new AgentMessageBus();
  const received = [];

  bus.subscribe((msg) => received.push(msg));

  // 1. Publica plano do supervisor
  const m1 = bus.publish({
    sender: 'supervisor',
    type: 'plan',
    payload: [{ title: 'Subtarefa 1', agent: 'coder' }]
  });

  // 2. Publica artefato do coder
  const m2 = bus.publish({
    sender: 'coder',
    taskId: 'task-1',
    type: 'artifact',
    payload: 'codigo gerado'
  });

  assert.equal(received.length, 2);
  assert.equal(m1.type, 'plan');
  assert.equal(m2.sender, 'coder');

  // Filtragem por tipo
  const artifacts = bus.getHistory({ type: 'artifact' });
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].payload, 'codigo gerado');
});

test('SessionStore: Salva, lista, retoma sessões e registra decisões em memória durável', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-session-test-'));

  try {
    const store = new SessionStore(tmpDir);

    // 1. Salva uma sessão
    const sessionId = await store.saveSession({
      goal: 'Construir API REST',
      mode: 'approve',
      subtasks: [{ id: 'st-1', title: 'Criar rotas', status: 'completed' }],
      todos: [{ content: 'Criar rotas', status: 'completed' }],
      messages: [{ sender: 'coder', type: 'artifact', payload: 'app.js' }]
    });

    assert.ok(sessionId.startsWith('session-'));

    // 2. Lista sessões
    const sessions = await store.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, sessionId);
    assert.equal(sessions[0].goal, 'Construir API REST');

    // 3. Retoma sessão
    const loaded = await store.loadSession(sessionId);
    assert.equal(loaded.goal, 'Construir API REST');
    assert.equal(loaded.subtasks.length, 1);

    // 4. Memória e decisões duráveis
    await store.recordProjectDecision('Uso de SQLite', 'Decidido usar SQLite para armazenamento local.');
    const memory = await store.getProjectMemory();
    assert.ok(memory.includes('Uso de SQLite'));
    assert.ok(memory.includes('Decidido usar SQLite'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
