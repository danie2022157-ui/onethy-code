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
| MCPs | Arquivo nativo `mcp/onethy/local-tools.json` | Exatamente três modelos locais: navegador, raciocínio e horário; desativados por padrão |

## Preferência por MCPs locais

O OnethyCode fornece somente três modelos próprios desativados por padrão: Playwright (navegador), Sequential Thinking (raciocínio) e Time (fusos horários). **Não importa mais definições MCP de catálogos externos** — independentemente de exigirem ou não uma chave de API.

Durante a atualização são retirados os arquivos MCP gerados pela importação anterior quando ainda desativados e intactos. Não são apagados MCPs configurados, habilitados ou modificados pelo usuário.

Pacotes locais executados com `npx` ou `uvx` podem precisar de internet **na instalação do pacote**, mas não dependem de uma chave de API de provedor para funcionar. Nenhum MCP importado é executado ou habilitado automaticamente.

Os modelos usam serviços locais, não precisam de login ou chave de API de provedor, mas a primeira instalação dos pacotes pode exigir internet.

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
