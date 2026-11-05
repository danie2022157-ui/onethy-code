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
| MCPs | Descoberta nativa em `mcp/onethy/*.json` | Apenas modelos locais selecionados, sem cadastro ou chave de provedor; todos começam desativados |

## Preferência por MCPs locais

A importação aceita **somente** servidores locais verificados em uma lista restrita, como memória, raciocínio sequencial e utilitários locais compatíveis. Os modelos são rejeitados quando têm:

- URLs para serviços MCP hospedados, credenciais, login, OAuth, cabeçalhos de autorização ou variáveis de ambiente usadas para autenticação;
- pacotes fora da lista restrita, scripts de shell, argumentos arbitrários e parâmetros com tokens;
- indicação de conta em provedor externo.

Pacotes locais executados com `npx` ou `uvx` podem precisar de internet **na instalação do pacote**, mas não dependem de uma chave de API de provedor para funcionar. Nenhum MCP importado é executado ou habilitado automaticamente.

O importador também faz a limpeza de definições MCP antigas geradas automaticamente, quando **ainda desativadas e não personalizadas**. MCPs cadastrados ou habilitados pelo usuário são preservados.

## Hooks e mods nativos

O OnethyCode implementa adaptadores próprios para impedir push direto em branches protegidas, validar mensagens Conventional Commits e ocultar determinados formatos de token nas respostas de ferramentas. Esses três adaptadores ficam desativados por padrão. A ativação exige que o usuário defina `enabled: true` no descritor correspondente.

Outros hooks e mods do catálogo são representados apenas por metadados até existir um adaptador compatível. Não se executa automaticamente nenhum script Python, Bash ou módulo de outro runtime.

## Instalação e atualização

A sincronização é integrada ao processo de instalação/atualização da distribuição oficial do OnethyCode, preserva personalizações existentes e não cria um comando específico de instalação.

## Verificação

Os testes automatizados cobrem Windows e Linux, prévia sem gravação, importação idempotente, rejeição de MCPs que exigem autenticação, preservação de configurações pessoais, remoção segura de registros antigos e importação segura de comandos, hooks e mods.

A aprovação desses testes não garante que todos os componentes do catálogo funcionem em todo ambiente: scripts, permissões e dependências precisam ser avaliados caso a caso.
