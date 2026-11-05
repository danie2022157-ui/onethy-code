# Personalizações nativas do OnethyCode

O OnethyCode disponibiliza um catálogo de personalizações **interno à experiência do produto**. A integração é baseada nos arquivos de configuração que o próprio OnethyCode reconhece, sem instalar outro cliente de IA.

## Componentes

| Tipo | Integração | Observações |
| --- | --- | --- |
| Skills | Diretórios `skills/` com `SKILL.md` e arquivos auxiliares | Uma skill pode depender de softwares externos; importá-la não instala essas dependências |
| Agentes | Arquivos `agents/*.md` convertidos em subagentes | Herdam as permissões e o provedor escolhido no OnethyCode |
| Comandos personalizados | Arquivos `commands/*.md` | A interpolação de shell de templates externos é removida; os comandos só rodam quando invocados |
| Hooks | Descritores em `hooks/onethy/*.json` | Não executam scripts externos; apenas adaptadores internos suportados podem ser habilitados |
| Mods | Descritores em `mods/onethy/*.json` | Não executam código externo; adaptadores internos ficam desativados até habilitação explícita |
| MCPs | Arquivo nativo `mcp/onethy/local-tools.json` | Oito servidores locais selecionados; desativados por padrão |

## MCPs locais incluídos

O OnethyCode oferece **oito definições nativas** para executar servidores MCP localmente. Não há dependência de login, OAuth, API key ou serviços MCP remotos.

| MCP | Ferramenta | Inicialização |
| --- | --- | --- |
| Playwright | Automação do navegador | `npx -y @playwright/mcp@latest` |
| Chrome DevTools | Depuração e inspeção de páginas no Chrome | `npx -y chrome-devtools-mcp@latest` |
| Serena | Busca semântica e edição de código | `uvx -p 3.13 --from serena-agent serena start-mcp-server --project-from-cwd --context ide --open-web-dashboard false` |
| Filesystem | Arquivos restritos ao projeto corrente | `npx -y @modelcontextprotocol/server-filesystem .` |
| Git | Git restrito ao repositório do projeto | `uvx mcp-server-git --repository .` |
| Memory | Memória persistente local | `npx -y @modelcontextprotocol/server-memory` |
| MarkItDown | Conversão de documentos em Markdown | `uvx markitdown-mcp` |
| Desktop Commander | Operações locais com arquivos e processos | `npx -y @wonderwhy-er/desktop-commander@latest` |

Os servidores são executados em **stdio**, não por um endereço HTTP hospedado, e começam **todos desativados**. A distribuição já contém suas configurações, mas a instalação dos pacotes pode exigir internet na primeira execução. Para Serena, `uvx` também pode precisar preparar Python 3.13 e servidores de linguagem; Playwright e Chrome DevTools podem exigir navegadores instalados.

**Segurança:** o processo MCP usa o diretório do workspace como diretório de trabalho. Filesystem recebe apenas `.` como raiz; Git recebe `--repository .`. Desktop Commander pode manipular processos e arquivos com as permissões da sua conta do sistema e deve ser habilitado somente quando necessário.

Na atualização, a lista anterior de três MCPs é trocada pela de oito **apenas se o arquivo antigo ainda estiver exatamente como foi gerado**. Configurações alteradas ou habilitadas manualmente não são sobrescritas. Os antigos registros MCP importados automaticamente e ainda intactos/desativados são limpos sem apagar configurações de sua autoria.

Para ligar um MCP, habilite o servidor pela configuração canônica do OnethyCode (por exemplo, em `mcp.overrides`); o campo `disabled` no arquivo descoberto não concede permissão para inicializar um servidor sozinho.

## Gerenciamento dos MCPs no terminal

O OnethyCode tem comandos diretos e um menu interativo, sem depender de um provedor:

| Operação | Comando |
| --- | --- |
| Listar servidores e seus status reais | `onethy mcp list` |
| Abrir gerenciador com seleção interativa | `onethy mcp manage` |
| Ativar um servidor no projeto | `onethy mcp enable onethy-playwright` |
| Desativar sem apagar | `onethy mcp disable onethy-playwright` |
| Excluir uma configuração do projeto | `onethy mcp remove onethy-playwright` |
| Restaurar um MCP nativo removido | `onethy mcp restore onethy-playwright` |
| Restaurar todos os 8 nativos | `onethy mcp restore --all` |
| Diagnosticar erros de inicialização | `onethy mcp doctor` |

A flag `--global` em `manage`, `enable`, `disable`, `remove` e `restore` aplica a operação à configuração global em vez da configuração do projeto. A opção `--yes` confirma exclusão ou restauração completa em terminais não interativos.

**Excluir** remove somente a definição MCP selecionada no escopo indicado, além da autorização correspondente nesse escopo. Outros MCPs e personalizações não são alterados. Se a definição estiver na configuração global, o comando exige `--global` para excluí-la. Para arquivos descobertos em outras ferramentas (como Cursor ou VS Code), a exclusão não altera esses programas.

**Restaurar** reconstitui a definição original do MCP nativo com `disabled: true`; a opção `--all` recria as oito definições e limpa as autorizações explícitas dos MCPs restaurados no escopo selecionado. A restauração não apaga MCPs personalizados que tenham nomes diferentes. O gerenciador mantém as alterações entre sessões e atualizações; um MCP removido não reaparece automaticamente na próxima sincronização.

## Plugins nativos

Existem dois plugins do próprio OnethyCode em `plugins/onethy/`: **Proteção de arquivos sensíveis** (bloqueia o uso de arquivos `.env`, chaves e certificados quando ativado) e **Preferência por ferramentas locais** (inclui orientação na sessão para priorizar ferramentas do computador). São adaptadores internos reais, sem execução de JavaScript de plugins de terceiros. Ficam desativados inicialmente e podem ser habilitados no descritor JSON com `enabled: true`, mantendo a decisão com o usuário.

## Hooks e mods nativos

O OnethyCode implementa adaptadores próprios para impedir push direto em branches protegidas, validar mensagens Conventional Commits e ocultar determinados formatos de token nas respostas de ferramentas. Esses três adaptadores ficam desativados por padrão. A ativação exige que o usuário defina `enabled: true` no descritor correspondente.

Outros hooks e mods do catálogo são representados apenas por metadados até existir um adaptador compatível. Não se executa automaticamente nenhum script Python, Bash ou módulo de outro runtime.

## Instalação e atualização

A sincronização é integrada ao processo de instalação/atualização da distribuição oficial do OnethyCode, preserva personalizações existentes e não cria um comando específico de instalação.

## Verificação

Os testes automatizados cobrem Windows e Linux, prévia sem gravação, importação idempotente, rejeição de MCPs que exigem autenticação, preservação de configurações pessoais, remoção segura de registros antigos, somente três MCPs nativos e adaptadores internos de plugins, além da importação segura de comandos, hooks e mods.

A aprovação desses testes não garante que todos os componentes do catálogo funcionem em todo ambiente: scripts, permissões e dependências precisam ser avaliados caso a caso.
