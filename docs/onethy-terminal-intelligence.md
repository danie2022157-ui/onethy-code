# OnethyCode: integração Copilot (terminal)

Este incremento reutiliza a arquitetura existente de serviços do OnethyCode. Não depende do VS Code e não incorpora código do Copilot.

## Ferramenta nova: omni_intelligence

Disponível para agentes quando OMNICODE_ACTIVE=1. A ferramenta tem as ações:

- code: busca local por intenção e tokens de identificadores, com caminhos e linhas. É recuperação lexical enriquecida, **não** embeddings vetoriais; a qualidade pode variar por idioma e nomes do projeto.
- tools: catálogo contextual das tools registradas, skills e MCPs conectados. Descobrir uma ferramenta não autoriza executá-la.
- history: pesquisa em .omnicode/sessions, missions, plans e memory-bank do projeto. Não pesquisa automaticamente toda a base de conversas histórica do aplicativo.
- review: mostra alterações staged e unstaged sem modificá-las. Arquivos untracked aparecem na lista, sem seu conteúdo no diff. Aprovação/rejeição é feita pela interface de revisão existente.
- metrics: eventos recentes do barramento de agentes e estado de tarefas da missão. Tokens e custos continuam no painel/telemetria de uso nativos.

Exemplos de solicitações ao agente:
- "Use omni_intelligence action=code query='login do usuário' para achar a função de autenticação."
- "Use omni_intelligence action=tools query='automação no navegador' para localizar ferramentas disponíveis."
- "Use omni_intelligence action=history query='decisão de arquitetura' para recuperar notas anteriores."
- "Use omni_intelligence action=review antes de finalizar a implementação."
- "Use omni_intelligence action=metrics missionID='mission-123' para verificar os eventos e tarefas."

## Recursos existentes, preservados

- Agentes e subagentes: ferramentas subagent, omni_mission e OmniOrchestrator.
- Paralelismo: estágios paralelos planejados pelo orquestrador e sessões-filhas gerenciadas pelo serviço de jobs. A reserva de tarefa não equivale à execução.
- Autocorreção: omni_heal identifica falhas de testes e orienta o agente implementador; ainda exige a edição real e execução novamente, não é um loop autônomo garantido.
- Memória: omni_memory e OmniMemoryBank; escopos de projeto e global já existem.
- Worktrees: infraestrutura Worktree/WorktreeStrategies; isolamento automático para toda chamada de subagente ainda precisa de integração/validação específica.
- Planejamento, políticas, aprovações e histórico: serviços nativos Plan, Permission, Session e Review UI.

## Segurança e limites

A busca não lê symlinks, .env, nomes de credenciais, nem diretórios gerados conhecidos. Os limites são 1.200 arquivos e 8 MiB de texto por consulta, com 128 KiB por arquivo. Não há comando de shell dinâmico na busca. A revisão roda apenas git status e git diff com argumentos fixos. Nenhuma ação desta ferramenta concede permissões, executa ferramentas externas ou aprova mudanças.

Para validar no checkout: bun test packages/core/test/omni-intelligence.test.ts. Execute typecheck completo separadamente. Consulte a cobertura parcial acima antes de considerar todas as 12 capacidades prontas para produção.
