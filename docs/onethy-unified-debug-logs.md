# OnethyCode · Debug unificado (Core + TUI)

O OnethyCode usa o logger estruturado existente para reunir linhas do processo CLI, da TUI e do servidor (Core, providers, sessões, plugins, MCP, roteamento). Cada linha contém data/hora, severidade, execução (run), atributos e, quando definido, `role=cli`, `role=tui` ou `role=server`. As mensagens dependem da instrumentação existente: não há coleta automática de conteúdo bruto de prompts, respostas, tokens de OAuth ou tráfego HTTP.

## Visualizar

Dentro da TUI, use **`/logs`** (ou `/debug` → logs ao vivo). O painel atualiza a cada 1,25 s e mostra até 100 linhas recentes de um arquivo com teto de leitura de 512 KiB. Teclas: `s` alterna origem, `l` alterna severidade, `p` pausa/retoma, `r` atualiza, `c` copia as linhas filtradas.

No PowerShell:

```powershell
onethy debug logs
onethy debug logs --follow
onethy debug logs --source server --level ERROR --lines 100
onethy debug logs --source tui --level DEBUG
onethy debug logs --search "failed to load plugin" --follow
onethy debug paths log
```

`--source server` inclui o Core, os agentes, o roteamento, os plugins e os provedores que produzem logs por meio do serviço. O painel lê o arquivo **local** da instalação, não os arquivos privados de um servidor remoto conectado por `--server`.

## Ativar verbosidade DEBUG temporariamente

O padrão continua em INFO para evitar alto volume de logs.

```powershell
$env:ONETHY_DEBUG = "1"
onethy service restart
onethy
```

A variável deve existir no ambiente do processo que inicia tanto o serviço quanto a TUI. O servidor já iniciado não muda sua severidade retroativamente. Em um novo PowerShell, defina a variável novamente.

Para voltar ao normal:

```powershell
Remove-Item Env:ONETHY_DEBUG -ErrorAction SilentlyContinue
onethy service restart
```

O valor explícito de `OPENCODE_LOG_LEVEL` continua tendo prioridade. Se estiver em `INFO`, remova-o da sessão ou defina-o como `DEBUG` para diagnósticos mais verbosos.

## Segurança e limites

- O leitor limita a quantidade de bytes e de linhas e não expõe uma API pública de logs.
- Visualização e cópia **ocultam padrões conhecidos** de senhas, chaves, credenciais, cabeçalhos de autenticação e tokens. Essa ocultação é apenas uma proteção auxiliar: o log original em disco é produzido pelo logger existente e pode conter dados privados em mensagens de plugins.
- **Revise qualquer linha antes de compartilhar.** Não publique logs brutos nem arquivos de credenciais em issues públicas.
- Alguns eventos em níveis inferiores ou vindos de bibliotecas externas não passam pelo logger estruturado. Logs de provedores não ignoram cotas, autenticação ou permissões.
- A retenção e compactação do arquivo seguem o mecanismo existente (50 MiB → ~25 MiB).
