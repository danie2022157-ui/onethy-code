import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Inspetor de Repositório e Gerador de AGENTS.md Real (Padrão OpenCode / OmniCode)
 * Inspeciona dependências, estrutura e scripts reais do projeto e preserva instruções existentes.
 */
export async function inspectAndInitRepository(projectRoot, options = { force: false }) {
  const targetPath = path.join(projectRoot, 'AGENTS.md');
  const existingExists = await fs.access(targetPath).then(() => true).catch(() => false);

  let existingInstructions = '';
  if (existingExists) {
    existingInstructions = await fs.readFile(targetPath, 'utf-8');
  }

  // 1. Inspeciona o ecossistema do projeto
  const entries = await fs.readdir(projectRoot, { withFileTypes: true }).catch(() => []);
  const entryNames = entries.map((e) => e.name);

  let projectType = 'Generic / Polyglot';
  let runCommand = 'node bin/omnicode.js';
  let testCommand = 'Não detectado';
  let dependenciesSummary = 'Nenhuma dependência externa registrada.';

  // Node.js / JavaScript / TypeScript
  if (entryNames.includes('package.json')) {
    try {
      const rawPkg = await fs.readFile(path.join(projectRoot, 'package.json'), 'utf-8');
      const pkg = JSON.parse(rawPkg);
      projectType = `Node.js (${pkg.type === 'module' ? 'ES Modules' : 'CommonJS'})`;
      if (pkg.scripts) {
        if (pkg.scripts.test) testCommand = `npm test`;
        if (pkg.scripts.start) runCommand = `npm start`;
      }
      const depKeys = Object.keys(pkg.dependencies || {});
      const devDepKeys = Object.keys(pkg.devDependencies || {});
      if (depKeys.length > 0 || devDepKeys.length > 0) {
        dependenciesSummary = `Dependencies: ${depKeys.join(', ') || 'nenhuma'} | Dev: ${devDepKeys.join(', ') || 'nenhuma'}`;
      }
    } catch {}
  } else if (entryNames.includes('requirements.txt') || entryNames.includes('pyproject.toml')) {
    projectType = 'Python';
    testCommand = 'pytest';
    runCommand = 'python main.py';
  } else if (entryNames.includes('Cargo.toml')) {
    projectType = 'Rust';
    testCommand = 'cargo test';
    runCommand = 'cargo run';
  } else if (entryNames.includes('go.mod')) {
    projectType = 'Go';
    testCommand = 'go test ./...';
    runCommand = 'go run .';
  }

  // 2. Diretórios principais identificados
  const mainDirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist')
    .map((e) => e.name);

  // 3. Monta o conteúdo contextualizado e real
  const generatedDoc = `# 🤖 AGENTS.md — Diretrizes de Engenharia e Contexto do Repositório

> Gerado pelo OmniCode em ${new Date().toISOString().slice(0, 10)} após inspeção real do projeto.
> Este arquivo serve como contexto de primeira classe para todos os agentes especialistas e modelos LLM.

## 📌 Metadados e Arquitetura do Repositório
- **Ecossistema Detectado**: ${projectType}
- **Diretórios Chave**: ${mainDirs.join(', ') || 'Raiz'}
- **Comando de Testes**: \`${testCommand}\`
- **Comando de Execução**: \`${runCommand}\`
- **Dependências**: ${dependenciesSummary}

## ⚡ Comandos CLI do OmniCode
- **Iniciar CLI interativo**: \`omnicode\` (ou \`omni\`)
- **Executar missão direta**: \`omnicode "instrução"\`
- **Auditoria de segurança e qualidade**: \`omnicode --review\`
- **Inspeção de diffs**: \`omnicode --diff\`
- **Desfazer última alteração**: \`omnicode --undo\`

## 🛡️ Modos de Segurança e Autonomia
- **plan**: Modo somente leitura e exploração (bloqueia qualquer mutação de arquivos ou shell destrutivo).
- **approve**: (Padrão) Pede confirmação antes de gravar arquivos ou rodar comandos de alteração.
- **smart**: Permite inspeções locais e pede confirmação para exclusões ou ações de risco.
- **auto**: Autonomia total delimitada pelo workspace.

## 📐 Padrões de Código e Diretrizes
1. Faça edições cirúrgicas usando as ferramentas \`edit_file\` ou \`patch\` em vez de reescrever arquivos inteiros.
2. Sempre verifique caminhos canônicos e trate arquivos de configuração (\`.env\`) com sigilo absoluto.
3. Não use bibliotecas externas pesadas desnecessárias se houver APIs nativas disponíveis.
`;

  let finalContent = generatedDoc;
  if (existingExists && !options.force) {
    finalContent = `${existingInstructions.trim()}\n\n---\n\n## 🔄 Atualização Contextual do OmniCode (${new Date().toISOString().slice(0, 10)})\n${generatedDoc}`;
  }

  await fs.writeFile(targetPath, finalContent, 'utf-8');

  return {
    targetPath,
    alreadyExisted: existingExists,
    projectType,
    mainDirs,
    preview: finalContent
  };
}

