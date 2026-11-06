# Autonomia MCP do OnethyCode

O agente `omni_mcp` complementa o gerenciador MCP nativo. Ele **não** substitui as permissões do usuário.

## O que já é automático
- O gerenciador conecta os MCPs configurados e aprovados, atualiza a lista de ferramentas e verifica a saúde das conexões.
- Em falhas de conexão, há até seis tentativas com espera exponencial (sem contornar OAuth).
- Um MCP em standby é reativado sob demanda.
- Um MCP com falha transitória pode ser reconectado ao tentar usar uma ferramenta, **somente depois de esgotado o intervalo de backoff**.
- Os agentes podem consultar `omni_mcp action=list` e solicitar `omni_mcp action=recover server=<nome>`.

## Como o agente trabalha
1. Descobre MCPs configurados, status e ferramentas: `omni_mcp action=list query="browser"`.
2. Seleciona uma ferramenta compatível já autorizada.
3. Se um MCP estiver indisponível, consulta o diagnóstico.
4. Quando for uma falha de conexão recuperável, faz uma tentativa de reconexão controlada: `omni_mcp action=recover server="servidor"`.
5. Verifica se o status voltou para `connected` e se a ferramenta está no catálogo.
6. **Somente então** executa a chamada ainda não realizada, observando as permissões normais.

Se uma chamada anterior retornou erro depois de iniciar, **não a execute novamente automaticamente**: uma ferramenta de envio de mensagem, compra, deploy ou gravação pode ter produzido efeitos externos apesar do erro.

## O que não é feito automaticamente
- Instalar pacotes, baixar executáveis, executar scripts desconhecidos, editar configurações ou conceder permissões.
- Habilitar MCPs explicitamente desativados ou servidores apenas descobertos no projeto.
- Corrigir tokens, OAuth, login, permissões do provedor ou contas externas.
- Repetir operações com efeitos externos após erros de resultado ambíguo.
- Garantir que todos os MCPs da internet estejam instalados, autenticados ou disponíveis.

## Configuração inicial
- `onethy mcp list` — servidores carregados neste projeto.
- `onethy mcp doctor` — diagnóstico, sem alterações.
- `onethy mcp doctor --retry` — reconectar os que falharam, sem ativar os desabilitados.
- `onethy mcp restore --all` — restaurar, com confirmação, as oito **definições** nativas do OnethyCode (permanecem desabilitadas).
- `onethy mcp enable <nome>` — autorizar explicitamente um servidor.
- `onethy mcp auth <nome>` — autenticar um servidor que exige login.

Recuperação no agente tem cooldown de 30 segundos por MCP e não apaga configurações nem reinicia uma conexão ativa. A manutenção de fundo usa seus próprios limites de falha e backoff.

## Arquivos
- `packages/core/src/tool/plugin/omni-mcp.ts`: ferramenta de descoberta, diagnóstico e recuperação
- `packages/core/src/mcp/autonomy.ts`: política de recuperação e redação de segredos
- `packages/core/src/mcp/index.ts`: recuperação sob demanda antes de uma chamada que ainda não começou
- `packages/core/test/omni-mcp-autonomy.test.ts`: testes de decisões de segurança e cooldown


---

# Sistema MCP Autônomo — aprendizado de uso

No modo OnethyCode, os MCPs **já autorizados** são classificados automaticamente de acordo com seu uso real, inclusive os instalados pelo usuário. O sistema não precisa que o MCP seja nativo: ele mede chamadas que passaram pelo serviço MCP.

## Comportamento

1. Ao abrir o projeto, lê um histórico local privado de chamadas (por projeto).
2. Prioriza até **3 servidores frequentemente usados** para conexão antecipada (*warm*).
3. Conecta os outros servidores em segundo plano, com paralelismo limitado, apenas para descobrir seus esquemas de ferramentas. Em seguida, coloca-os em **standby** mantendo as definições de ferramentas acessíveis.
4. Se uma ferramenta em standby for solicitada, acorda seu servidor automaticamente e respeita as permissões normais.
5. Usa um tempo de inatividade de **60 minutos** para servidores frequentes e **10 minutos** para os demais. O histórico é recalculado durante a execução.
6. Ao executar uma ferramenta MCP, atualiza o histórico de chamadas, acertos, falhas e duração, sem armazenar argumentos, respostas, tokens ou URLs.
7. Em falhas transitórias, mantém o comportamento conservador de recuperação MCP existente, com limite de tentativas e backoff.

### Como escolhe o que fica conectado?

O cálculo considera somente os **últimos 7 dias**, frequência, recência e taxa de sucesso. MCPs com pelo menos 2 chamadas recentes entram na seleção; os 3 com maior pontuação ficam no grupo prioritário. Em projeto novo, sem histórico relevante, no máximo os dois primeiros servidores autorizados são aquecidos, de forma conservadora. Depois das primeiras chamadas, um MCP personalizado pode assumir a prioridade.

### Consultar a classificação

No chat do OnethyCode, peça ao agente para usar:

- \`omni_mcp action=usage\`: exibe a prioridade aprendida por servidor.
- \`omni_mcp action=list\`: lista ferramentas disponíveis.
- \`omni_mcp action=recover server=<nome>\`: tenta recuperar uma conexão autorizada.

### Dados e segurança

O histórico é salvo em \`<dados-locais-do-OnethyCode>/onethy/mcp-usage/<hash-do-projeto>.json\`, fora do repositório. Contém apenas nome do MCP, agregados diários e data do último uso. É limitado a 30 dias e até 128 nomes de MCPs, com gravações atômicas por processo. Nunca armazena prompts, parâmetros de ferramentas ou credenciais.

A inicialização não habilita servidores desativados, não instala pacotes nem contorna OAuth. A execução de ferramentas continua condicionada às permissões existentes. Um erro ambíguo de ferramenta que pode ter produzido efeitos externos não autoriza repetição automática.

**Compatibilidade:** este comportamento é ativado somente no modo OnethyCode. Para desativar e voltar ao comportamento de inicialização anterior, defina \`ONETHY_MCP_AUTONOMY=off\` antes de abrir o programa.

**Limites:** o primeiro uso de um servidor novo ainda pode ter custo de inicialização; esquemas de ferramentas são descobertos após uma primeira conexão. O mecanismo registra eventos durante o funcionamento do OnethyCode, não monitora MCPs quando o aplicativo está encerrado. Serviços de terceiros podem exigir conexão, autenticação e configuração manuais.
