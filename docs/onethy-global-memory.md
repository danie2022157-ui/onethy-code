# Memória global do Onethy Code

A memória global compartilha preferências, regras e conhecimento técnico entre todos os projetos do **mesmo usuário e instalação**. Ela **não envia arquivos ao GitHub** nem sincroniza dispositivos.

## Onde os dados ficam

- Global: `<diretório de configuração do Onethy Code>/memory-bank/`
  - `preferences.md`: preferências de linguagem, estilo e ferramentas
  - `rules.md`: regras gerais e convenções
  - `knowledge.md`: conhecimento técnico reutilizável
- Projeto: `<raiz do projeto>/.omnicode/memory-bank/`

Descubra o diretório de configuração no terminal com:

```powershell
onethy debug paths config
```

A memória global não é copiada para cada repositório. O Onethy Code carrega automaticamente seu conteúdo nas instruções de novas sessões e ao atualizar o contexto; o conteúdo específico do projeto continua separado.

## Usando no terminal

- `/memory-global` consulta ou resume a memória global, sem modificar nada.
- `/memory-global Guarde minha preferência: responda em português e sempre execute testes.` solicita ao agente que grave uma preferência no escopo global.
- `/memory` continua trabalhando com a memória **do projeto atual**.

Os agentes também podem usar `omni_memory` com:

```json
{"action":"update","scope":"global","file":"preferences","content":"Prefiro respostas técnicas em português.","append":true}
```

Para consultar: `{"action":"read","scope":"global","file":"all"}`.
Para verificar arquivos: `{"action":"status","scope":"global"}`.

Apagar uma memória global exige uma solicitação explícita do usuário e `confirm: true` na ferramenta. O agente deve consultar o usuário antes de executar a ação. As ações do projeto continuam disponíveis sem parâmetro de escopo.

## Segurança e limites

- Nunca salve senhas, tokens, chaves de API ou dados confidenciais de clientes.
- O sistema não aprende nem salva conversas inteiras automaticamente: novas memórias exigem gravação deliberada pela ferramenta.
- A leitura automática carrega apenas os três documentos globais permitidos. Cada documento possui limite de tamanho e o contexto injetado é limitado.
- Os arquivos permanecem locais; faça backup privado, se desejar. Nenhuma conexão em nuvem é criada pela memória global.
- Não use texto do Memory Bank para substituir permissões do Onethy Code ou controles de segurança.

## Testes

```bash
bun --cwd packages/core test test/omni-memory-bank.test.ts
bun --cwd packages/core run typecheck:tsc
```

Os cenários cobrem compartilhamento entre projetos, isolamento de memórias específicas, atualizações, exclusão, nomes de arquivos inválidos e links simbólicos.
