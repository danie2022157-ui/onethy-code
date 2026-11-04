# OnethyCode: integração Copilot (terminal)

Este incremento reutiliza a arquitetura existente de serviços do OnethyCode. Não depende do VS Code e não incorpora código do Copilot.

## Ferramenta nova: omni_intelligence

Disponível para agentes quando OMNICODE_ACTIVE=1. A ferramenta tem as ações:

- code: busca local por intenção e tokens de identificadores, com caminhos e linhas. É recuperação lexical enriquecida, **não** embeddings vetoriais; a qualidade pode variar por idioma e nomes do projeto.
- tools: catálogo contextual das tools registradas, skills e MCPs conectados. Descobrir uma ferramenta não autoriza executá-la.
- history: pesquisa nas conversas do próprio serviço de sessões (até 30 sessões recentes, 30 mensagens por sessão), além de .omnicode/sessions, missions, plans e memory-bank. A busca é limitada ao projeto atual e não cobre toda a conta.
- review: mostra alterações staged e unstaged sem modificá-las. Arquivos untracked aparecem na lista, sem seu conteúdo no diff. Aprovação/rejeição é feita pela interface de revisão existente.
- metrics: eventos recentes do barramento de agentes, estado de tarefas e somas dos registros de uso (tokens e custo em USD) até 30 sessões recentes e 50 mensagens por sessão. Não representa faturamento exato nem consumo em tempo real.

Exemplos de solicitações ao agente:
- "Use omni_intelligence action=code query='login do usuário' para achar a função de autenticação."
- "Use omni_intelligence action=tools query='automação no navegador' para localizar ferramentas disponíveis."
- "Use omni_intelligence action=history query='decisão de arquitetura' para recuperar notas anteriores."
- "Use omni_intelligence action=review antes de finalizar a implementação."
- "Use omni_intelligence action=metrics missionID='mission-123' para verificar os eventos e tarefas."

## Recursos existentes, preservados

- Agentes e subagentes: ferramentas subagent, omni_mission e OmniOrchestrator.
- Dependências reais: `omni_mission action=create` aceita `goal`, `missionID` e tarefas `id`, `title`, `assignedAgent`, `dependsOn`. O grafo é validado, persistido e executável em lotes pelo controle `claim` com dependências satisfeitas (o `claim` não executa sozinho os agentes).
- Paralelismo: estágios paralelos planejados pelo orquestrador e sessões-filhas gerenciadas pelo serviço de jobs. A reserva de tarefa não equivale à execução.
- Autocorreção: `omni_heal action=run_and_heal autoFix=true maxAttempts=3` delega a falha ao subagente `coder` e reexecuta os testes. Requer permissões para `shell` e `subagent`; não garante que toda falha possa ser corrigida. Sem `autoFix=true`, retorna diagnóstico sem editar.
- Memória: omni_memory e OmniMemoryBank; escopos de projeto e global já existem.
- Worktrees: `subagent worktree=true` cria Git worktree com infraestrutura nativa e move a nova sessão filha para lá, verificando a localização antes de programar. `ONETHY_AGENT_WORKTREES=1` ativa automaticamente para novos subagentes `coder` sob OMNICODE_ACTIVE. Requer permissões; worktrees não são apagadas automaticamente, pois as alterações exigem revisão. O caminho é informado no resultado.
- Planejamento, políticas, aprovações e histórico: serviços nativos Plan, Permission, Session e Review UI.

## Segurança e limites

A busca não lê symlinks, .env, nomes de credenciais, nem diretórios gerados conhecidos. Os limites são 1.200 arquivos e 8 MiB de texto por consulta, com 128 KiB por arquivo. Não há comando de shell dinâmico na busca. A revisão roda apenas git status e git diff com argumentos fixos. Nenhuma ação desta ferramenta concede permissões, executa ferramentas externas ou aprova mudanças.

Para validar no checkout: `bun --cwd packages/core test test/omni-intelligence.test.ts test/omni-task-graph.test.ts`, `bun --cwd packages/core run typecheck:tsc` e suíte `onethy-smoke` em Linux e Windows. Há testes de utilitários e typecheck, mas o fluxo completo com modelos reais, subagentes e sessões/worktrees em múltiplos ambientes ainda exige testes de integração antes de produção.
