# 🌌 Omni-Orchestrator

> **Orquestrador Autônomo Multi-Agente & Multi-Modelo com Acesso via Terminal (CLI)**  
> Inspirado na arquitetura do **OpenCode (`anomalyco/opencode`)** com modos **BUILD / PLAN**, sistema de **TODOs dinâmicos**, **Glob**, **Patch**, **Edição Cirúrgica**, **AGENTS.md** e **Roteamento Inteligente de Modelos de IA**.

---

## 🚀 Principais Recursos Extraídos do OpenCode

O **Omni-Orchestrator** incorpora os padrões de engenharia de ponta do repositório [`anomalyco/opencode`](https://github.com/anomalyco/opencode):

1. **Modos de Agente (`BUILD` vs `PLAN`)**:
   - `[BUILD]` (Padrão): Permissão total para desenvolvimento, criação de código, edição e comandos de terminal.
   - `[PLAN]`: Modo somente leitura focado em exploração analítica, mapeamento de arquitetura, leitura de arquivos e busca (`glob`, `grep`), bloqueando edições destrutivas até aprovação.
   - Alterne instantaneamente no terminal usando `/plan` ou `/build`.

2. **Sistema de TODOs da Sessão (`todowrite`)**:
   - Os agentes mantêm um plano de trabalho vivo com checkboxes visuais em tempo real no terminal:
     - `[⏳]` Em andamento
     - `[✔]` Concluída
     - `[ ]` Pendente
     - `[✖]` Cancelada
   - Visualize a lista de tarefas da sessão a qualquer momento com `/todos`.

3. **Busca por Padrões Glob (`glob`)**:
   - Localização rápida de arquivos no repositório com suporte a curingas (`**/*.ts`, `src/**/*.py`, `*.json`).

4. **Edição Cirúrgica de Código com Tolerância Unicode (`edit_file`)**:
   - Algoritmo do OpenCode com normalização automática de aspas tipográficas (`[‘’‚‛] -> '`), travessões (`[—–] -> -`) e espaços Unicode, além de suporte a `replaceAll`.

5. **Envelope Multi-Arquivo (`patch`)**:
   - Suporte ao formato envelope padrão do OpenCode (`*** Begin Patch ... *** End Patch`) com blocos `Add File`, `Update File` e `Delete File`.

6. **Comando `/init` (Geração de `AGENTS.md`)**:
   - Inspeciona o repositório e gera um arquivo [`AGENTS.md`](file:///c:/Users/Daniel/.gemini/antigravity-ide/scratch/omni-orchestrator/AGENTS.md) com as diretrizes e comandos essenciais para guiar sessões futuras de agentes.

7. **Comando `/review` (Auditoria Profunda de Código)**:
   - Executa uma revisão estruturada focada em bugs reais, erros de lógica, segurança e consistência estrutural.

8. **Roteamento Inteligente de Modelos**:
   - O orquestrador escolhe dinamicamente o modelo ideal para cada agente:
     - **Coder**: Claude 3.7 / 3.5 Sonnet ou DeepSeek Coder
     - **Reviewer**: GPT-4o, o3-mini ou DeepSeek R1
     - **Researcher**: Gemini 2.0 Flash (janela de 1M de tokens e busca web)
     - **Terminal / DevOps**: Claude Haiku ou Gemini Flash
     - **Modelos Locais**: Ollama (`qwen2.5-coder`, `llama3.3`)

---

## 💻 Como Iniciar no Terminal

O projeto utiliza **100% de APIs nativas do Node.js (v18+)**, sem dependências externas pesadas.

### 1. Iniciar o Modo Interativo (REPL)

```bash
npm start
# ou diretamente:
node src/index.js
```

Prompt interativo com indicador de modo ativo:
```text
omni (build)> 
```

### 2. Executar Diretamente via Linha de Comando

```bash
node src/index.js "Crie um script em Python que calcule a sequencia de Fibonacci e teste"
```

---

## ⌨️ Teclas de Atalho

### 1. No CLI do Terminal (Estilo OpenCode)
| Tecla | Ação |
| :--- | :--- |
| **`Tab`** | Alterna entre o modo `[BUILD]` e `[PLAN]` (com linha vazia) ou autocompleta comandos |
| **`Ctrl+T`** | Exibe a lista de tarefas/plano da sessão ativa (`/todos`) |
| **`Ctrl+R`** | Dispara imediatamente a revisão profunda de código (`/review`) |
| **`Ctrl+P`** | Ativa o modo seguro `[PLAN]` (somente leitura e análise) |
| **`Ctrl+B`** | Ativa o modo total `[BUILD]` (escrita de código e terminal) |
| **`Ctrl+A`** | Lista todos os agentes e modelos selecionados (`/agents`) |
| **`Ctrl+M`** | Lista o catálogo de modelos suportados (`/models`) |
| **`Ctrl+L`** | Limpa a tela do terminal (`/clear`) |
| **`Ctrl+H`** | Exibe o menu completo de ajuda |
| **`Ctrl+C`** | Cancela a tarefa em execução ou sai |

---

### 2. No VS Code & Antigravity IDE (Atalhos Globais do Editor)
| Tecla | Ação no Editor |
| :--- | :--- |
| **`Ctrl+Alt+O`** | Inicia o Terminal do Omni-Orchestrator em um novo painel |
| **`Ctrl+Alt+R`** | Executa a tarefa de Revisão de Código (`/review`) |
| **`Ctrl+Alt+I`** | Executa a tarefa de geração do `AGENTS.md` (`/init`) |
| **`Ctrl+Alt+P`** | Alterna o terminal para o modo `[PLAN]` |
| **`Ctrl+Alt+B`** | Alterna o terminal para o modo `[BUILD]` |
| **`Ctrl+Alt+T`** | Exibe os `TODOs` da sessão ativa |
| **`Ctrl+Alt+A`** | Lista os Agentes da equipe |
| **`Ctrl+Alt+M`** | Lista os Modelos de IA |
| **`Ctrl+Alt+X`** | Revisa criticamente o arquivo ativo aberto no editor |

---

## 🛠️ Tabela de Comandos do Terminal

| Comando | Descrição |
| :--- | :--- |
| `omni (build)> Crie um app...` | Digite sua missão diretamente para a equipe executar |
| `/run <missao>` | Executa a missão multi-agente especificada |
| `/plan` | Ativa o modo **PLAN** (somente leitura: análise e exploração sem mutação) |
| `/build` | Ativa o modo **BUILD** (desenvolvimento e escrita total de código) |
| `/todos` | Exibe a lista de tarefas e o progresso da sessão ativa |
| `/init` | Inspeciona o projeto e gera o arquivo `AGENTS.md` |
| `/review [alvo]` | Audita o código no workspace com verificação de segurança |
| `/agents` | Lista todos os agentes e seus modelos atribuídos |
| `/agent create <id> <nome> <papel> [modelo]` | Cadastra um novo agente especialista na equipe |
| `/agent model <id> <modelo>` | Altera o modelo de um agente (ex: `auto`, `gpt-4o`, `claude-3-7-sonnet-20250219`) |
| `/agent remove <id>` | Remove um agente da equipe |
| `/models` | Lista todos os modelos cadastrados e o status no `.env` |
| `/model add <id> <nome> [endpoint]` | Cadastra um modelo customizado ou local |
| `/tools` | Lista todas as ferramentas ativas no Hub Global |
| `/skills` | Lista as diretrizes técnicas e skills |
| `/workspace` | Lista os arquivos gerados no diretório sandbox `./workspace` |
| `/env` | Exibe status das chaves de API configuradas |
| `/simulate` | Alterna o modo de simulação inteligente para testes sem chaves |
| `/clear` | Limpa a tela do terminal |
| `/exit` | Encerra o orquestrador |

---

## 🔑 Configuração de Chaves de API (`.env`)

Copie o `.env.example` para `.env`:

```bash
cp .env.example .env
```

Preencha as chaves dos provedores desejados:

```env
# Anthropic (Claude 3.7 Sonnet, Claude 3.5 Sonnet, Haiku)
ANTHROPIC_API_KEY=sua_chave_aqui

# OpenAI (GPT-4o, o1, o3-mini, GPT-4o-mini)
OPENAI_API_KEY=sua_chave_aqui

# Google Gemini (Gemini 2.0 Flash, Gemini 1.5 Pro)
GEMINI_API_KEY=sua_chave_aqui

# DeepSeek (DeepSeek Coder, DeepSeek R1)
DEEPSEEK_API_KEY=sua_chave_aqui

# Ollama / Modelos Locais
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
```

*(Se nenhuma chave for configurada, o modo de simulação inteligente entra em ação automaticamente para você testar a experiência completa no terminal, criação real de arquivos em `./workspace` e ciclo multi-agente sem erros!)*
