import { exec } from 'node:child_process';
import path from 'node:path';
import { resolveCanonicalPath, enforcePermission } from '../core/security.js';

/**
 * Registra ferramentas de execução de shell/terminal com respeito aos 4 Modos de Autonomia (plan, approve, smart, auto)
 * e contenção canônica dentro do workspace.
 * @param {import('./registry.js').ToolRegistry} registry
 * @param {string} baseWorkspaceDir
 * @param {Object} [sessionContext={}]
 */
export function registerShellTools(registry, baseWorkspaceDir = process.cwd(), sessionContext = {}) {
  registry.register({
    name: 'run_terminal_command',
    description: 'Executa um comando no terminal/shell com contenção no diretório do projeto e retorna stdout, stderr e código de saída.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Comando de terminal a ser executado' },
        cwd: { type: 'string', description: 'Subdiretório relativo de execução (opcional, padrão: raiz do workspace)' },
        timeoutMs: { type: 'number', description: 'Timeout em milissegundos (padrão: 60000ms)' }
      },
      required: ['command']
    },
    execute: async ({ command, cwd = '.', timeoutMs = 60000 }) => {
      // 1. Contenção canônica de diretório: impede que cwd escape do workspace
      const workingDir = resolveCanonicalPath(baseWorkspaceDir, cwd);

      // 2. Aplicação centralizada de permissões (plan, approve, smart, auto)
      await enforcePermission(
        sessionContext.mode,
        'shell_exec',
        { command, cwd: workingDir },
        sessionContext.requestApproval
      );

      // 3. Execução do comando com limites estritos
      return new Promise((resolve) => {
        exec(
          command,
          {
            cwd: workingDir,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024 * 5 // Limite de 5MB para evitar exaustão de memória
          },
          (error, stdout, stderr) => {
            resolve({
              command,
              cwd: workingDir,
              exitCode: error ? (error.code ?? 1) : 0,
              stdout: stdout ? stdout.trim() : '',
              stderr: stderr ? stderr.trim() : '',
              timedOut: error && error.killed === true
            });
          }
        );
      });
    }
  });
}
