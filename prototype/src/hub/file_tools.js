import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveCanonicalPath, enforcePermission } from '../core/security.js';

export const fileBackupStack = [];

async function backupFile(filePath, fullPath) {
  try {
    const existing = await fs.readFile(fullPath, 'utf-8');
    fileBackupStack.push({ filePath, fullPath, content: existing, timestamp: Date.now() });
    if (fileBackupStack.length > 50) fileBackupStack.shift();
  } catch {
    fileBackupStack.push({ filePath, fullPath, content: null, timestamp: Date.now() });
  }
}

export async function undoLastFileChange() {
  if (fileBackupStack.length === 0) {
    throw new Error('Nenhuma modificação de arquivo anterior para desfazer.');
  }
  const last = fileBackupStack.pop();
  if (last.content === null) {
    await fs.unlink(last.fullPath).catch(() => {});
    return { action: 'deleted', filePath: last.filePath };
  } else {
    await fs.writeFile(last.fullPath, last.content, 'utf-8');
    return { action: 'restored', filePath: last.filePath };
  }
}

/**
 * Normaliza aspas tipográficas, hífens especiais e espaços Unicode (Inspirado no OpenCode)
 */
function normalizeForMatch(str) {
  return str
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/\r\n/g, "\n");
}

/**
 * Casamento de padrões glob nativo
 */
function globMatch(relPath, pattern) {
  const normalizedPath = relPath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  const regexStr = '^' + normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§DOUBLESTAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/§DOUBLESTAR§/g, '.*')
    .replace(/\?/g, '.') + '$';

  return new RegExp(regexStr).test(normalizedPath);
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Registra ferramentas avançadas de arquivos no registro global com limites canônicos e permissões centrais
 * @param {import('./registry.js').ToolRegistry} registry
 * @param {string} baseWorkspaceDir
 * @param {Object} [sessionContext]
 */
export function registerFileTools(registry, baseWorkspaceDir = process.cwd(), sessionContext = {}) {
  const resolveSafe = (relOrAbsPath) => {
    return resolveCanonicalPath(baseWorkspaceDir, relOrAbsPath);
  };

  // 1. read_file
  registry.register({
    name: 'read_file',
    description: 'Lê o conteúdo completo ou parcial de um arquivo no disco com números de linha.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Caminho relativo ou absoluto do arquivo' },
        startLine: { type: 'number', description: 'Linha inicial opcional (1-indexado)' },
        endLine: { type: 'number', description: 'Linha final opcional (1-indexado)' }
      },
      required: ['filePath']
    },
    execute: async ({ filePath, startLine, endLine }) => {
      await enforcePermission(sessionContext.mode, 'file_read', { filePath }, sessionContext.requestApproval);
      const fullPath = resolveSafe(filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split(/\r?\n/);

      if (startLine || endLine) {
        const start = Math.max(1, startLine || 1) - 1;
        const end = Math.min(lines.length, endLine || lines.length);
        const sliced = lines.slice(start, end).map((line, idx) => `${start + idx + 1}: ${line}`).join('\n');
        return {
          filePath,
          totalLines: lines.length,
          slice: `${start + 1}-${end}`,
          content: sliced
        };
      }

      return {
        filePath,
        totalLines: lines.length,
        content: lines.map((line, idx) => `${idx + 1}: ${line}`).join('\n')
      };
    }
  });

  // 2. write_file
  registry.register({
    name: 'write_file',
    description: 'Cria ou sobrescreve um arquivo no disco com o conteúdo especificado.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Caminho do arquivo a ser criado' },
        content: { type: 'string', description: 'Conteúdo do arquivo' }
      },
      required: ['filePath', 'content']
    },
    execute: async ({ filePath, content }) => {
      await enforcePermission(sessionContext.mode, 'file_write', { filePath, content }, sessionContext.requestApproval);
      const fullPath = resolveSafe(filePath);
      await backupFile(filePath, fullPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      return { success: true, message: `Arquivo criado/atualizado com sucesso: ${filePath}` };
    }
  });

  // 3. edit_file (Substituição cirúrgica com tolerância Unicode do OpenCode)
  registry.register({
    name: 'edit_file',
    description: 'Edita um arquivo substituindo cirurgicamente um trecho exato de código por outro. Suporta replaceAll e tolerância a quebras de linha.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Caminho do arquivo a ser modificado' },
        oldContent: { type: 'string', description: 'Trecho exato existente a ser substituído' },
        newContent: { type: 'string', description: 'Novo trecho que substituirá o anterior' },
        replaceAll: { type: 'boolean', description: 'Substituir todas as ocorrências (padrão: false)' }
      },
      required: ['filePath', 'oldContent', 'newContent']
    },
    execute: async ({ filePath, oldContent, newContent, replaceAll = false }) => {
      await enforcePermission(sessionContext.mode, 'file_write', { filePath, oldContent, newContent }, sessionContext.requestApproval);
      const fullPath = resolveSafe(filePath);
      await backupFile(filePath, fullPath);
      const original = await fs.readFile(fullPath, 'utf-8');

      let updated = null;
      let occurrences = 0;

      // 1ª tentativa: Correspondência exata
      if (original.includes(oldContent)) {
        if (!replaceAll) {
          const firstIdx = original.indexOf(oldContent);
          const lastIdx = original.lastIndexOf(oldContent);
          if (firstIdx !== lastIdx) {
            throw new Error(`O trecho 'oldContent' aparece múltiplas vezes no arquivo. Forneça mais linhas de contexto ao redor ou defina replaceAll: true.`);
          }
          updated = original.replace(oldContent, newContent);
          occurrences = 1;
        } else {
          updated = original.replaceAll(oldContent, newContent);
          occurrences = original.split(oldContent).length - 1;
        }
      } else {
        // 2ª tentativa: Normalização Unicode (OpenCode pattern)
        const normOriginal = normalizeForMatch(original);
        const normOld = normalizeForMatch(oldContent);

        if (normOriginal.includes(normOld)) {
          updated = original.replace(new RegExp(escapeRegex(oldContent.trim()), replaceAll ? 'g' : ''), newContent);
          occurrences = 1;
        } else {
          throw new Error(`Trecho 'oldContent' não encontrado no arquivo ${filePath}. Verifique se as linhas correspondem ao conteúdo atual.`);
        }
      }

      await fs.writeFile(fullPath, updated, 'utf-8');
      return { success: true, message: `Arquivo ${filePath} editado com sucesso (${occurrences} substituição(ões)).` };
    }
  });

  // 4. glob (Busca de arquivos por padrão estilo OpenCode)
  registry.register({
    name: 'glob',
    description: 'Busca caminhos de arquivos correspondentes a um padrão glob (ex: "**/*.ts", "src/**/*.py", "*.json").',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Padrão glob para buscar arquivos' },
        dirPath: { type: 'string', description: 'Diretório inicial de busca (padrão: .)' },
        limit: { type: 'number', description: 'Número máximo de resultados (padrão: 50)' }
      },
      required: ['pattern']
    },
    execute: async ({ pattern, dirPath = '.', limit = 50 }) => {
      const fullPath = resolveSafe(dirPath);
      const matched = [];

      async function walk(currentDir) {
        if (matched.length >= limit) return;
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
          const entryFull = path.join(currentDir, entry.name);
          const relToWorkspace = path.relative(baseWorkspaceDir, entryFull);

          if (entry.isDirectory()) {
            await walk(entryFull);
          } else if (entry.isFile()) {
            if (globMatch(relToWorkspace, pattern) || globMatch(entry.name, pattern)) {
              matched.push(relToWorkspace);
              if (matched.length >= limit) return;
            }
          }
        }
      }

      await walk(fullPath);
      return {
        pattern,
        count: matched.length,
        files: matched
      };
    }
  });

  // 5. list_dir
  registry.register({
    name: 'list_dir',
    description: 'Lista o conteúdo de um diretório.',
    parameters: {
      type: 'object',
      properties: {
        dirPath: { type: 'string', description: 'Diretório a ser listado (padrão: raiz do workspace)' }
      }
    },
    execute: async ({ dirPath = '.' }) => {
      const fullPath = resolveSafe(dirPath);
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const items = entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile()
      }));
      return { dirPath, items };
    }
  });

  // 6. grep_search
  registry.register({
    name: 'grep_search',
    description: 'Busca por texto ou regex em arquivos dentro de um diretório recursivamente.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Termo a ser buscado' },
        dirPath: { type: 'string', description: 'Diretório onde pesquisar (padrão: .)' }
      },
      required: ['query']
    },
    execute: async ({ query, dirPath = '.' }) => {
      const fullPath = resolveSafe(dirPath);
      const matches = [];

      async function scan(currentDir) {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
          const entryPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await scan(entryPath);
          } else if (entry.isFile()) {
            try {
              const text = await fs.readFile(entryPath, 'utf-8');
              const lines = text.split(/\r?\n/);
              lines.forEach((line, index) => {
                if (line.includes(query)) {
                  matches.push({
                    file: path.relative(baseWorkspaceDir, entryPath),
                    line: index + 1,
                    text: line.trim()
                  });
                }
              });
            } catch {
              // Ignora arquivos binários
            }
          }
        }
      }

      await scan(fullPath);
      return { query, matches: matches.slice(0, 50) };
    }
  });

  // 7. todowrite (Sistema de Lista de Tarefas / Plan da Sessão - Inspirado no OpenCode)
  registry.register({
    name: 'todowrite',
    description: 'Cria e atualiza a lista de afazeres (TODOs) da sessão ativa. O usuário e o orquestrador veem o progresso em tempo real.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'Lista completa de tarefas atualizada',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Descrição concisa da tarefa' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                description: 'Status atual da tarefa'
              }
            },
            required: ['content', 'status']
          }
        }
      },
      required: ['todos']
    },
    execute: async ({ todos }) => {
      sessionContext.todos = todos;
      const completed = todos.filter((t) => t.status === 'completed').length;
      const inProgress = todos.filter((t) => t.status === 'in_progress').map((t) => t.content);

      if (typeof sessionContext.onEvent === 'function') {
        sessionContext.onEvent({
          type: 'todos_updated',
          todos,
          summary: `${completed}/${todos.length} tarefas concluídas${inProgress.length ? ` (Em andamento: ${inProgress.join(', ')})` : ''}`
        });
      }

      return {
        success: true,
        summary: `${completed}/${todos.length} concluídas`,
        todos
      };
    }
  });

  // 8. patch (Multi-file patch language do OpenCode com suporte completo a Add, Delete e Update)
  registry.register({
    name: 'patch',
    description: 'Aplica um patch multi-arquivo no formato envelope OpenCode (*** Begin Patch ... *** End Patch). Suporta Add, Update e Delete.',
    parameters: {
      type: 'object',
      properties: {
        patchText: { type: 'string', description: 'Texto do patch contendo os blocos Add, Update ou Delete' }
      },
      required: ['patchText']
    },
    execute: async ({ patchText }) => {
      await enforcePermission(sessionContext.mode, 'file_write', { patchText }, sessionContext.requestApproval);

      const results = [];
      const lines = patchText.split(/\r?\n/);
      let currentFile = null;
      let currentAction = null;
      let buffer = [];

      const flushCurrent = async () => {
        if (!currentFile || !currentAction) return;
        const fullPath = resolveSafe(currentFile);

        if (currentAction === 'add') {
          await backupFile(currentFile, fullPath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, buffer.join('\n'), 'utf-8');
          results.push(`Criado: ${currentFile}`);
        } else if (currentAction === 'update') {
          await backupFile(currentFile, fullPath);
          const original = await fs.readFile(fullPath, 'utf-8').catch(() => '');
          const origLines = original.split(/\r?\n/);
          const newLines = [];
          
          // Aplica linhas do hunk (+ adiciona, - remove, espaço mantém)
          let origIdx = 0;
          for (const pLine of buffer) {
            if (pLine.startsWith('+')) {
              newLines.push(pLine.slice(1));
            } else if (pLine.startsWith('-')) {
              origIdx++;
            } else if (pLine.startsWith(' ')) {
              if (origIdx < origLines.length) {
                newLines.push(origLines[origIdx]);
                origIdx++;
              }
            } else {
              newLines.push(pLine);
            }
          }
          // Anexa linhas restantes se houver
          while (origIdx < origLines.length) {
            newLines.push(origLines[origIdx]);
            origIdx++;
          }
          await fs.writeFile(fullPath, newLines.join('\n'), 'utf-8');
          results.push(`Atualizado: ${currentFile}`);
        }
        buffer = [];
      };

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('*** Add File: ')) {
          await flushCurrent();
          currentFile = line.slice(14).trim();
          currentAction = 'add';
        } else if (line.startsWith('*** Update File: ')) {
          await flushCurrent();
          currentFile = line.slice(17).trim();
          currentAction = 'update';
        } else if (line.startsWith('*** Delete File: ')) {
          await flushCurrent();
          const delPath = line.slice(17).trim();
          const fullDel = resolveSafe(delPath);
          await enforcePermission(sessionContext.mode, 'file_delete', { filePath: delPath }, sessionContext.requestApproval);
          await backupFile(delPath, fullDel);
          try {
            await fs.unlink(fullDel);
            results.push(`Removido: ${delPath}`);
          } catch {}
          currentFile = null;
          currentAction = null;
        } else if (line.startsWith('*** End Patch') || line.startsWith('*** Begin Patch')) {
          // Marcadores de envelope
          continue;
        } else if (currentAction) {
          buffer.push(line);
        }
      }

      await flushCurrent();
      return { success: true, actions: results };
    }
  });
}
