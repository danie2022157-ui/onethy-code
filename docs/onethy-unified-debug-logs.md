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

## Arquivo exclusivo para erros e avisos

Além do arquivo completo, todas as mensagens produzidas pelos loggers estruturados com severidade `WARN`, `ERROR` ou `Fatal` passam a ser espelhadas automaticamente para `opencode-errors-local.log` (na mesma pasta). Assim, um volume elevado de eventos DEBUG/INFO não esconde incidentes recentes.

```powershell
onethy debug logs --level ERROR --follow
onethy debug logs --level WARN --follow
onethy debug paths log
```

Na TUI, `/logs` e a tecla `l` permitem alternar entre todos os eventos e o arquivo de incidentes. Ambos os arquivos usam compactação por tamanho (completo: 50 MiB → 25 MiB; incidentes: 10 MiB → 5 MiB). A redação de segredos conhecidos acontece **antes da gravação**, além da proteção de leitura. Plugins que registram mensagens fora do logger estruturado ou encerram o processo abruptamente podem deixar lacunas.

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
- A gravação, visualização e cópia **ocultam padrões conhecidos** de senhas, chaves, credenciais, cabeçalhos de autenticação e tokens. A ocultação é uma proteção auxiliar: plugins externos ainda podem registrar informações privadas em formatos desconhecidos.
- **Revise qualquer linha antes de compartilhar.** Não publique logs brutos nem arquivos de credenciais em issues públicas.
- Alguns eventos em níveis inferiores ou vindos de bibliotecas externas não passam pelo logger estruturado. Logs de provedores não ignoram cotas, autenticação ou permissões.
- O log completo é compactado de 50 MiB para ~25 MiB e o arquivo exclusivo de incidentes, de 10 MiB para ~5 MiB.
