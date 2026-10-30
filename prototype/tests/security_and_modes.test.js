import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

import { resolveCanonicalPath, classifyCommandRisk, enforcePermission } from '../src/core/security.js';
import { ConfigManager } from '../src/core/config_manager.js';
import { CodeReviewer } from '../src/core/reviewer.js';
import { inspectAndInitRepository } from '../src/core/init_helper.js';

test('Security: resolveCanonicalPath impede Path Traversal fora do workspace', async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-sec-test-'));

  try {
    // 1. Caminho normal dentro do workspace
    const valid = resolveCanonicalPath(tmpDir, 'src/app.js');
    assert.ok(valid.startsWith(tmpDir));

    // 2. Tentativa de traversal relativo '../' fora do workspace
    assert.throws(
      () => resolveCanonicalPath(tmpDir, '../../etc/passwd'),
      /Tentativa de Path Traversal bloqueada/i
    );

    // 3. Tentativa com caminho absoluto fora do workspace
    const outsideAbs = process.platform === 'win32' ? 'C:\\Windows\\System32\\calc.exe' : '/etc/shadow';
    assert.throws(
      () => resolveCanonicalPath(tmpDir, outsideAbs),
      /Tentativa de Path Traversal bloqueada/i
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Security: classifyCommandRisk classifica corretamente comandos seguros e de risco', () => {
  // Comandos de leitura seguros
  assert.equal(classifyCommandRisk('git status'), 'safe_inspection');
  assert.equal(classifyCommandRisk('git diff'), 'safe_inspection');
  assert.equal(classifyCommandRisk('ls -la'), 'safe_inspection');
  assert.equal(classifyCommandRisk('dir'), 'safe_inspection');
  assert.equal(classifyCommandRisk('node -v'), 'safe_inspection');

  // Encadeamento com operador de shell não é classificado como leitura pura
  assert.equal(classifyCommandRisk('git status && npm run build'), 'mutation');
  assert.equal(classifyCommandRisk('git status && rm -rf .'), 'destructive');

  // Comandos destrutivos
  assert.equal(classifyCommandRisk('rm -rf /'), 'destructive');
  assert.equal(classifyCommandRisk('del /f file.txt'), 'destructive');
  assert.equal(classifyCommandRisk('git push origin main'), 'destructive');
});

test('Security: Modos de Autonomia (plan, approve, smart, auto)', async () => {
  // MODO PLAN: Deve rejeitar gravação de arquivo
  await assert.rejects(
    async () => enforcePermission('plan', 'file_write', { filePath: 'app.js' }),
    /PLAN MODE.*bloqueada/i
  );

  // MODO PLAN: Deve rejeitar comandos de terminal mutativos
  await assert.rejects(
    async () => enforcePermission('plan', 'shell_exec', { command: 'npm install express' }),
    /PLAN MODE.*bloqueado/i
  );

  // MODO PLAN: Deve permitir leitura de arquivos e comandos de inspeção segura
  const planRead = await enforcePermission('plan', 'file_read', { filePath: 'README.md' });
  assert.equal(planRead, true);

  const planInspect = await enforcePermission('plan', 'shell_exec', { command: 'git status' });
  assert.equal(planInspect, true);

  // MODO APPROVE: Solicita aprovação para mutação
  let approvalAsked = false;
  const mockApprove = async () => {
    approvalAsked = true;
    return true;
  };
  await enforcePermission('approve', 'file_write', { filePath: 'index.js' }, mockApprove);
  assert.equal(approvalAsked, true);

  // MODO AUTO: Permite mutação dentro do escopo
  const autoResult = await enforcePermission('auto', 'file_write', { filePath: 'script.py' });
  assert.equal(autoResult, true);
});

test('ConfigManager: Carrega e mescla escopo Global e Projeto', async () => {
  const manager = new ConfigManager(process.cwd());
  const effective = await manager.loadEffectiveConfig();

  assert.ok(effective.globalDir);
  assert.ok(effective.modelsConfig.providers);
  assert.ok(effective.agentsConfig.agents.length > 0);
  assert.equal(effective.preferences.default_autonomy_mode, 'approve');
});

test('CodeReviewer: Executa auditoria estática real e detecta evidências', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-rev-test-'));

  try {
    // Cria arquivo com segredo vazado e eval
    await fs.writeFile(
      path.join(tmpDir, 'vulnerable.js'),
      'const apiKey = "sk-proj-1234567890abcdef";\neval("console.log(apiKey)");'
    );

    const reviewer = new CodeReviewer({ workspaceDir: tmpDir, router: null, provider: null });
    const result = await reviewer.review();

    assert.equal(result.success, true);
    assert.equal(result.filesChecked, 1);
    assert.ok(result.findings.length >= 2, 'Deve detectar a credencial e o eval');
    assert.ok(result.report.includes('Exposição de Credencial'));
    assert.ok(result.report.includes('Execução Dinâmica Insegura'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('InitHelper: Inspeciona e preserva arquivos existentes sem sobrescrita silenciosa', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-init-test-'));

  try {
    // 1. Gera inicial
    const firstResult = await inspectAndInitRepository(tmpDir);
    assert.equal(firstResult.alreadyExisted, false);
    assert.ok(await fs.access(firstResult.targetPath).then(() => true));

    // 2. Segunda execução: deve preservar e não sobrescrever silenciosamente
    const secondResult = await inspectAndInitRepository(tmpDir);
    assert.equal(secondResult.alreadyExisted, true);
    const content = await fs.readFile(secondResult.targetPath, 'utf-8');
    assert.ok(content.includes('Atualização Contextual do OmniCode'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
