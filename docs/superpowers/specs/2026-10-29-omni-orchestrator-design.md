# Omni-Orchestrator — visão e especificação do projeto

**Data:** 2026-10-29

**Status:** visão em revisão; correções do plano não autorizam execução

**Pasta analisada:** `C:\Users\Daniel\.gemini\antigravity-ide\scratch\omni-orchestrator`

**Identidade proposta:** OmniCode (`omni` / `omnicode`); Omni-Orchestrator é o nome histórico do protótipo.

**Plano vinculado:** [Plano de implementação corrigido](../plans/2026-10-29-omnicode-implementation-plan.md).

## 1. Resumo da proposta

O Omni-Orchestrator será uma ferramenta **CLI-first para desenvolvimento com agentes de IA**, com uma experiência inspirada no OpenCode. A pessoa descreve uma tarefa no terminal; o programa entende o projeto, monta um plano, escolhe agentes e modelos adequados, coordena o trabalho, cria ou edita arquivos e verifica o resultado.

O requisito diferenciador é que os componentes configurados pelo usuário — provedores/modelos, agentes, skills, comandos, hooks, servidores MCP, modos e plugins — sejam descobertos em um **registro global do Omni-Orchestrator** e possam ser disponibilizados aos agentes e modelos compatíveis, em todos os projetos abertos pelo Omni-Orchestrator. Configurações específicas de um projeto poderão complementar essa base global, sem editar silenciosamente configurações de outros programas ou arquivos do usuário.

### Decisão de base recomendada

Como o objetivo declarado é oferecer uma CLI semelhante ao OpenCode e manter seus comandos prontos, a proposta é **usar o código oficial do OpenCode como base em um fork independente**, preservando a identidade OmniCode e os avisos/licença do upstream. O plano fixa OpenCode `v2.2.2`, commit `098aa7fd6e02b03d6fc410f0b052038c7d4c5e81`; a paridade é com essa base identificada, não uma promessa de acompanhar automaticamente qualquer versão futura. O esforço novo concentra-se na orquestração multiagente, configuração global e recursos adicionais.

O diretório analisado contém um protótipo independente com histórico Git local e remoto upstream; isso não o torna automaticamente um checkout do runtime OpenCode. A recomendação é mantê-lo intacto e preparar a nova base separadamente após autorização. As ideias úteis e os requisitos deste protótipo devem ser portados/adaptados; seu código não deve ser copiado sem revisão, pois há lacunas importantes de segurança e comportamento descritas abaixo.

## 2. Intenção e sucesso esperado

O problema a resolver é ter vários agentes especializados trabalhando numa tarefa de programação sem obrigar a pessoa a coordenar manualmente cada modelo. O sistema deve continuar simples para quem só quer pedir “corrige esse bug”, mas permitir controle detalhado quando a tarefa exige.

O produto será considerado bem-sucedido quando uma pessoa conseguir, pela CLI:

1. Abrir um projeto e iniciar ou retomar uma sessão.
2. Entregar uma tarefa em linguagem natural e ver o plano, agentes, modelos e ações em andamento.
3. Inspecionar o projeto e permitir alterações em arquivos com salvamento seguro e verificações reais.
4. Ajustar autonomia, modelo e esforço de raciocínio sem editar código ou JSON manualmente.
5. Reutilizar preferências e extensões globais em outros projetos abertos pela ferramenta.
6. Consultar, retomar, ramificar, exportar e apagar sessões; escolher se memórias de projeto são salvas.
7. Entender o que foi alterado, quais verificações rodaram, o que falhou e quais agentes contribuíram.

## 3. Usuários e cenário principal

O foco inicial é uma pessoa desenvolvedora usando o terminal local, inclusive no Windows, que queira delegar exploração, implementação, testes/revisão e pesquisa técnica a agentes diferentes. O cenário primário é local e interativo. Automação em CI e um servidor compartilhado podem ser extensões futuras, não pré-requisitos para a primeira versão.

## 4. Experiência desejada

### Uso cotidiano

```text
omni
> Analise este projeto, corrija o erro de login e rode os testes relevantes.
```

O orquestrador mostra um plano antes de agir quando apropriado, deixa claro quais agentes foram escolhidos e por quê, exibe progresso e termina com um resumo verificável: arquivos alterados, testes executados, falhas e próximas ações.

Uma chamada não interativa também deve ser possível para scripts e CI, por exemplo `omni run "Explique este projeto"` ou `omni run --format json "Liste os TODOs"`. Os exemplos são ilustrativos; nomes e flags finais devem seguir a compatibilidade com o OpenCode escolhido.

### Comandos e facilidade de uso

O objetivo é manter os comandos documentados pelo OpenCode — incluindo execução interativa e não interativa, sessões, autenticação/provedores, modelos, MCP, plugins, estatísticas, serviço/API, ACP, diagnóstico, atualização e desinstalação — em vez de recriar uma lista parcial com comportamentos diferentes. A lista de comandos deve ser vinculada à versão/upstream adotada e validada durante a integração.

Além deles, a experiência Omni precisa oferecer comandos fáceis de descobrir para:

- configurar preferências (`configure`/assistente inicial);
- listar e administrar agentes;
- selecionar política de modelo e esforço;
- alternar `plan`, `approve`, `smart` e `auto`;
- consultar tarefas, mensagens e estado dos agentes;
- listar/gerenciar memória e preferências persistentes;
- instalar/listar/ativar recursos globais sem duplicá-los por projeto.

Deve haver `--help`, ajuda contextual, autocomplete, comandos de sessão e saída estruturada para automação. A interface interativa precisa permitir cancelar uma tarefa sem matar o processo inteiro.

## 5. Autonomia, aprovações e esforço

### Modos propostos

| Modo | Comportamento |
| --- | --- |
| `plan` | Explora e planeja; bloqueia toda alteração e ação com efeito externo. |
| `approve` | Pede confirmação para alterações, comandos e ferramentas que mudem estado. |
| `smart` | Permite ações classificadas como seguras e pede confirmação para ações de maior risco. |
| `auto` | Executa tarefas sem confirmação rotineira dentro do escopo autorizado; nunca ignora bloqueios rígidos. |

**Diretriz do plano corrigido:** `approve` como padrão no primeiro uso. O usuário pode escolher e salvar outro padrão no assistente de configuração. Definir essa diretriz no documento não significa que sua implementação esteja validada ou autorizada nesta revisão.

O plano vinculado explicita a matriz de ações: `approve`/`smart` negam operações que exigem confirmação quando esta estiver indisponível, falhar, expirar ou for cancelada. Modos/ações desconhecidos também negam execução. `build` é um papel de agente, não um modo de autorização adicional. Shell arbitrário em `auto` depende de isolamento real; definir apenas seu diretório de execução não fornece contenção.

As permissões precisam ser verificadas na camada de execução de ferramentas, centralmente, para todos os agentes, modelos, subagentes e MCPs. Uma instrução no prompt dizendo “não edite” não é uma barreira de segurança. O modo automático não pode tornar válidos caminhos fora do projeto, contornar negações rígidas ou aprovar operações explicitamente proibidas.

### Seleção de modelos

O usuário poderá selecionar um modelo fixo ou `auto`. Em `auto`, o roteador considera tarefa, agente, capacidades declaradas pelo provedor/modelo, contexto necessário, velocidade/custo configurados e credenciais disponíveis. O roteador explica a escolha e permite substituição manual. Não deve escolher silenciosamente um modelo sem credencial ou simular uma execução como se fosse real.

O nível de raciocínio/esforço terá uma configuração simples (por exemplo, econômico, equilibrado e profundo), traduzida para parâmetros suportados pelo modelo ativo. Recursos que um modelo não oferece devem ser desativados ou explicitamente informados; a ferramenta não deve prometer que todo modelo suporta chamadas de ferramentas, visão, esforço ou o mesmo formato de resposta.

## 6. Orquestração e colaboração

O agente coordenador decompõe a missão em tarefas com dependências e critérios de conclusão. Especialistas iniciais podem incluir explorador/pesquisador, planejador, programador, testador/revisor e operador de ferramentas. O usuário pode instalar ou definir outros agentes.

Agentes recebem uma tarefa delimitada, contexto necessário, permissões e acesso a ferramentas compatíveis. Eles podem compartilhar resultados, decisões e artefatos por um canal de mensagens com remetente, tarefa, horário e estado — não por uma mistura ilimitada de todo o histórico de conversa.

Tarefas independentes podem rodar em paralelo somente quando o isolamento de arquivos e o plano de integração forem claros. Para código, worktrees ou outra forma verificável de isolamento são preferíveis; o agente coordenador resolve a integração e apresenta conflitos. Agentes que compartilham a mesma pasta não devem editar arquivos simultaneamente sem coordenação explícita.

O sistema deve limitar profundidade de delegação, número de agentes simultâneos, passos, tempo e orçamento configurável. Cancelar a sessão deve interromper chamadas/ferramentas canceláveis e deixar o estado da tarefa registrado.

## 7. Configuração global e compatibilidade

### Escopos

1. **Global do usuário:** provedores, modelos, agentes, comandos, skills, hooks, MCPs, plugins, modo padrão e preferências; disponível em todos os projetos executados pelo Omni-Orchestrator naquela instalação.
2. **Projeto:** instruções, agentes ou extensões específicas do repositório; carregadas apenas nesse projeto e sujeitas às políticas globais.
3. **Sessão:** modelo, esforço, tarefas e permissões temporárias selecionadas para uma conversa.

A ordem de precedência, as colisões de nomes e o que pode ou não ser sobrescrito devem ser explícitos. Políticas globais de bloqueio têm precedência sobre configuração de projeto e decisão do agente.

O plano define uma configuração canônica por escopo, com diretórios de configuração/dados/cache separados, catálogos distintos para recursos declarativos e executáveis e importação opt-in das configurações legadas. Não haverá armazenamento de chaves em JSON; usar cofre do sistema ou referências a variáveis de ambiente.

O Omni-Orchestrator deve carregar seus próprios recursos globais e poderá oferecer importação/compatibilidade com formatos comuns de skills, instruções, MCP e agentes, quando suas estruturas forem compatíveis. A importação deve ter prévia e consentimento. “Disponível para todos os agentes/modelos” significa todos os agentes executados dentro do Omni-Orchestrator **e somente capacidades que o modelo/provedor aceita**; não significa alterar automaticamente Claude Code, Antigravity, OpenCode instalado separadamente ou qualquer outro aplicativo.

## 8. Sessões e memória

São conceitos diferentes e precisam ser administrados separadamente:

- **Histórico de sessão:** transcrição, estado das tarefas, agentes usados, modelos, chamadas de ferramenta e resultados; permite listar, renomear, retomar, ramificar, exportar e remover sessões.
- **Memória do projeto:** decisões, convenções e fatos duráveis que ajudam sessões futuras daquele projeto.
- **Memória do usuário:** preferências globais que não dependem de um repositório.
- **Memória de agente:** opcional e escopada, sem compartilhamento implícito de informação sensível entre projetos.

Memórias devem ser curtas, consultáveis, auditáveis e removíveis. O sistema não deve salvar todo o conteúdo por padrão como “memória”; instruções permanentes, memória aprendida e transcrição têm funções e retenções diferentes. Não deve enviar memória, código ou histórico para serviços externos sem uma ação que deixe isso claro.

Persistência definida no plano: reutilizar o SQLite do runtime em diretório privado de dados OmniCode, com migrações versionadas e separação por projeto. JSONL é formato de intercâmbio, não um armazenamento concorrente de sessões.

## 9. Plugins, hooks, skills e MCP

O núcleo disponibiliza um registro global de recursos e um modelo de permissões comum. Skills são instruções carregadas quando relevantes; comandos são ações nomeadas e descobríveis; hooks são eventos de ciclo de vida com entradas/saídas definidas; plugins empacotam recursos e ferramentas; MCP conecta ferramentas locais/remotas e pode incluir autenticação.

O caminho preferencial é adotar padrões e SDKs documentados em vez de manter protocolos próprios de forma incompleta. Segredos de provedores e servidores devem ficar em variáveis de ambiente ou armazenamento seguro do sistema, nunca em exemplos, logs, histórico ou arquivos compartilhados sem proteção.

## 10. Segurança e privacidade — requisitos obrigatórios

- Validar caminhos canônicos e impedir escape do workspace por `..`, caminho absoluto, link simbólico ou ferramenta MCP, exceto após permissão explícita.
- Executar comandos com diretório delimitado, limites de tempo/saída e política baseada em comandos analisados; não confiar em busca textual simples por `rm`, `git push` ou equivalentes.
- Pedir autorização antes de gravar, excluir, instalar dependências ou fazer ações externas de impacto; fornecer “uma vez” e “sempre neste projeto” como opções distintas e revogáveis.
- Não gravar credenciais em arquivos de configuração, não exibir partes de chaves no terminal e não incluir segredos em exportações/diagnósticos.
- Registrar ferramentas, aprovações, negações, modelos e mudanças em sessão; permitir cancelar a execução.
- Não afirmar que revisão, teste, execução ou mitigação de risco aconteceu sem evidência da operação correspondente.
- Preservar arquivos do usuário; `/init` e comandos equivalentes devem mostrar uma prévia e não sobrescrever instruções existentes sem aprovação.

## 11. Análise do protótipo — estado revalidado

Análise somente leitura do código no commit local `3415987aef56cb566f85fd4023e664373cc5fc04`. O projeto mudou desde o primeiro inventário; esta seção substitui as conclusões antigas sobre ausência de Git, testes e handlers. Nesta revisão foram alterados apenas documentos. Nenhuma suíte de testes foi executada.

### O que já existe e serve como referência

- `README.md` e `package.json`: identificam o produto como CLI multiagente/multimodelo chamado `omni`, com execução interativa e direta.
- `src/core/orchestrator.js`: agente supervisor, decomposição de subtarefas, escolha de especialistas e compartilhamento de um snapshot de contexto.
- `src/core/router.js` e `src/models/provider.js`: catálogo de modelos e adaptadores para Anthropic, Gemini e APIs compatíveis com OpenAI, incluindo modelos locais.
- `src/hub/registry.js`, `src/hub/skill_loader.js` e `src/hub/mcp_client.js`: intenção de oferecer ferramentas, skills e MCP a múltiplos agentes.
- `src/core/memory.js`: estado de tarefas, contribuições e notas, além de um formato de exportação Markdown.
- `src/cli/terminal_ui.js`: prompt interativo, cores e eventos de progresso.
- `src/core/security.js`, `config_manager.js`, `reviewer.js` e `init_helper.js`: implementações recentes de permissões, configuração global, varredura estática de código e inspeção do projeto.
- `tests/security_and_modes.test.js` e `package.json`: testes Node e comando `npm test` já presentes, sem resultado de execução ou cobertura atestado nesta revisão.

Esses elementos confirmam uma estrutura de protótipo, não um repositório vazio. Não comprovam segurança, paridade com OpenCode ou conclusão das fases. Servem de referência para a migração e não devem ser recriados nem tratados como corrigidos sem avaliação.

### Lacunas e riscos encontrados

| Severidade | Evidência observada | Implicação para o projeto |
| --- | --- | --- |
| **Crítica** | `resolveCanonicalPath` em `src/core/security.js:15-41` canonicaliza a raiz, mas não resolve links do alvo/ancestrais; também converte todos os caminhos para minúsculas e cria a raiz ao validar. | Testar links/junctions, arquivos novos, caixa de letras e ausência de efeitos na validação; substituir a proteção apenas lexical por contenção compatível com o sistema de arquivos. |
| **Crítica** | `enforcePermission` em `src/core/security.js:100-166` permite uma mutação em `approve` sem callback; `smart` deixa passar ações sem confirmação e modos desconhecidos terminam em permissão. | Aplicar fail-closed, matriz explícita de ações e negações rígidas antes de habilitar autonomia. |
| **Crítica** | `src/hub/shell_tools.js` valida `cwd`, mas executa `exec`; argumentos, scripts e subprocessos ainda podem acessar recursos externos. `classifyCommandRisk` em `src/core/security.js` usa prefixos que incluem comandos mutativos conforme argumentos. | Não descrever o shell como sandbox. Exigir análise e isolamento real ou restringir shell arbitrário sem supervisão. |
| **Alta** | `/review` agora usa `src/core/reviewer.js` para ler código e detectar padrões; não executa lint/testes/diff. O revisor lê `response.content`, enquanto o adaptador retorna `text`, e erros de leitura podem ser ignorados. | Reconhecer a análise estática existente, testar a integração semântica e informar verificações ausentes/falhas; não promover “nenhum padrão detectado” a aprovação de segurança. |
| **Alta** | O provider agora lança erro quando falta chave sem simulação (`src/models/provider.js:35-54`); o modo simulado continua capaz de produzir ferramentas e resultados predefinidos. | Não afirmar que ainda há fallback silencioso por falta de chave. Cobrir a mudança por testes e manter demonstração explicitamente rotulada/isolada dos dados reais. |
| **Alta** | A memória é reiniciada para cada missão em `executeMission`; a lista de sessões e dados não têm persistência visível. | Sessões retomáveis e memória entre sessões exigem armazenamento e política de retenção novos. |
| **Alta** | `ConfigManager` já resolve escopo global/projeto, mas inicializa o global copiando arquivos do projeto, tem políticas de merge diferentes por tipo e mistura formato `mcpServers` com o legado `servers`. | Migração opt-in, origem/precedência explícitas e testes de schemas; não copiar configurações de projeto para o global automaticamente. |
| **Alta** | `/connect` ainda usa `saveEnvKey` em `src/index.js:48-70`, que grava no `.env` do diretório atual. | Planejar entrada mascarada, cofre do SO e referências de ambiente; não salvar segredos em arquivos compartilhados ou histórico. |
| **Alta** | O arquivo de ferramentas já chama o módulo de permissões; o undo usa pilha em memória e grava diretamente. `inspectAndInitRepository` agora inspeciona o projeto, mas também regrava/adiciona conteúdo em `AGENTS.md` sem autorização central própria (`src/core/init_helper.js:93-98`). | Conferir todos os caminhos de mutação, inclusive comandos fora do loop de ferramentas; não confundir preservação textual com autorização para gravar. |
| **Média** | O supervisor executa subtarefas em série e os agentes recebem snapshots; não foi encontrado um protocolo de mensagens entre sessões/agentes. | Implementar coordenação explícita e isolamento antes de chamar o comportamento atual de colaboração paralela. |
| **Média** | `src/hub/mcp_client.js` implementa comunicação MCP manual com espera fixa de 500 ms e resposta por escuta de stdout; não foi encontrado um roteador robusto de IDs/respostas. | Adotar cliente MCP oficial e tratar inicialização, concorrência, timeout, erro e encerramento segundo o protocolo. |
| **Média** | `/diff`, `/undo`, `/compact`, `/connect` e `/export` existem no despachante. Diff recorre a uma listagem quando não há diff Git; undo só dura no processo; compactação resume o estado da missão, não uma transcrição persistente completa. | Manter a descrição factual, criar testes por comando e não prometer recursos de sessão que esses handlers não implementam. |
| **Alta** | Há testes, mas não cobrem falta/negação/timeout de aprovação, links/junctions, modos desconhecidos ou contenção de shell. O teste de `ConfigManager` inicializa diretórios globais reais se não houver isolamento. | Escrever testes de bypass desde a Fase 2 e executar toda suíte com diretórios temporários privados, nunca com o perfil real inadvertidamente. |
| **Média** | A pasta já possui Git, `prototype/`, binários e commits locais. Isso não demonstra que o runtime corresponde ao OpenCode. O protótipo usa Node; a base `v2.2.2` declara Bun `1.4.4` em um monorepo. | Preservar o histórico local e integrar checkout upstream separado; não trocar seu `package.json` diretamente pelo do protótipo. |

Os arquivos de exemplo em `workspace/` foram tratados como conteúdo existente do usuário e não foram alterados.

## 12. Fronteiras do escopo

### Incluído no produto-alvo

- CLI interativa e execução não interativa, com comandos compatíveis com o OpenCode upstream adotado.
- Configuração global e de projeto, com precedência/documentação claras.
- Agentes especialistas, coordenação, mensagens, tarefas, escolha de modelos e esforço configurável.
- Política de permissões aplicada centralmente, com modos de aprovação, limites, cancelamento e trilha de auditoria.
- Descoberta global e por projeto de skills, comandos, hooks, MCPs e plugins no âmbito do Omni-Orchestrator.
- Persistência de sessões e memórias separadas por escopo, com controles de busca, exportação e remoção.
- Inspeção, escrita e verificação de código com isolamento e evidência real.

### Fora da primeira versão, salvo confirmação posterior

- Aplicativo desktop próprio, sincronização remota/cloud e serviço multiusuário.
- Execução autônoma com acesso irrestrito ao computador ou à rede.
- Suporte garantido a todo modelo existente, inclusive modelos sem uso de ferramentas.
- Migração automática ou alteração de configurações globais de outras ferramentas/IDEs.
- Compatibilidade de plugins que dependam de APIs privadas ou diferentes das suportadas pelo upstream.

### Anti-objetivos

- Sugerir afiliação com os mantenedores OpenCode ou reutilizar suas marcas como identidade própria; o reaproveitamento de código/TUI deve respeitar a licença aplicável.
- Exibir sucesso simulado como se fosse execução real.
- Publicar, instalar, apagar, fazer push ou contatar serviços externos sem política e autorização adequadas.
- Prometer “qualquer modelo” sem verificar recursos/capacidades do provedor.
- Copiar para a nova base ferramentas inseguras do protótipo por conveniência.

## 13. Restrições e escolhas de implementação

- A base do runtime é OpenCode `v2.2.2`, commit `098aa7fd6e02b03d6fc410f0b052038c7d4c5e81`, conforme o plano vinculado; o fork deve manter referência ao upstream, avisos de licença e identidade independente.
- O protótipo atual permanece preservado até existir cópia/branch ou plano de migração aprovado. Não presumir que seu código funciona como plugin do OpenCode.
- O produto será local-first no início. Configuração global é por usuário e máquina; dados entre máquinas não se sincronizam automaticamente.
- O armazenamento persistente e os diretórios de configuração devem seguir os diretórios de usuário apropriados de cada sistema operacional; não fixar caminhos do computador do autor no código ou nas instruções.
- Compatibilidade de provedores precisa ser declarada por capacidade (tools, visão, esforço, limite de contexto, etc.) em vez de inferida apenas pelo nome do modelo.
- O padrão de execução inicial proposto é aprovação antes de mutações. Políticas de negação rígida nunca são removidas pelo modo `auto`.
- O comando de revisão só pode afirmar aprovação após rodar as verificações/revisão configuradas e expor seus resultados.

## 14. Critérios de aceitação do produto

1. **CLI e compatibilidade:** a instalação abre o terminal interativo; cada comando OpenCode prometido está presente, documentado e coberto por teste de interface/CLI. Mudanças do upstream são rastreáveis.
2. **Escopo global:** recursos habilitados globalmente aparecem em novos projetos Omni; recursos de projeto permanecem isolados; bloqueios globais não podem ser anulados pelo projeto.
3. **Agentes e colaboração:** uma tarefa produz plano visível, atribuições rastreáveis, resultados por agente e síntese final; tarefas independentes só concorrem em execução isolada ou coordenada.
4. **Roteamento:** `auto` escolhe apenas modelo disponível e compatível, explica a decisão e aceita override; falta de credencial/capacidade gera aviso ou erro verdadeiro, nunca sucesso de demonstração oculto.
5. **Permissões:** modo `plan` não altera arquivos nem realiza mutações por shell, MCP ou plugin; testes tentam escapes de caminho, links simbólicos, comandos compostos e negações.
6. **Aprovação:** `approve`, `smart` e `auto` têm comportamento observável e configurável; o padrão inicial pede aprovação para mudanças.
7. **Sessões/memória:** sessão pode ser listada, retomada, ramificada, exportada e apagada; memória global, do projeto e de agente é claramente separada e removível.
8. **Verificação:** saída de revisão contém arquivos realmente inspecionados e verificações executadas; código de saída e falhas são preservados; nenhum resultado é inventado.
9. **Credenciais:** chaves não aparecem em logs, terminal, exportações ou arquivos versionados; `status` informa apenas presença/validade sem revelar trechos.
10. **Multiplataforma:** os fluxos principais são validados em Windows/PowerShell e em ao menos macOS/Linux ou ambiente equivalente, incluindo cancelamento e paths com espaços.

## 15. Referências consultadas

### OpenCode — fonte primária para a base e comandos

- [Repositório oficial](https://github.com/anomalyco/opencode)
- [CLI e comandos](https://opencode.ai/v2/docs/cli/)
- [Referência de subcomandos](https://opencode.ai/v2/docs/cli/commands/)
- [Agentes](https://opencode.ai/v2/docs/agents/)
- [Configuração](https://opencode.ai/v2/docs/config/)
- [Permissões](https://opencode.ai/v2/docs/permissions/)
- [Modelos e variantes](https://opencode.ai/v2/docs/models/)
- [Skills](https://opencode.ai/v2/docs/skills/)
- [Comandos customizados](https://opencode.ai/v2/docs/commands/)
- [Plugins](https://opencode.ai/v2/docs/plugins/)
- [MCP](https://opencode.ai/v2/docs/mcp-servers/)
- [Plugins de servidor e hooks](https://opencode.ai/v2/docs/build/plugins/server)

### Referências de comparação

- [Claude Code — memória](https://code.claude.com/docs/en/memory), [agentes](https://code.claude.com/docs/en/sub-agents) e [mensagens entre sessões](https://code.claude.com/docs/en/cross-session-messaging)
- [Claude Code — hooks](https://code.claude.com/docs/en/hooks) e [plugins](https://code.claude.com/docs/en/plugins/overview)
- [Goose — comandos CLI/sessões](https://goose-docs.ai/docs/guides/goose-cli-commands/), [modos de permissão](https://goose-docs.ai/docs/guides/managing-tools/goose-permissions/) e [Chat Recall](https://goose-docs.ai/docs/mcp/chatrecall-mcp/)
- [Aider — comandos](https://aider.chat/docs/usage/commands.html) e [modos de conversa](https://aider.chat/docs/usage/modes.html)
- [OpenHands — CLI](https://docs.all-hands.dev/usage/how-to/cli-mode)

## 16. Diretrizes consolidadas no plano corrigido

1. **Base:** fork independente do repositório oficial, identidade OmniCode, base `v2.2.2` fixada por SHA; preservar a pasta/histórico atuais e preparar a integração em checkout separado.
2. **Autonomia:** `approve` inicial e negação quando confirmação estiver indisponível; `plan`, `smart` e `auto` obedecem à matriz e às políticas rígidas do plano.
3. **Paridade:** todos os comandos CLI da base fixada como meta verificável por contrato, inclusive serviço/API/ACP/diagnóstico, respeitando namespace e distribuição OmniCode.
4. **Configuração e persistência:** diretórios por SO definidos no plano, SQLite reaproveitado do runtime e credenciais no cofre do sistema/ambiente, nunca em JSON.
5. **Verificação:** testes desde a primeira alteração, gates por fase e distinção entre funcionalidades existentes, verificadas, incompletas e planejadas.

O usuário solicitou corrigir primeiro o plano, não executar. A implementação, migração, mudança de arquivos de código e configuração global continuam pendentes de autorização explícita.
