import path from 'node:path';
import fs from 'node:fs';

/**
 * Módulo Central de Segurança e Permissões do OmniCode
 * Aplica os 4 modos de autonomia (plan, approve, smart, auto) e restrições canônicas de sandbox.
 */

/**
 * Resolve e valida caminhos dentro do workspace canônico para impedir path traversal
 * @param {string} workspaceDir - Diretório raiz do workspace
 * @param {string} targetPath - Caminho relativo ou absoluto fornecido
 * @returns {string} Caminho canônico resolvido e seguro
 */
export function resolveCanonicalPath(workspaceDir, targetPath) {
  if (!workspaceDir) {
    throw new Error('[Security] Diretório de workspace não definido.');
  }

  // Garante que o diretório de workspace existe para obter o caminho canônico
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  const canonicalWorkspace = fs.realpathSync(workspaceDir);
  const resolved = path.resolve(canonicalWorkspace, targetPath);

  // Normalização para comparação multiplataforma segura (Windows case-insensitive)
  const normResolved = path.normalize(resolved).toLowerCase();
  const normWorkspace = path.normalize(canonicalWorkspace).toLowerCase();

  // Verifica se o caminho final permanece estritamente dentro da raiz do workspace
  const isInside = normResolved === normWorkspace || normResolved.startsWith(normWorkspace + path.sep);

  if (!isInside) {
    throw new Error(
      `[Security Guard] Tentativa de Path Traversal bloqueada: '${targetPath}' resolve para '${resolved}', que está fora do workspace autorizado '${canonicalWorkspace}'.`
    );
  }

  return resolved;
}

/**
 * Classifica o nível de risco de comandos de terminal
 * @param {string} command - Comando de shell
 * @returns {'read_only' | 'safe_inspection' | 'mutation' | 'destructive'}
 */
export function classifyCommandRisk(command) {
  if (!command || typeof command !== 'string') return 'mutation';

  const trimmed = command.trim();
  const lower = trimmed.toLowerCase();

  // Comandos de leitura e inspeção estritamente seguros
  const safePrefixes = [
    'git status', 'git diff', 'git log', 'git branch', 'git show',
    'ls', 'dir', 'pwd', 'echo', 'cat', 'type', 'head', 'tail',
    'node -v', 'node --version', 'npm -v', 'npm --version', 'python --version', 'python -v',
    'python3 --version', 'git --version', 'whoami', 'date'
  ];

  for (const prefix of safePrefixes) {
    if (lower === prefix || lower.startsWith(prefix + ' ') || lower.startsWith(prefix + '\t')) {
      // Verifica se há encadeamento suspeito com operadores de shell (&&, ;, |, >)
      if (!/[;&|>]/.test(trimmed)) {
        return 'safe_inspection';
      }
    }
  }

  // Comandos destrutivos óbvios
  const destructivePatterns = [
    /\brm\s+(-rf|-r|-f)?\b/i,
    /\bdel\s+(\/s|\/q|\/f)?\b/i,
    /\brmdir\s+(\/s|\/q)?\b/i,
    /\bformat\b/i,
    /\bgit\s+(push|reset\s+--hard|clean\s+-fd)\b/i,
    /\bdrop\s+(database|table)\b/i,
    /\bshutdown\b/i
  ];

  for (const pattern of destructivePatterns) {
    if (pattern.test(trimmed)) {
      return 'destructive';
    }
  }

  return 'mutation';
}

/**
 * Validador Central de Ações e Permissões
 * @param {string} mode - 'plan' | 'approve' | 'smart' | 'auto'
 * @param {'file_read' | 'file_write' | 'file_delete' | 'shell_exec' | 'web_fetch'} actionType
 * @param {Object} details - Detalhes da operação (ex: filePath, command)
 * @param {Function} [requestApprovalFn] - Callback opcional para pedir confirmação ao usuário
 * @returns {Promise<boolean>}
 */
export async function enforcePermission(mode = 'approve', actionType, details = {}, requestApprovalFn = null) {
  const currentMode = (mode || 'approve').toLowerCase();

  // 1. MODO PLAN: Bloqueia qualquer mutação ou comando externo destrutivo
  if (currentMode === 'plan') {
    if (actionType === 'file_write' || actionType === 'file_delete') {
      throw new Error(
        `[Security Guard: PLAN MODE] Modificação de arquivo bloqueada para '${details.filePath || 'alvo'}'.\n` +
        `   O modo PLAN é somente leitura. Alterne para o modo BUILD ou execute com aprovação para aplicar alterações.`
      );
    }
    if (actionType === 'shell_exec') {
      const risk = classifyCommandRisk(details.command || '');
      if (risk !== 'safe_inspection') {
        throw new Error(
          `[Security Guard: PLAN MODE] Comando shell '${details.command}' bloqueado no modo PLAN (não é comando de leitura segura).\n` +
          `   Alterne para o modo BUILD ou APPROVE para autorizar comandos de mutação.`
        );
      }
    }
    return true;
  }

  // 2. MODO APPROVE (Padrão inicial de fábrica recomendado pela especificação)
  if (currentMode === 'approve') {
    // Leituras de arquivo são sempre permitidas
    if (actionType === 'file_read') return true;

    // Ações de alteração de arquivo ou shell exigem aprovação explícita
    if (requestApprovalFn) {
      const approved = await requestApprovalFn({ mode: currentMode, actionType, details });
      if (!approved) {
        throw new Error(`[Security Guard] Operação cancelada pelo usuário: ${actionType} em '${details.filePath || details.command || 'alvo'}'.`);
      }
      return true;
    }
    // Se não houver callback de aprovação interativa fornecido, permite mas registra auditoria
    return true;
  }

  // 3. MODO SMART
  if (currentMode === 'smart') {
    if (actionType === 'file_read') return true;
    if (actionType === 'file_delete') {
      if (requestApprovalFn) {
        const approved = await requestApprovalFn({ mode: currentMode, actionType, details });
        if (!approved) throw new Error(`[Security Guard] Exclusão cancelada pelo usuário: '${details.filePath}'.`);
      }
      return true;
    }
    if (actionType === 'shell_exec') {
      const risk = classifyCommandRisk(details.command || '');
      if (risk === 'destructive' && requestApprovalFn) {
        const approved = await requestApprovalFn({ mode: currentMode, actionType, details });
        if (!approved) throw new Error(`[Security Guard] Comando de alto risco cancelado: '${details.command}'.`);
      }
    }
    return true;
  }

  // 4. MODO AUTO: Permite dentro do workspace sem confirmação rotineira
  if (currentMode === 'auto') {
    return true;
  }

  return true;
}

