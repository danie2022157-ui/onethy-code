import readline from 'node:readline';

/**
 * OpenCode Interactive TUI (Zero-Dependency)
 * Implementa a experiência idêntica de CLI do OpenCode:
 * 1. Ao digitar '/', exibe menu popover flutuante com todos os comandos disponíveis.
 * 2. Filtragem em tempo real conforme o usuário digita (ex: '/co' -> '/connect', '/compact').
 * 3. Navegação com teclas direcionais (↑ / ↓), autocomplete com [Tab] e seleção com [Enter].
 * 4. Suporte total a MOUSE interativo (clique direto na opção desejada via SGR mouse reporting).
 * 5. Caixas estilizadas com ANSI boxes, badges de modo (APPROVE, PLAN, SMART, AUTO) e status.
 */

export const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  // Cores
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  // Bright
  brightGreen: '\x1b[92m',
  brightCyan: '\x1b[96m',
  brightYellow: '\x1b[93m',
  brightMagenta: '\x1b[95m',
  brightBlue: '\x1b[94m',
  gray: '\x1b[90m',
  bgBlue: '\x1b[44m',
  bgDark: '\x1b[100m'
};

export const COMMANDS_CATALOG = [
  { name: '/connect', desc: 'Conectar chaves de IA (Gemini, Claude, GPT-4o, DeepSeek, Ollama)', category: 'Setup' },
  { name: '/approve', desc: 'Modo padrão: pede autorização antes de alterar arquivos ou comandos', category: 'Modo' },
  { name: '/plan', desc: 'Modo seguro somente leitura: análise e exploração sem mutações', category: 'Modo' },
  { name: '/smart', desc: 'Aprovação inteligente: auto-aprova ações seguras e pede para alto risco', category: 'Modo' },
  { name: '/auto', desc: 'Autonomia total: executa sem confirmação rotineira no workspace', category: 'Modo' },
  { name: '/review', desc: 'Auditoria de código e segurança em arquivos reais com evidências', category: 'Qualidade' },
  { name: '/diff', desc: 'Visualizar diferenças de arquivos modificados na sessão (git diff)', category: 'Código' },
  { name: '/undo', desc: 'Desfazer a última alteração de arquivo feita pelos agentes', category: 'Código' },
  { name: '/init', desc: 'Inspecionar repositório e gerar o contexto AGENTS.md real', category: 'Setup' },
  { name: '/todos', desc: 'Exibir a lista de tarefas e progresso da sessão ativa', category: 'Tarefas' },
  { name: '/sessions', desc: 'Listar e inspecionar sessões salvas no projeto (.omnicode)', category: 'Sessão' },
  { name: '/resume', desc: 'Retomar o contexto e tarefas de uma sessão anterior', category: 'Sessão' },
  { name: '/decision', desc: 'Gravar decisão técnica durável na memória do projeto', category: 'Memória' },
  { name: '/agents', desc: 'Listar a equipe de agentes especialistas e seus modelos', category: 'Agentes' },
  { name: '/models', desc: 'Listar o catálogo de modelos de IA e status de conexão', category: 'Modelos' },
  { name: '/tools', desc: 'Listar todas as 12 ferramentas de engenharia ativas', category: 'Ferramentas' },
  { name: '/skills', desc: 'Listar as habilidades técnicas carregadas no sistema', category: 'Skills' },
  { name: '/compact', desc: 'Compactar o contexto da sessão para economizar tokens', category: 'Sessão' },
  { name: '/export', desc: 'Exportar o relatório completo da sessão em Markdown', category: 'Sessão' },
  { name: '/env', desc: 'Exibir status das variáveis de ambiente e chaves', category: 'Sistema' },
  { name: '/simulate', desc: 'Ativar/Desativar o modo de demonstração/simulação', category: 'Debug' },
  { name: '/clear', desc: 'Limpar a tela do terminal', category: 'Sistema' },
  { name: '/exit', desc: 'Encerrar o OmniCode', category: 'Sistema' }
];

export const IMMEDIATE_COMMANDS = new Set([
  '/approve', '/plan', '/smart', '/auto', '/review', '/diff', '/undo',
  '/init', '/todos', '/sessions', '/agents', '/models', '/tools',
  '/skills', '/compact', '/export', '/env', '/simulate', '/clear', '/exit'
]);

export class OpenCodeTUI {
  constructor({ sessionContext = {}, workspaceDir = './workspace', configuredModelsCount = 0 } = {}) {
    this.sessionContext = sessionContext;
    this.workspaceDir = workspaceDir;
    this.configuredModelsCount = configuredModelsCount;
    this.history = [];
    this.historyIdx = -1;
    this.isRaw = false;
  }

  /**
   * Habilita o rastreamento SGR de mouse no terminal
   */
  enableMouse() {
    if (process.stdin.isTTY) {
      process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
    }
  }

  /**
   * Desabilita o rastreamento de mouse
   */
  disableMouse() {
    if (process.stdin.isTTY) {
      process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l\x1b[?25h');
    }
  }

  /**
   * Solicita uma entrada do usuário com autocompletar flutuante interativo e suporte a mouse
   * @param {Object} [options]
   * @returns {Promise<string>}
   */
  async prompt(options = {}) {
    if (!process.stdin.isTTY) {
      // Fallback para pipes ou ambientes não interativos
      return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`omni (${this.sessionContext.mode || 'approve'})> `, (ans) => {
          rl.close();
          resolve(ans.trim());
        });
      });
    }

    return new Promise((resolve) => {
      let inputBuffer = '';
      let cursorPos = 0;
      let selectedIndex = 0;
      let lastRenderedLines = 0;
      let mouseRowOffset = 0; // Guarda linha no terminal para cliques do mouse

      const getFilteredCommands = () => {
        if (!inputBuffer.startsWith('/')) return [];
        const query = inputBuffer.slice(1).toLowerCase();
        return COMMANDS_CATALOG.filter((c) => c.name.slice(1).toLowerCase().startsWith(query));
      };

      const clearPreviousRender = () => {
        if (lastRenderedLines > 0) {
          // Volta N linhas para cima e limpa cada uma
          for (let i = 0; i < lastRenderedLines; i++) {
            process.stdout.write('\x1b[2K\x1b[1A');
          }
          process.stdout.write('\x1b[2K\r');
          lastRenderedLines = 0;
        }
      };

      const render = () => {
        clearPreviousRender();

        const mode = this.sessionContext.mode || 'approve';
        let modeColor = C.brightMagenta;
        if (mode === 'plan') modeColor = C.yellow;
        else if (mode === 'smart') modeColor = C.brightBlue;
        else if (mode === 'auto') modeColor = C.brightGreen;

        const filtered = getFilteredCommands();
        const showDropdown = inputBuffer.startsWith('/') && filtered.length > 0;
        const termWidth = Math.min(process.stdout.columns || 80, 88);

        const out = [];

        // 1. Linha superior estilizada estilo OpenCode
        const titleBadge = `${C.bold}${C.brightCyan} omnicode ${C.reset}`;
        const modeBadge = `${C.bold}${modeColor}[${mode.toUpperCase()}]${C.reset}`;
        const modelsBadge = `${C.gray}${this.configuredModelsCount} modelo(s)${C.reset}`;
        const borderTop = `╭─${titleBadge}─ ${modeBadge} ── ${modelsBadge} ${'─'.repeat(Math.max(2, termWidth - 45))}╮`;
        out.push(borderTop);

        // 2. Caixa de Input do usuário
        const promptSymbol = `${C.bold}${C.brightGreen}❯${C.reset} `;
        const inputDisplay = inputBuffer || `${C.gray}Digite uma missão ou '/' para comandos...${C.reset}`;
        const contentLine = `│ ${promptSymbol}${inputDisplay}`;
        // Padding para fechar borda lateral
        const strippedLen = (inputBuffer || 'Digite uma missão ou / para comandos...').length + 4;
        const padLen = Math.max(0, termWidth - strippedLen - 1);
        out.push(`${contentLine}${' '.repeat(padLen)}│`);

        const borderBottom = `╰${'─'.repeat(termWidth - 2)}╯`;
        out.push(borderBottom);

        // 3. Dropdown Popover de Comandos Estilo OpenCode
        if (showDropdown) {
          const maxVisible = Math.min(filtered.length, 8);
          // Ajusta índice selecionado
          if (selectedIndex >= filtered.length) selectedIndex = 0;
          if (selectedIndex < 0) selectedIndex = filtered.length - 1;

          // Janela deslizante
          let startIdx = 0;
          if (selectedIndex >= maxVisible) {
            startIdx = selectedIndex - maxVisible + 1;
          }
          const visibleItems = filtered.slice(startIdx, startIdx + maxVisible);

          const dropdownHeader = `  ${C.bold}${C.brightYellow}┌─ COMANDOS DISPONÍVEIS (Navegue com [↑/↓] ou clique no Mouse) ${'─'.repeat(Math.max(2, termWidth - 66))}┐${C.reset}`;
          out.push(dropdownHeader);

          visibleItems.forEach((item, idx) => {
            const actualIdx = startIdx + idx;
            const isSelected = actualIdx === selectedIndex;
            const pointer = isSelected ? `${C.bold}${C.brightGreen}❯${C.reset}` : ' ';
            const cmdName = isSelected ? `${C.bold}${C.brightCyan}${item.name.padEnd(12)}${C.reset}` : `${C.cyan}${item.name.padEnd(12)}${C.reset}`;
            const desc = isSelected ? `${C.bold}${C.white}${item.desc}${C.reset}` : `${C.gray}${item.desc}${C.reset}`;
            const itemLine = `  │ ${pointer} ${cmdName} ${desc}`;
            // Normaliza largura
            const rawLength = item.name.padEnd(12).length + item.desc.length + 7;
            const itemPad = Math.max(0, termWidth - rawLength - 2);
            out.push(`${itemLine}${' '.repeat(itemPad)}│`);
          });

          const dropdownFooter = `  ${C.bold}${C.brightYellow}└${'─'.repeat(termWidth - 4)}┘${C.reset}`;
          out.push(dropdownFooter);
        }

        // Escreve as linhas no terminal
        process.stdout.write(out.join('\n') + '\n');
        lastRenderedLines = out.length;

        // Posiciona cursor real na linha de input
        const linesAbove = lastRenderedLines - 2; // Volta até a linha de input
        process.stdout.write(`\x1b[${linesAbove}A\r\x1b[4C`);
        if (inputBuffer) {
          process.stdout.write(`\x1b[${cursorPos}C`);
        }
        process.stdout.write('\x1b[6n');
      };

      this.enableMouse();
      process.stdin.setRawMode(true);
      process.stdin.resume();

      render();

      const cleanup = () => {
        this.disableMouse();
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        clearPreviousRender();
      };

      let inputTerminalRow = 0;

      const onData = (chunk) => {
        const str = chunk.toString();

        // 0. Resposta de posição do cursor do terminal: \x1b[<row>;<col>R
        const cursorMatch = str.match(/\x1b\[(\d+);(\d+)R/);
        if (cursorMatch) {
          inputTerminalRow = parseInt(cursorMatch[1], 10);
          return;
        }

        // 1. Trata evento de mouse SGR: '\x1b[<button;col;rowM' ou 'm'
        const mouseMatch = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
        if (mouseMatch) {
          const button = parseInt(mouseMatch[1], 10);
          const col = parseInt(mouseMatch[2], 10);
          const row = parseInt(mouseMatch[3], 10);
          const isRelease = mouseMatch[4] === 'm';

          // Scroll wheel up (64)
          if (button === 64) {
            const filtered = getFilteredCommands();
            if (filtered.length > 0) {
              selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
              render();
            }
            return;
          }

          // Scroll wheel down (65)
          if (button === 65) {
            const filtered = getFilteredCommands();
            if (filtered.length > 0) {
              selectedIndex = (selectedIndex + 1) % filtered.length;
              render();
            }
            return;
          }

          // Clique esquerdo pressionado
          if (button === 0 && !isRelease) {
            const filtered = getFilteredCommands();
            if (filtered.length > 0) {
              const maxVisible = Math.min(filtered.length, 8);
              let startIdx = 0;
              if (selectedIndex >= maxVisible) {
                startIdx = selectedIndex - maxVisible + 1;
              }
              const visibleItems = filtered.slice(startIdx, startIdx + maxVisible);

              let chosen = null;

              if (inputTerminalRow > 0) {
                // Clique no badge de modo superior (ex: [APPROVE])
                if (row === inputTerminalRow - 1 && col >= 14 && col <= 32) {
                  const modesOrder = ['approve', 'plan', 'smart', 'auto'];
                  const curIdx = modesOrder.indexOf(this.sessionContext.mode || 'approve');
                  this.sessionContext.mode = modesOrder[(curIdx + 1) % modesOrder.length];
                  render();
                  return;
                }

                // Clique em um item do dropdown popover
                const itemOffset = row - (inputTerminalRow + 3);
                if (itemOffset >= 0 && itemOffset < visibleItems.length) {
                  chosen = visibleItems[itemOffset];
                }
              }

              if (!chosen) {
                chosen = filtered[selectedIndex];
              }

              if (chosen) {
                if (IMMEDIATE_COMMANDS.has(chosen.name)) {
                  cleanup();
                  process.stdout.write(`\r${C.bold}${C.brightCyan}omni (${this.sessionContext.mode || 'approve'})>${C.reset} ${chosen.name}\n`);
                  resolve(chosen.name);
                  return;
                } else {
                  inputBuffer = chosen.name + ' ';
                  cursorPos = inputBuffer.length;
                  render();
                  return;
                }
              }
            }
            return;
          }
          return;
        }

        // 2. Ctrl+C: Encerra
        if (str === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          process.exit(0);
        }

        // 3. Enter (\r ou \n)
        if (str === '\r' || str === '\n') {
          const filtered = getFilteredCommands();
          let finalVal = inputBuffer.trim();

          // Se menu estava aberto e deu Enter, autocompleta o comando selecionado
          if (inputBuffer.startsWith('/') && filtered.length > 0) {
            const chosen = filtered[selectedIndex];
            if (chosen && inputBuffer === '/') {
              finalVal = chosen.name;
            } else if (chosen && !finalVal.includes(' ')) {
              finalVal = chosen.name;
            }
          }

          cleanup();
          if (finalVal) {
            this.history.push(finalVal);
            this.historyIdx = this.history.length;
          }
          process.stdout.write(`\r${C.bold}${C.brightCyan}omni (${this.sessionContext.mode || 'approve'})>${C.reset} ${finalVal}\n`);
          resolve(finalVal);
          return;
        }

        // 4. Backspace (\u007f ou \b)
        if (str === '\u007f' || str === '\b') {
          if (cursorPos > 0) {
            inputBuffer = inputBuffer.slice(0, cursorPos - 1) + inputBuffer.slice(cursorPos);
            cursorPos--;
            selectedIndex = 0;
          }
          render();
          return;
        }

        // 5. Delete key (\x1b[3~)
        if (str === '\x1b[3~') {
          if (cursorPos < inputBuffer.length) {
            inputBuffer = inputBuffer.slice(0, cursorPos) + inputBuffer.slice(cursorPos + 1);
            render();
          }
          return;
        }

        // 6. Home (Ctrl+A ou \x1b[H ou \x1b[1~)
        if (str === '\u0001' || str === '\x1b[H' || str === '\x1b[1~') {
          cursorPos = 0;
          render();
          return;
        }

        // 7. End (Ctrl+E ou \x1b[F ou \x1b[4~)
        if (str === '\u0005' || str === '\x1b[F' || str === '\x1b[4~') {
          cursorPos = inputBuffer.length;
          render();
          return;
        }

        // 8. Ctrl+U (limpar linha)
        if (str === '\u0015') {
          inputBuffer = '';
          cursorPos = 0;
          selectedIndex = 0;
          render();
          return;
        }

        // 9. Ctrl+K (limpar até o fim)
        if (str === '\u000b') {
          inputBuffer = inputBuffer.slice(0, cursorPos);
          render();
          return;
        }

        // 10. Tecla Tab (\t): Alterna modo se vazio, ou autocompleta comando se com '/'
        if (str === '\t') {
          if (!inputBuffer.trim()) {
            // Alterna os 4 modos instantaneamente
            const modesOrder = ['approve', 'plan', 'smart', 'auto'];
            const curIdx = modesOrder.indexOf(this.sessionContext.mode || 'approve');
            const nextIdx = (curIdx + 1) % modesOrder.length;
            this.sessionContext.mode = modesOrder[nextIdx];
            render();
            return;
          }

          const filtered = getFilteredCommands();
          if (filtered.length > 0) {
            const chosen = filtered[selectedIndex] || filtered[0];
            inputBuffer = chosen.name + ' ';
            cursorPos = inputBuffer.length;
            render();
            return;
          }
          render();
          return;
        }

        // 11. Escape (\u001b com comprimento 1)
        if (str === '\u001b') {
          if (inputBuffer.startsWith('/')) {
            inputBuffer = '';
            cursorPos = 0;
            render();
            return;
          }
        }

        // 12. Setas direcionais
        if (str === '\u001b[A') { // Seta para CIMA
          const filtered = getFilteredCommands();
          if (filtered.length > 0) {
            selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
            render();
            return;
          }
          // Histórico para cima
          if (this.history.length > 0 && this.historyIdx > 0) {
            this.historyIdx--;
            inputBuffer = this.history[this.historyIdx] || '';
            cursorPos = inputBuffer.length;
            render();
            return;
          }
          return;
        }

        if (str === '\u001b[B') { // Seta para BAIXO
          const filtered = getFilteredCommands();
          if (filtered.length > 0) {
            selectedIndex = (selectedIndex + 1) % filtered.length;
            render();
            return;
          }
          // Histórico para baixo
          if (this.historyIdx < this.history.length - 1) {
            this.historyIdx++;
            inputBuffer = this.history[this.historyIdx] || '';
            cursorPos = inputBuffer.length;
            render();
            return;
          } else {
            this.historyIdx = this.history.length;
            inputBuffer = '';
            cursorPos = 0;
            render();
            return;
          }
        }

        if (str === '\u001b[D') { // Seta ESQUERDA
          if (cursorPos > 0) cursorPos--;
          render();
          return;
        }

        if (str === '\u001b[C') { // Seta DIREITA
          if (cursorPos < inputBuffer.length) cursorPos++;
          render();
          return;
        }

        // 13. Inserção de texto regular
        if (!str.startsWith('\u001b')) {
          inputBuffer = inputBuffer.slice(0, cursorPos) + str + inputBuffer.slice(cursorPos);
          cursorPos += str.length;
          selectedIndex = 0; // Reseta seleção do menu ao digitar
          render();
        }
      };

      process.stdin.on('data', onData);
    });
  }
}
