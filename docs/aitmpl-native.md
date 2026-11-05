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
| Agentes | Arquivos Markdown importados como agentes nativos; os nomes conhecidos de ferramentas Claude são convertidos. |
| Comandos e comandos slash | **Não importados.** |
| Configurações, hooks, MCPs, plugins, mods e loops | Apenas inventariados. Não são instalados, executados nem conectados automaticamente sem adaptação e aprovação específicas. |

**Limites reais:** importação não equivale à garantia de compatibilidade e execução de cada skill. Algumas skills requerem dependências externas. Agentes podem conter instruções específicas de Claude Code que são sinalizadas para revisão. Ferramentas MCP dependem de credenciais e conexões que esta rotina não gerencia. Conteúdo do catálogo deve ser tratado como fonte de terceiros.

## Qualidade

A suíte de testes nativa valida prévia sem escrita, instalação em diretório de projeto e global, idempotência, normalização de skill/agent, a ausência de comandos slash e a não execução de hooks do catálogo. A integração é executada somente durante uma atualização bem-sucedida; falhas na sincronização não são declaradas como atualização concluída do catálogo.
