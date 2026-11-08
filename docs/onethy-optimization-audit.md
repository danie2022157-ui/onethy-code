# OnethyCode — auditoria conservadora de código, pacotes e arquivos

Data da inspeção: 2026-11-07. Fonte: árvore Git da branch main e manifests reais do repositório. A análise é **estática**: sem métricas locais de CPU/RAM, sem afirmar que pacotes de outras aplicações são inúteis.

## Inventário confirmado

- Diretório `packages/`: **8.774 arquivos versionados**, **143.238.123 bytes**. Não inclui `node_modules`, cache, perfil de usuário nem executáveis instalados.
- `packages/console/`: **46.102.858 bytes** e 213 arquivos. Três vídeos promocionais ocupam juntos **42.184.159 bytes**. Pelo menos o vídeo `opencode-comparison-min.mp4` é referenciado em `packages/console/app/src/routes/zen/index.tsx`. Não excluir sem reestruturar o site.
- `packages/core/`: **16.701.164 bytes** e 911 arquivos; `src/models-dev/snapshot.txt` (~8,2 MB) é referenciado em scripts de snapshots e fornece dados de modelos. **Manter.**
- `packages/tui/`: **4.487.379 bytes** e 571 arquivos. CLI e servidor são outros pacotes distintos.
- `prototype/`: **194.745 bytes** em 26 arquivos, com `package.json` próprio (OmniCode 1.0.0). Não pertence aos workspaces definidos na raiz; o launcher atual `bin/onethy.js` inicializa `packages/cli/src/index.ts`. **Candidato a arquivamento**, não prova de que ninguém usa seus testes ou exemplos.
- `salesforce/`: **30.715 bytes** de metadados Salesforce para a Console. Não pertence à TUI, mas serve a um fluxo de CRM/deploy independente. **Manter**.
- `services/changelog/.wrangler/`: sete blobs gerados pelo cache Miniflare/SQLite, ~122 KB, estavam versionados. **Removidos do Git** e protegidos por `**/.wrangler/` no `.gitignore`.

## Performance, instalação e validação

O `.husky/pre-push` executa sempre `bun run check`, que inclui lint e typecheck de todo o monorepo. Isso aumenta o tempo de push, mas preserva proteção contra erros em dependentes. **Mantido por segurança**. Medir antes de alterar.

O `postinstall` chama o bootstrap de personalizações, mas esse script contém guardas de instalação Onethy e não sincroniza o catálogo em instalações normais. **Manter**.

A TUI importa várias funcionalidades, algumas dinamicamente. A lista de pacotes fora do grafo **declarado** de dependências da CLI não significa código morto: Web, Desktop, Console, ferramentas de build, plugins e testes podem ter pontos de entrada próprios. Não é seguro remover dependências com base apenas em busca textual.

## Falha de teste identificada e corrigida

`packages/core/test/omni-orchestrator.test.ts` esperava que o **primeiro** evento de status de uma tarefa fosse `completed`. A implementação emite corretamente `running` ao reivindicar a tarefa e `completed` quando ela termina. O teste foi ajustado para verificar a sequência e o evento final, sem modificar o orquestrador de produção.

## Auditoria repetível

`node script/onethy-audit-unused.mjs` imprime o inventário e candidatos de inspeção.
`node script/onethy-audit-unused.mjs --json` produz JSON detalhado: grupos, grafo declarado de runtime da CLI, arquivos grandes, arquivos locais duplicados por SHA e caches rastreados.
`node script/onethy-audit-unused.mjs --check-generated` falha caso novos caches Wrangler/Turbo sejam adicionados ao Git. O comando não remove nada automaticamente.

## Próximas fases recomendadas (requerem medição)

1. Medir tempo de cold-start da TUI, inicialização do Core, memória em idle e frequência de chamadas HTTP. Não há valores medidos nesta auditoria.
2. Mapear todas as importações dinâmicas e recursos usados por Web/Console/Desktop antes de separar builds ou ativos.
3. Avaliar arquivar `prototype/` em outro lugar somente após confirmar a ausência de consumidores externos e valor histórico.
4. Reavaliar o hook de pre-push por pacotes afetados **somente** após confirmar cobertura equivalente na CI.
