export * as CommandPlugin from "./command.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Stream } from "effect"
import { Bus } from "../bus.js"
import { Location } from "../location.js"
import { Mcp } from "../mcp/index.js"
import { Model } from "../model.js"
import { OmniBus } from "../omni-bus.js"
import { OmniOrchestrator } from "../omni-orchestrator.js"
import { OmniSession } from "../omni-session.js"
import PROMPT_INITIALIZE from "./command/initialize.txt"
import PROMPT_REVIEW from "./command/review.txt"

export const Plugin = define({
  id: "opencode.command",
  effect: Effect.fn(function* (ctx) {
    const location = yield* Location.Service
    const mcp = yield* Mcp.Service
    const bus = yield* Bus.Service
    const modelsOpt = yield* Effect.serviceOption(Model.Service)
    const omniBusOpt = yield* Effect.serviceOption(OmniBus.Service)
    const orchestratorOpt = yield* Effect.serviceOption(OmniOrchestrator.Service)
    const omniSessionOpt = yield* Effect.serviceOption(OmniSession.Service)
    const loaded = { prompts: [] as Mcp.Prompt[] }
    yield* bus.subscribe(Mcp.PromptsChanged).pipe(
      Stream.runForEach(() =>
        mcp.prompts().pipe(
          Effect.tap((prompts) => Effect.sync(() => (loaded.prompts = prompts))),
          Effect.andThen(ctx.command.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    loaded.prompts = yield* mcp.prompts()
    yield* ctx.command.transform((editor) => {
      
      if (process.env.OMNICODE_ACTIVE === "1") {
        editor.add({
          name: "orchestrate",
          description: "Orquestrador Multi-Agente OmniCode: decompõe a meta em subtarefas para Planner, Architect, Coder e Reviewer",
          execute: (input) =>
            Effect.gen(function* () {
              const goal = input.prompt.text.trim() || "Analisar e orquestrar melhorias no projeto atual"
              const subtasks = Option.isSome(orchestratorOpt) ? yield* orchestratorOpt.value.planMission(goal) : []
              const missionSessionId = Option.isSome(omniSessionOpt)
                ? yield* omniSessionOpt.value.save({
                    goal,
                    mode: "orchestrate",
                    subtasks,
                  })
                : "local"
              const taskSummary = subtasks
                .map((t) => `- [${t.id}] (@${t.assignedAgent}): ${t.title}`)
                .join("\n")
              yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  `Você é o Orquestrador Multi-Agente OmniCode (Sessão de Missão: ${missionSessionId}).\nSubtarefas registradas no OmniBus:\n${taskSummary}\n\nCoordene os especialistas (@planner, @architect, @coder, @reviewer, @explore) para executar esta meta:\n\n$ARGUMENTS`,
                  goal,
                ),
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })

        editor.add({
          name: "omni",
          description: "Orquestrador OmniCode: executa missão com coordenação completa de subagentes especialistas",
          execute: (input) =>
            Effect.gen(function* () {
              const goal = input.prompt.text.trim() || "Executar missão coordenada no repositório"
              const subtasks = Option.isSome(orchestratorOpt) ? yield* orchestratorOpt.value.planMission(goal) : []
              const missionSessionId = Option.isSome(omniSessionOpt)
                ? yield* omniSessionOpt.value.save({
                    goal,
                    mode: "omni",
                    subtasks,
                  })
                : "local"
              const taskSummary = subtasks
                .map((t) => `- [${t.id}] (@${t.assignedAgent}): ${t.title}`)
                .join("\n")
              yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  `Você é o Orquestrador Multi-Agente OmniCode (Sessão: ${missionSessionId}).\nPlano inicial no OmniBus:\n${taskSummary}\n\nCoordene os especialistas para resolver:\n\n$ARGUMENTS`,
                  goal,
                ),
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })

        editor.add({
          name: "memory",
          description: "Memória Durável OmniCode: visualiza e registra decisões em .omnicode/memory.md",
          execute: (input) =>
            Effect.gen(function* () {
              const note = input.prompt.text.trim()
              if (note && Option.isSome(omniSessionOpt)) {
                yield* omniSessionOpt.value.recordMemory(note)
              }
              const currentMemory = Option.isSome(omniSessionOpt) ? yield* omniSessionOpt.value.getMemory() : ""
              yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: `Conteúdo atual de .omnicode/memory.md:\n\n${currentMemory}\n\n${note ? `Nova decisão registrada: "${note}". ` : ""}Resuma o contexto durável do projeto e confirme se há novas decisões arquiteturais para registrar.`,
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })

        const executeUltrawork = (input: Parameters<Parameters<typeof editor.add>[0]["execute"]>[0]) =>
          Effect.gen(function* () {
            const goal = input.prompt.text.trim() || "Executar missão completa de ponta a ponta com máxima autonomia"
            const subtasks = Option.isSome(orchestratorOpt) ? yield* orchestratorOpt.value.planUltrawork(goal) : []
            const missionSessionId = Option.isSome(omniSessionOpt)
              ? yield* omniSessionOpt.value.save({
                  goal,
                  mode: "ultrawork",
                  subtasks,
                })
              : "ulw-local"
            const planPath = Option.isSome(omniSessionOpt)
              ? yield* omniSessionOpt.value.savePlan(missionSessionId, goal, subtasks)
              : ".omnicode/plans"
            const taskSummary = subtasks
              .map((t) => `- [${t.id}] (@${t.assignedAgent}${t.parallel ? " · PARALELO" : ""}): ${t.title}`)
              .join("\n")
            yield* ctx.session.prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: append(
                `⚡ [MODO ULTRAWORK ATIVO — Sessão: ${missionSessionId}]\nPlano persistido em: ${planPath}\n\nSubtarefas geradas:\n${taskSummary}\n\nDIRETRIZES ULTRAWORK:\n1. Dispare @explore e @librarian em paralelo (background=true) quando aplicável.\n2. Crie e mantenha a lista Todo atualizada.\n3. Delegue implementação ao @coder com retorno Boomerang enxuto.\n4. Aplique o RALPH LOOP ENFORCER: execute @reviewer + typecheck/testes e NÃO pare até 100% dos itens estarem verificados.\n\nMeta:\n$ARGUMENTS`,
                goal,
              ),
              delivery: input.delivery,
            })
          }).pipe(Effect.asVoid)

        editor.add({
          name: "ulw",
          description: "Modo Ultrawork (Alta Autonomia): paraleliza @explore/@librarian, implementa com @coder e valida via Ralph Loop",
          execute: executeUltrawork,
        })

        editor.add({
          name: "ultrawork",
          description: "Alias completo para /ulw — Execução autônoma multi-agente de ponta a ponta",
          execute: executeUltrawork,
        })

        editor.add({
          name: "arena",
          description: "Arena Multi-Modelo (Best-of-N): dispara 3 subagentes com modelos diferentes em paralelo para diagnosticar problemas difíceis",
          execute: (input) =>
            Effect.gen(function* () {
              const problem = input.prompt.text.trim() || "Diagnosticar gargalos e propor a melhor arquitetura"
              const available = Option.isSome(modelsOpt) ? yield* modelsOpt.value.available() : []
              const arenaModels = available.slice(0, 3).map((m) => `${m.providerID}/${m.id}`)
              const selectedModels =
                arenaModels.length > 0
                  ? arenaModels
                  : ["openai/gpt-6-astra", "opencode/big-pickle", "opencode/deepseek-v4.1-flash-free"]
              const subtasks = Option.isSome(orchestratorOpt)
                ? yield* orchestratorOpt.value.planArena(problem, selectedModels)
                : []
              const arenaList = subtasks
                .map((t) => `- [${t.id}] (@${t.assignedAgent} usando model="${t.preferredModel}"): ${t.title}`)
                .join("\n")
              yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  `🛡️ [MODO ARENA MULTI-MODELO (BEST-OF-N)]\nDispare os seguintes subagentes em paralelo (background=true) passando explicitamente o parâmetro 'model' em cada chamada da ferramenta subagent:\n${arenaList}\n\nAo receber os relatórios Boomerang dos 3 modelos, compare as abordagens, escolha ou combine a melhor solução técnica e aplique-a para:\n\n$ARGUMENTS`,
                  problem,
                ),
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })

        editor.add({
          name: "ralph",
          description: "Ralph Loop Enforcer: força verificação contínua (Todo + typecheck + testes + @reviewer) até zerar pendências",
          execute: (input) =>
            Effect.gen(function* () {
              const check = Option.isSome(orchestratorOpt)
                ? yield* orchestratorOpt.value.verifyCompletion({ todosPending: 1, hasUnverifiedEdits: true })
                : { passed: false, reminder: "Verifique pendências." }
              yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  `🔁 ${check.reminder ?? "[RALPH LOOP ENFORCER]"}\n1. Inspecione todos os itens Todo pendentes.\n2. Execute typecheck e testes nos pacotes afetados.\n3. Acione @reviewer para auditar o diff.\n4. Corrija qualquer falha encontrada até que 100% passe sem erros.\n\nContexto adicional:\n$ARGUMENTS`,
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })

        editor.add({
          name: "worktree",
          description: "Isolamento Git Worktree: executa tarefas paralelas do @coder em worktrees dedicadas (.omnicode/worktrees/)",
          execute: (input) =>
            ctx.session
              .prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  "🌿 [ISOLAMENTO GIT WORKTREE]\nPara evitar conflitos de arquivos entre subagentes paralelos:\n1. Crie uma worktree isolada em `.omnicode/worktrees/<tarefa>` com branch própria.\n2. Delegue a implementação ao @coder dentro da worktree.\n3. Valide com @reviewer (typecheck + testes) e faça o merge limpo de volta na branch atual.\n\nTarefa:\n$ARGUMENTS",
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
              .pipe(Effect.asVoid),
        })

        editor.add({
          name: "bus",
          description: "Barramento Entre Sessões (OmniBus): lê descobertas de outras sessões/subagentes ou envia mensagem para outra sessão",
          execute: (input) =>
            Effect.gen(function* () {
              const msgText = input.prompt.text.trim()
              if (msgText && Option.isSome(omniBusOpt)) {
                yield* omniBusOpt.value.publish({
                  sender: `user (${input.sessionID})`,
                  target: "*",
                  taskId: "cross-session",
                  sessionID: input.sessionID,
                  type: "handoff",
                  payload: msgText,
                })
              }
              const digest = Option.isSome(omniBusOpt)
                ? yield* omniBusOpt.value.formatContextDigest(undefined, 15)
                : ""
              yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: `${digest || "Barramento OmniBus vazio no momento."}\n\nUse a ferramenta 'omni_bus' (actions: 'list_sessions', 'read', 'broadcast', 'send_session_message') para listar outras sessões ativas ou conversar diretamente com qualquer sessão pelo sessionID.${msgText ? `\n\nInstrução: ${msgText}` : ""}`,
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })

        editor.add({
          name: "memory",
          description: "Memory Bank Persistente (.omnicode/memory-bank/): lê ou atualiza os arquivos de memória do projeto",
          execute: (input) =>
            ctx.session
              .prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  "🧠 [MEMORY BANK PERSISTENTE — .omnicode/memory-bank/]\nUse a ferramenta 'omni_memory' para consultar ou atualizar a memória perpétua do projeto:\n1. 'project-brief.md' — Visão geral e escopo.\n2. 'system-patterns.md' — Padrões de código e decisões de arquitetura.\n3. 'tech-context.md' — Stack, ferramentas e comandos.\n4. 'active-context.md' — Foco atual e tarefas em andamento.\n\nInstrução:\n$ARGUMENTS",
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
              .pipe(Effect.asVoid),
        })

        editor.add({
          name: "checkpoint",
          description: "Workspace Checkpoints: cria ou lista snapshots de restauração no Git (.omnicode/checkpoints/)",
          execute: (input) =>
            ctx.session
              .prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  "💾 [WORKSPACE CHECKPOINT & TIME-TRAVEL]\nUse a ferramenta 'omni_checkpoint' (actions: 'create', 'list', 'restore', 'diff') para salvar um ponto de restauração limpo do repositório ou visualizar os snapshots existentes.\n\nInstrução:\n$ARGUMENTS",
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
              .pipe(Effect.asVoid),
        })

        editor.add({
          name: "undo",
          description: "Time-Travel Undo: restaura os arquivos do workspace para o checkpoint anterior da IA",
          execute: (input) =>
            ctx.session
              .prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  "⏪ [TIME-TRAVEL UNDO]\nExecute a ferramenta 'omni_checkpoint' com action: 'restore' para reverter o workspace ao estado do último checkpoint antes das edições da IA.\n\nInstrução:\n$ARGUMENTS",
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
              .pipe(Effect.asVoid),
        })

        editor.add({
          name: "heal",
          description: "Self-Healing Test Loop: executa a suíte de testes/typecheck e corrige falhas em loop até passar 100%",
          execute: (input) =>
            ctx.session
              .prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  "🔄 [SELF-HEALING AUTONOMOUS LOOP]\n1. Execute 'omni_heal' (action: 'run_and_heal') com comando de teste ou typecheck.\n2. Se houver falha, inspecione o traceback extraído e os arquivos afetados.\n3. Aplique a correção via @coder.\n4. Re-execute o teste até que 100% dos testes e verificações passem com código 0.\n\nComando ou escopo:\n$ARGUMENTS",
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
              .pipe(Effect.asVoid),
        })

        editor.add({
          name: "commit",
          description: "Auto-Commit Inteligente: analisa o git diff e realiza um commit convencional atômico",
          execute: (input) =>
            ctx.session
              .prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  "🏷️ [AUTO-COMMIT INTELIGENTE]\n1. Use 'omni_commit' (action: 'status') para inspecionar os arquivos alterados.\n2. Gere ou confirme a mensagem convencional com 'generate_message' ou use 'commit_all' para commitar atomicamente.\n\nMensagem opcional:\n$ARGUMENTS",
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
              .pipe(Effect.asVoid),
        })

        editor.add({
          name: "team",
          description: "Pipeline de Equipe Completa: orquestra Planner -> Architect -> Coder -> Reviewer com entregas formais",
          execute: (input) =>
            Effect.gen(function* () {
              const goal = input.prompt.text.trim() || "Executar pipeline completo de equipe"
              if (Option.isSome(orchestratorOpt)) {
                yield* orchestratorOpt.value.planTeamPipeline(goal)
              }
              yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  "🎯 [PIPELINE DE EQUIPE COMPLETA — 4 FASES AUTÔNOMAS]\nIniciando execução com a equipe multidisciplinar de especialistas:\n1. @planner: Especificação formal de requisitos, critérios de aceite e escopo.\n2. @architect: Desenho de interfaces, schemas, contratos de tipos e limites modulares.\n3. @coder: Implementação atômica dos módulos e suíte de testes.\n4. @reviewer: Auditoria de segurança, verificação de diff e garantia de testes 100% verdes (Ralph Loop).\n\nMeta da missão:\n$ARGUMENTS",
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })
      }

      editor.add({
        name: "init",
        description:
          process.env.OMNICODE_ACTIVE === "1"
            ? "Configuração guiada do AGENTS.md para o projeto"
            : "guided AGENTS.md setup",
        execute: (input) =>
          ctx.session
            .prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: append(PROMPT_INITIALIZE.replace("${path}", location.project.directory), input.prompt.text),
              delivery: input.delivery,
            })
            .pipe(Effect.asVoid),
      })
      editor.add({
        name: "review",
        description:
          process.env.OMNICODE_ACTIVE === "1"
            ? "Revisar alterações [commit|branch|pr], padrão para alterações não commitadas"
            : "review changes [commit|branch|pr], defaults to uncommitted",
        execute: (input) =>
          ctx.session
            .prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: append(PROMPT_REVIEW.replace("${path}", location.project.directory), input.prompt.text),
              delivery: input.delivery,
            })
            .pipe(Effect.asVoid),
      })
      for (const prompt of loaded.prompts) {
        editor.add({
          name: mcpCommandName(prompt.server, prompt.name),
          description: prompt.description,
          execute: (input) =>
            Effect.gen(function* () {
              const args = parseArguments(input.prompt.text)
              const result = yield* mcp.prompt({
                server: prompt.server,
                name: prompt.name,
                args: Object.fromEntries(
                  (prompt.arguments ?? []).map((argument, index) => [argument.name, args[index] ?? ""]),
                ),
              })
              if (!result) return yield* Effect.fail(new Error(`MCP prompt not found: ${prompt.server}:${prompt.name}`))
              yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: result.messages
                  .map((message) => promptMessageText(message.content))
                  .join("\n")
                  .trim(),
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })
      }
    })
  }),
})

function append(template: string, input: string) {
  const value = input.trim()
  if (template.includes("$ARGUMENTS")) return template.replaceAll("$ARGUMENTS", () => value)
  return [template, value].filter(Boolean).join("\n\n")
}

function parseArguments(input: string) {
  return (input.match(argsRegex) ?? []).map((argument) => argument.replace(quoteTrimRegex, ""))
}

function promptMessageText(content: unknown) {
  if (typeof content === "string") return content
  if (!content || typeof content !== "object") return ""
  if (!("type" in content) || content.type !== "text") return ""
  if (!("text" in content) || typeof content.text !== "string") return ""
  return content.text
}

function mcpCommandName(server: string, prompt: string) {
  return `${sanitize(server)}:${sanitize(prompt)}`
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_")
}

const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const quoteTrimRegex = /^["']|["']$/g
