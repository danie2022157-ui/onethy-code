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
