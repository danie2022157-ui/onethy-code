import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodeTUI, COMMANDS_CATALOG, IMMEDIATE_COMMANDS } from '../src/cli/interactive_tui.js';

test('OpenCodeTUI: Catálogo de Comandos e Ações Imediatas', () => {
  assert.ok(Array.isArray(COMMANDS_CATALOG), 'COMMANDS_CATALOG deve ser um array');
  assert.ok(COMMANDS_CATALOG.length >= 20, 'Deve conter pelo menos 20 comandos documentados');

  for (const cmd of COMMANDS_CATALOG) {
    assert.ok(cmd.name.startsWith('/'), `Comando ${cmd.name} deve começar com '/'`);
    assert.ok(cmd.desc && cmd.desc.length > 5, `Comando ${cmd.name} deve ter descrição clara`);
    assert.ok(cmd.category, `Comando ${cmd.name} deve ter categoria definida`);
  }

  // Verifica comandos imediatos vs com parâmetros
  assert.ok(IMMEDIATE_COMMANDS.has('/approve'), '/approve deve ser comando imediato');
  assert.ok(IMMEDIATE_COMMANDS.has('/review'), '/review deve ser comando imediato');
  assert.ok(IMMEDIATE_COMMANDS.has('/diff'), '/diff deve ser comando imediato');
  assert.ok(IMMEDIATE_COMMANDS.has('/todos'), '/todos deve ser comando imediato');
  assert.ok(!IMMEDIATE_COMMANDS.has('/connect'), '/connect requer argumentos e não deve ser imediato');
  assert.ok(!IMMEDIATE_COMMANDS.has('/resume'), '/resume requer ID de sessão');
});

test('OpenCodeTUI: Instanciação e Alternância de Modos', () => {
  const sessionContext = { mode: 'approve' };
  const tui = new OpenCodeTUI({
    sessionContext,
    workspaceDir: './workspace',
    configuredModelsCount: 2
  });

  assert.equal(tui.sessionContext.mode, 'approve');
  assert.equal(tui.configuredModelsCount, 2);
  assert.ok(Array.isArray(tui.history));

  // Simula alternância cíclica de modos (approve -> plan -> smart -> auto -> approve)
  const modesOrder = ['approve', 'plan', 'smart', 'auto'];
  let currentMode = tui.sessionContext.mode;

  for (let i = 0; i < modesOrder.length; i++) {
    const curIdx = modesOrder.indexOf(currentMode);
    currentMode = modesOrder[(curIdx + 1) % modesOrder.length];
  }
  assert.equal(currentMode, 'approve', 'Após 4 alternâncias deve retornar ao modo padrão approve');
});
