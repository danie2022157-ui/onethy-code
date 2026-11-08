# OnethyCode — reparo de personalizações AITmpl

Esta correção separa **instalação**, **registro**, **seleção** e **execução real**. Um item listado no inventário não significa que foi executado.

## Instalação e atualização Windows

No PowerShell, dentro da pasta `onethy-code`:

~~~powershell
git pull --ff-only origin main
bun install --frozen-lockfile
.\install.ps1
onethy
~~~

A partir desta versão, `install.ps1` chama a sincronização nativa opcional depois que o instalador já criou o inicializador. Ela não depende mais das variáveis ausentes durante `bun install`.

- A importação é idempotente: arquivos existentes não são sobrescritos.
- Scripts de hooks/plugins externos não são executados.
- MCPs importados vêm **desativados**, exigindo aprovação individual.
- Falhas de rede durante a importação não invalidam a instalação da CLI: o aviso aparece no terminal.
- Os arquivos são instalados no diretório de configuração do **OnethyCode** (não no OpenCode).
- Para impedir a sincronização opcional: defina `ONETHY_SKIP_CUSTOMIZATION_SYNC=1` antes de executar o instalador.
- Em CI não ocorre download de personalizações durante a instalação; os testes usam um catálogo local isolado.

Também pode iniciar a partir do CMD, chamando PowerShell explicitamente:

~~~bat
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
~~~

## Reparação dos agentes antigos

Nas versões anteriores, vários agentes AITmpl foram gravados como `mode: primary`, com descrição genérica `Imported AITmpl agents component`. Eles ficavam no seletor de agentes principais e não podiam ser chamados como subagentes.

O OnethyCode agora **normaliza somente agentes com essa assinatura exata e frontmatter legível**, em tempo de execução. A compatibilidade:

- preserva os arquivos e qualquer agente criado ou modificado por você;
- recupera a descrição específica a partir do metadata original;
- disponibiliza esses especialistas como `subagent`;
- remove regras genéricas `*/* allow` dos agentes legados identificados;
- impede que esses agentes façam delegações recursivas ou abram perguntas do agente principal;
- mantém autorizações individuais, escolhas de modelos e políticas de projeto.

O adaptador é reversível usando `ONETHY_LEGACY_AGENT_COMPAT=off` ao iniciar o serviço. Essa opção restaura os agentes antigos como estavam registrados e não altera seus arquivos.

## Descoberta inteligente

No chat do OnethyCode, peça:

~~~text
Use omni_intelligence action=customizations para mostrar quantos agentes, skills, comandos e MCPs estão realmente registrados.
~~~

Para pesquisar:

~~~text
Use omni_intelligence action=customizations query="Python FastAPI" limit=10
~~~

Para delegação com seleção conservadora:

~~~text
Use subagent agent=auto description="Verificar API Python" prompt="Revise os endpoints FastAPI e a validação de entradas; não edite arquivos sem as permissões necessárias."
~~~

A seleção é determinística e **não consome uma chamada extra ao LLM**; usa nomes de especialidades e não executa instruções não confiáveis contidas nas descrições. Se não encontrar uma correspondência única, utiliza o subagente `general`. `ONETHY_CUSTOMIZATION_ROUTING=off` desativa essa seleção para `agent=auto` e usa o `general`.

Um identificador explícito como `subagent agent=frameworks-react-specialist` continua prevalecendo; os modelos escolhidos pelo usuário não são substituídos pela seleção do agente.

## Windows CMD x PowerShell

Se o terminal mostra `C:\Users\...>` você provavelmente está no CMD. Comandos `Get-ChildItem` funcionam no PowerShell, não como comandos diretos no CMD.

Use estes comandos em ambos os terminais:

~~~bat
onethy debug paths
onethy debug agents
onethy mcp list
~~~

No CMD, conte as skills usando:

~~~bat
powershell -NoProfile -Command "(Get-ChildItem (Join-Path $env:APPDATA 'omnicode\skills') -Recurse -Filter SKILL.md -File -ErrorAction SilentlyContinue | Measure-Object).Count"
~~~

Se `debug paths` informar um diretório diferente, use aquele caminho no comando.

Oito MCPs importados podem aparecer como `disabled`. Isso é intencional e não indica falha de carregamento. Só habilite serviços que realmente utiliza, com autorização e credenciais apropriadas.

## Verificação

Testes automatizados:

~~~bash
node --test script/onethy-customizations.test.mjs
node --test script/onethy-customizations-bootstrap.test.mjs
bun --cwd packages/core test test/onethy-agent-compat.test.ts test/specialist-router.test.ts
bun --cwd packages/core run typecheck:tsc
~~~

Esses testes também fazem parte da suíte Ubuntu/Windows do GitHub Actions.

**Limites:** o carregamento de uma personalização não garante que o modelo vá invocá-la em todas as solicitações. A execução depende da tarefa, da decisão do agente, das permissões e da disponibilidade de MCPs. O novo inventário mostra claramente o que está registrado, e a sessão registra as invocações reais. Personalizações de hooks/mods/plugins só executam se houver adaptadores nativos compatíveis e habilitados.

## Descoberta contextual automática (runtime)

Com `OMNICODE_ACTIVE=1`, a nova integração de personalizações usa o gancho
nativo `session.prompt` para avaliar **cada nova tarefa** (inclusive as de
subagentes) contra o catálogo realmente registrado:

- A pesquisa é local, determinística e limitada por relevância.
- **A quantidade de skills é determinada automaticamente**, sem o antigo limite de duas:
  o motor combina relevância e diversidade das skills com uma reserva
  proporcional à janela de contexto do modelo selecionado e à complexidade
  da tarefa. Skills muito grandes, redundantes ou que não cabem são apenas
  sugeridas para carregamento posterior, não anexadas silenciosamente.
- Skills próprias para autoinvocação só entram automaticamente quando a
  permissão efetiva `skill:<id>` é explicitamente `allow`. Skills com
  permissão `ask` ou `deny` não são anexadas automaticamente; o fluxo
  normal de autorização é preservado.
- O orçamento é **uma estimativa conservadora**, pois o gancho de prompt ainda
  não conhece com exatidão os tokens do histórico completo; há tetos de
  tamanho total e individual para manter o modelo operacional.
- Subagentes especializados são recomendados apenas quando a
  correspondência é inequívoca; a ferramenta `subagent agent=auto`
  continua selecionando o especialista na delegação real.
- Apenas ferramentas MCP de servidores **conectados** entram nas sugestões.
  O mecanismo não inicia servidores desabilitados, não instala pacotes e não
  executa hooks, comandos slash, mods ou settings sem uma ação autorizada.
- Templates da categoria `loops` agora são importados no diretório nativo
  `loops/`, já reconhecido pelo carregador de comandos; são invocados
  através da interface de comandos, e não executados ao importá-los.
- As escolhas são gravadas na metadata imutável da mensagem,
  `onethy.personalizations`, distinguindo recomendações de anexos realmente
  preparados. O log de depuração emite `onethy.personalizations.selected`.

Para diagnosticar no chat:

~~~text
Use omni_intelligence action=customizations para apresentar o inventário,
as chamadas reais a skill/subagent/omni_mcp e as seleções contextuais
registradas nas sessões recentes.
~~~

O resumo de seleções é **uma amostra limitada** das sessões recentes;
as chamadas de ferramentas seguem sendo contadas separadamente nos últimos
sete dias. Um skill anexado não significa que o modelo seguiu suas instruções,
e o modelo ainda precisa decidir quando a delegação é útil.

Para desativar apenas a descoberta automática (sem remover recursos):

~~~powershell
$env:ONETHY_CUSTOMIZATION_AUTONOMY="off"
onethy
~~~

A configuração de permissões, os modelos definidos pelo usuário e o estado
real dos provedores continuam prevalecendo. Nenhuma aprovação é inferida
a partir da simples instalação de um recurso.

### Como a seleção dinâmica decide

O planejamento é repetido no início de cada novo prompt, incluindo os dos subagentes.
As sugestões são ordenadas por correspondência com a tarefa; skills quase idênticas
não são anexadas juntas. A reserva usa a janela de contexto informada pelo
modelo, caso conhecida, e desconta o tamanho do pedido e skills anexadas
manualmente. O orçamento total para inclusão automática mantém um teto
conservador de caracteres: **não há limite fixo de quantidade de skills**.

Skills que não couberem continuam disponíveis para a ferramenta `skill` quando
uma etapa posterior precisar delas. Isso não garante que o modelo vá escolher
qualquer skill sugerida nem substitui a autorização de ferramentas.
