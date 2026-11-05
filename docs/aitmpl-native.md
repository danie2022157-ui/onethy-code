# Personalizações AITmpl nativas no OnethyCode

A integração é limitada a **personalizações**, sem criar comandos CLI, comandos slash, telas ou fluxos novos para o usuário.

## Como funciona

Na atualização normal do OnethyCode por Git, após a atualização dos pacotes, o sistema sincroniza os componentes compatíveis do catálogo público [AITmpl](https://github.com/davila7/claude-code-templates) para o diretório de configuração global nativo do OnethyCode:

- **Windows:** `%APPDATA%\\omnicode\\`
- **Linux/macOS:** `$XDG_CONFIG_HOME/omnicode/` ou `~/.config/omnicode/`
- **Personalizações globais customizadas:** respeita `OPENCODE_CONFIG_DIR` e `OMNICODE_CONFIG_DIR`.

Os arquivos são instalados em `skills/` e `agents/`, preservando os arquivos existentes e usando nomes únicos por categoria. A fonte é o catálogo aberto, e o clone temporário é apagado após o processamento.

## Compatibilidade

| Componente do catálogo | Tratamento |
| --- | --- |
| Skills | Importadas como skills nativas, com seus arquivos auxiliares e metadados normalizados. |
| Agentes | Importados como subagentes nativos, herdando o modelo e as permissões atuais; campos e ferramentas exclusivos do Claude Code não ganham execução automática. |
| Comandos e comandos slash | **Não importados.** |
| MCPs | Definições JSON compatíveis importadas em `mcp/aitmpl/`, descobertas **desativadas por padrão** pelo mecanismo nativo; chaves e tokens de exemplo são removidos. |\n| Configurações, hooks, plugins, mods e loops | Inventariados, sem ativação automática. Perfis de configuração podem se contradizer e os hooks/mods exigem runtime do Claude Code. |

**Limites reais:** importação não equivale à garantia de compatibilidade e execução de cada skill. Algumas skills requerem dependências externas. Não é possível garantir execução de 100% das personalizações de outro runtime sem validar cada dependência. Agentes podem conter instruções específicas de Claude Code que são sinalizadas para revisão. Ferramentas MCP dependem de credenciais e conexões que esta rotina não gerencia. Conteúdo do catálogo deve ser tratado como fonte de terceiros.

## Qualidade

A suíte de testes nativa valida prévia sem escrita, instalação em diretório de projeto e global, idempotência, normalização de skill/agent, sanitização e descoberta MCP desativada, ausência de comandos slash e a não execução de hooks do catálogo. Os testes de CI também inspecionam o catálogo real de MCPs em modo somente leitura. A integração é executada somente durante uma atualização bem-sucedida; falhas na sincronização não são declaradas como atualização concluída do catálogo.
