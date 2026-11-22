export * as CommandPlugin from "./command.js"

import crypto from "node:crypto"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schema, Stream } from "effect"
import { Bus } from "../bus.js"
import { Location } from "../location.js"
import { Mcp } from "../mcp/index.js"
import { Model } from "../model.js"
import { OmniBus } from "../omni-bus.js"
import { OmniOrchestrator } from "../omni-orchestrator.js"
import { OmniSession } from "../omni-session.js"
import PROMPT_INITIALIZE from "./command/initialize.txt"
import PROMPT_REVIEW from "./command/review.txt"

export function missionControlInstructions(missionID: string) {
  return [
    `Mission ID: ${missionID}`,
    "Use the omni_mission tool to read 'status' then 'claim' the next runnable task/stage.",
    "A claim means reserved, NOT completed. Actually delegate/run the assigned agent through available tools.",
    "Only call 'complete' for a running task after genuine, verified work with a non-empty result.",
    "Call 'fail' with the real blocker if an agent cannot run or the work fails; do not invent success.",
    "On failure, report the blocker and ask whether to retry. Respect stage dependencies.",
    "There is no autonomous persistent background worker; report unexecuted stages honestly.",
  ].join("\n")
}

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
        const executeOmni = (input: Parameters<Parameters<typeof editor.add>[0]["execute"]>[0]) =>
            Effect.gen(function* () {
              const goal = input.prompt.text.trim() || "Analyze and orchestrate improvements in the current project"
              const missionID = `mission-${crypto.randomUUID()}`
              const mission = yield* planAndPersistMission({
                missionID,
                goal,
                mode: "omni",
                fallbackSessionID: "local",
                plan: (id) => Option.isSome(orchestratorOpt) ? orchestratorOpt.value.planMission(goal, id) : Effect.succeed([]),
                save: Option.isSome(omniSessionOpt) ? omniSessionOpt.value.save : undefined,
              })
              const subtasks = mission.subtasks
              const missionSessionId = mission.sessionID
              const taskSummary = subtasks
                .map((t) => `- [${t.id}] (@${t.assignedAgent}): ${t.title}`)
                .join("\n")
              yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  `You are the OmniCode Multi-Agent Orchestrator (Mission Session: ${missionSessionId}).\n${missionControlInstructions(missionID)}\nSubtasks registered on OmniBus:\n${taskSummary}\n\nCoordinate specialists (@planner, @architect, @coder, @reviewer, @explore) to achieve this goal:\n\n$ARGUMENTS`,
                  goal,
                ),
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid)

        editor.add({
          name: "omni",
          description: "OmniCode Orchestrator: executes mission with full coordination across specialist subagents",
          execute: executeOmni,
        })
        editor.add({ name: "orchestrate", description: "Deprecated alias for /omni", execute: executeOmni })
        editor.add({
          name: "mission",
          description: "Inspect a saved Onethy mission and its agent task statuses",
          execute: (input) => ctx.session.prompt({
            ...input.prompt,
            sessionID: input.sessionID,
            text: `Use omni_mission action='status' for mission ID: ${input.prompt.text.trim()}. Show pending/running/completed/failed tasks. Do not mutate the mission unless explicitly asked.`,
            delivery: input.delivery,
          }).pipe(Effect.asVoid),
        })


        editor.add({
          name: "memory-note",
          description: "Quick Memory Note: records architectural decisions into .omnicode/memory.md",
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
                text: `Current contents of .omnicode/memory.md:\n\n${currentMemory}\n\n${note ? `New decision recorded: "${note}". ` : ""}Summarize durable project context and confirm if additional architectural decisions should be recorded.`,
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })

        const executeUltrawork = (input: Parameters<Parameters<typeof editor.add>[0]["execute"]>[0]) =>
          Effect.gen(function* () {
            const goal = input.prompt.text.trim() || "Execute end-to-end mission with maximum autonomy"
            const missionID = `mission-${crypto.randomUUID()}`
            const mission = yield* planAndPersistMission({
              missionID,
              goal,
              mode: "ultrawork",
              fallbackSessionID: "ulw-local",
              plan: (id) => Option.isSome(orchestratorOpt) ? orchestratorOpt.value.planUltrawork(goal, id) : Effect.succeed([]),
              save: Option.isSome(omniSessionOpt) ? omniSessionOpt.value.save : undefined,
            })
            const subtasks = mission.subtasks
            const missionSessionId = mission.sessionID
            const planPath = Option.isSome(omniSessionOpt)
              ? yield* omniSessionOpt.value.savePlan(missionSessionId, goal, subtasks)
              : ".omnicode/plans"
            const taskSummary = subtasks
              .map((t) => `- [${t.id}] (@${t.assignedAgent}${t.parallel ? " · PARALLEL" : ""}): ${t.title}`)
              .join("\n")
            yield* ctx.session.prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: append(
                `⚡ [ULTRAWORK MODE ACTIVE — Session: ${missionSessionId}]\n${missionControlInstructions(missionID)}\nPlan persisted at: ${planPath}\n\nGenerated subtasks:\n${taskSummary}\n\nULTRAWORK DIRECTIVES:\n1. Launch @explore and @librarian in parallel (background=true) when applicable.\n2. Create and maintain the Todo checklist.\n3. Delegate implementation to @coder with concise Boomerang responses.\n4. Apply RALPH LOOP ENFORCER: run @reviewer + typecheck/tests and DO NOT stop until 100% of items are verified.\n\nGoal:\n$ARGUMENTS`,
                goal,
              ),
              delivery: input.delivery,
            })
          }).pipe(Effect.asVoid)

        editor.add({
          name: "ulw",
          description: "Ultrawork Mode (High Autonomy): parallelizes @explore/@librarian, implements with @coder, validates via Ralph Loop",
          execute: executeUltrawork,
        })
        editor.add({ name: "ultrawork", description: "Deprecated alias for /ulw", execute: executeUltrawork })

        editor.add({
          name: "arena",
          description: "Multi-Model Arena (Best-of-N): runs up to 3 competing subagents with different models in parallel to evaluate hard trade-offs",
          execute: (input) =>
            Effect.gen(function* () {
              const problem = input.prompt.text.trim() || "Diagnose bottlenecks and propose optimal architecture"
              const available = Option.isSome(modelsOpt) ? yield* modelsOpt.value.available() : []
              const selectedModels = yield* selectArenaModels(available)
              const missionID = `mission-${crypto.randomUUID()}`
              const mission = yield* planAndPersistMission({
                missionID,
                goal: problem,
                mode: "arena",
                fallbackSessionID: "arena-local",
                plan: (id) => Option.isSome(orchestratorOpt) ? orchestratorOpt.value.planArena(problem, selectedModels, id) : Effect.succeed([]),
                save: Option.isSome(omniSessionOpt) ? omniSessionOpt.value.save : undefined,
              })
              const subtasks = mission.subtasks
              const arenaList = subtasks
                .map((t) => `- [${t.id}] (@${t.assignedAgent} using model="${t.preferredModel}"): ${t.title}`)
                .join("\n")
              yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  `🛡️ [MULTI-MODEL ARENA (BEST-OF-N)]\nDispatch the following subagents in parallel (background=true) passing the 'model' parameter explicitly on each subagent tool call:\n${arenaList}\n\nUpon receiving Boomerang reports from all selected models, compare approaches, synthesize the best technical solution, and apply it for:\n\n$ARGUMENTS`,
                  problem,
                ),
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })

        editor.add({
          name: "ralph",
          description: "Ralph Loop Enforcer: continuous verification loop (Todo + typecheck + tests + @reviewer) until 0 errors",
          execute: (input) =>
            Effect.gen(function* () {
              const check = Option.isSome(orchestratorOpt)
                ? yield* orchestratorOpt.value.verifyCompletion({ todosPending: 1, hasUnverifiedEdits: true })
                : { passed: false, reminder: "Verify pending tasks." }
              yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  `🔁 ${check.reminder ?? "[RALPH LOOP ENFORCER]"}\n1. Inspect all pending Todo items.\n2. Run typecheck and tests in affected packages.\n3. Trigger @reviewer to audit the git diff.\n4. Fix any failure found until 100% passes with exit code 0.\n\nAdditional context:\n$ARGUMENTS`,
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })

        editor.add({
          name: "worktree",
          description: "Git Worktree Isolation: executes parallel tasks in dedicated worktrees (.omnicode/worktrees/)",
          execute: (input) =>
            ctx.session
              .prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  "🌿 [GIT WORKTREE ISOLATION]\nTo avoid file conflicts between parallel subagents:\n1. Create an isolated worktree at `.omnicode/worktrees/<task>` on its own branch.\n2. Delegate implementation to @coder inside the worktree.\n3. Validate with @reviewer (typecheck + tests) and perform a clean merge back to the current branch.\n\nTask:\n$ARGUMENTS",
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
              .pipe(Effect.asVoid),
        })

        editor.add({
          name: "bus",
          description: "Cross-Session Bus (OmniBus): inspects discoveries across sessions or broadcasts cross-session messages",
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
                text: `${digest || "OmniBus cross-session message bus is currently empty."}\n\nUse the 'omni_bus' tool (actions: 'list_sessions', 'read', 'broadcast', 'send_session_message') to list other active sessions or send direct session-to-session messages by sessionID.${msgText ? `\n\nInstruction: ${msgText}` : ""}`,
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })

        editor.add({
          name: "memory-global",
          description: "Global Memory Bank: consult or update preferences shared by all OnethyCode projects",
          execute: (input) =>
            ctx.session
              .prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: [
                  "🧠 [GLOBAL MEMORY — OnethyCode]",
                  "Use the omni_memory tool with scope='global' (never scope='project') to handle this request.",
                  "The shared files are preferences.md, rules.md and knowledge.md in the user configuration directory.",
                  "Consult global memory before deciding whether to add or update an entry.",
                  "Only modify global memory when the user explicitly requests it. Never store API keys, passwords, tokens, credentials or private client data.",
                  "For delete or clear, ask the user for approval and pass confirm=true only after approval.",
                  "Do not claim a change was saved until the tool confirms success.",
                  "",
                  "User request:",
                  input.prompt.text.trim() || "Read and summarize global preferences; do not modify them.",
                ].join("\n"),
                delivery: input.delivery,
              })
              .pipe(Effect.asVoid),
        })

        editor.add({
          name: "memory",
          description: "Persistent Memory Bank (.omnicode/memory-bank/): reads or updates project memory bank files",
          execute: (input) =>
            ctx.session
              .prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  "🧠 [PERSISTENT MEMORY BANK — .omnicode/memory-bank/]\nUse the 'omni_memory' tool to consult or update the project's permanent memory:\n1. 'project-brief.md' — High-level goals, scope, and vision.\n2. 'system-patterns.md' — Architectural patterns and code conventions.\n3. 'tech-context.md' — Tech stack, tools, and run commands.\n4. 'active-context.md' — Current sprint focus and active work.\n\nInstruction:\n$ARGUMENTS",
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
              .pipe(Effect.asVoid),
        })

        editor.add({
          name: "checkpoint",
          description: "Workspace Checkpoints: creates or inspects clean Git restoration snapshots (.omnicode/checkpoints/)",
          execute: (input) =>
            ctx.session
              .prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  "💾 [WORKSPACE CHECKPOINTS & TIME-TRAVEL]\nUse the 'omni_checkpoint' tool (actions: 'create', 'list', 'restore', 'diff') to save a clean restoration snapshot of the repository or inspect existing checkpoints.\n\nInstruction:\n$ARGUMENTS",
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
              .pipe(Effect.asVoid),
        })

        editor.add({
          name: "undo",
          description: "Time-Travel Undo: restores workspace files to the checkpoint prior to AI modifications",
          execute: (input) =>
            ctx.session
              .prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  "⏪ [TIME-TRAVEL UNDO]\nExecute the 'omni_checkpoint' tool with action: 'restore' to roll back the workspace to the state of the last checkpoint before AI edits.\n\nInstruction:\n$ARGUMENTS",
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
              .pipe(Effect.asVoid),
        })

        editor.add({
          name: "heal",
          description: "Self-Healing Test Loop: runs test suite/typecheck and fixes errors in a loop until 100% pass",
          execute: (input) =>
            ctx.session
              .prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  "🔄 [SELF-HEALING AUTONOMOUS LOOP]\n1. Execute 'omni_heal' (action: 'run_and_heal') with a test or typecheck command.\n2. If failures occur, inspect the extracted traceback and affected files.\n3. Apply targeted fixes via @coder.\n4. Re-run tests until 100% of checks pass with exit code 0.\n\nCommand or scope:\n$ARGUMENTS",
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
              .pipe(Effect.asVoid),
        })

        editor.add({
          name: "commit",
          description: "Intelligent Auto-Commit: analyzes git diff and creates an atomic conventional commit",
          execute: (input) =>
            ctx.session
              .prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  "🏷️ [INTELLIGENT AUTO-COMMIT]\n1. Use 'omni_commit' (action: 'status') to inspect changed files.\n2. Generate or confirm a conventional message with 'generate_message' or use 'commit_all' to commit atomically.\n\nOptional message:\n$ARGUMENTS",
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
              .pipe(Effect.asVoid),
        })

        editor.add({
          name: "team",
          description: "Full Team Pipeline: 4 autonomous phases (@planner -> @architect -> @coder -> @reviewer)",
          execute: (input) =>
            Effect.gen(function* () {
              const goal = input.prompt.text.trim() || "Execute complete team pipeline"
              const missionID = `mission-${crypto.randomUUID()}`
              if (Option.isSome(orchestratorOpt)) {
                yield* planAndPersistMission({
                  missionID,
                  goal,
                  mode: "team",
                  fallbackSessionID: "team-local",
                  plan: (id) => orchestratorOpt.value.planTeamPipeline(goal, id),
                  save: Option.isSome(omniSessionOpt) ? omniSessionOpt.value.save : undefined,
                })
              }
              yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: append(
                  `🎯 [TEAM PIPELINE — CONTROLLED EXECUTION]\n${missionControlInstructions(missionID)}\nStarting execution with multidisciplinary specialist team:\n1. @planner: Formal requirements specification, acceptance criteria, and scope.\n2. @architect: Interface design, schemas, type contracts, and module boundaries.\n3. @coder: Atomic implementation of modules and test suites.\n4. @reviewer: Security audit, git diff review, and report test results accurately.\n\nMission goal:\n$ARGUMENTS`,
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })
      }

      const executeGrillme = (input: Parameters<Parameters<typeof editor.add>[0]["execute"]>[0]) =>
        Effect.gen(function* () {
          const key = `grillme:v1:${input.sessionID}`
          const freshState = () => ({
            version: 1 as const,
            status: "interviewing" as const,
            specReady: false,
            answers: [] as string[],
            updatedAt: new Date().toISOString(),
          })
          const saved = yield* ctx.storage.get(key)
          const state = Option.getOrElse(Schema.decodeUnknownOption(GrillmeState)(saved), freshState)
          const answer = input.prompt.text.trim()
          const restartMatch = answer.match(
            /^(?:reset|restart|reiniciar|recome[cç]ar|nova entrevista)(?:\s+([\s\S]+))?$/i,
          )
          const isRestart = restartMatch !== null
          const restartTopic = restartMatch?.[1]?.trim() ?? ""
          const effectiveAnswer = isRestart ? restartTopic : answer
          const baseState = isRestart ? freshState() : state

          const approved = /^(?:(?:i|eu)\s+)?(?:approve|aprovar|aprovo)(?:\s+(?:implementation|implementa[cç][aã]o))?[.!]?$/i.test(
            effectiveAnswer,
          )
          const cancelled = /^(?:cancel|cancelar|stop grillme|parar grillme)[.!]?$/i.test(effectiveAnswer)
          const confirmsSpec = /^(?:(?:spec|specification)\s+ready|(?:spec|especifica[cç][aã]o)\s+pronta)[.!]?$/i.test(
            effectiveAnswer,
          )

          const isTerminal = baseState.status === "approved" || baseState.status === "cancelled"

          // A substantive answer (not control commands) clears specReady.
          const isSubstantiveAnswer = Boolean(effectiveAnswer) && !approved && !cancelled && !confirmsSpec
          const nextSpecReady = confirmsSpec
            ? true
            : isSubstantiveAnswer
              ? false
              : baseState.specReady ?? false

          const nextStatus = isTerminal
            ? baseState.status
            : cancelled
              ? "cancelled"
              : confirmsSpec
                ? "spec_ready"
                : approved && nextSpecReady
                  ? "approved"
                  : "interviewing"

          // Keep terminal sessions fully immutable unless explicitly restarted.
          const updated = isTerminal
            ? baseState
            : {
                ...baseState,
                status: nextStatus,
                specReady: nextSpecReady,
                answers: isSubstantiveAnswer ? [...baseState.answers, effectiveAnswer] : baseState.answers,
                updatedAt: new Date().toISOString(),
              }
          yield* ctx.storage.set(key, updated)
          yield* ctx.session.prompt({
            ...input.prompt,
            sessionID: input.sessionID,
            text: [
              "[GRILLME — ITERATIVE TECHNICAL INTERVIEW]",
              `Status: ${updated.status}. Persisted answers/context: ${JSON.stringify(updated.answers)}.`,
              "Inspect relevant repository code, keep a concise record of requirements, decisions, affected files/modules, tests, acceptance criteria, and implementation plan. Ask exactly ONE focused clarification question in each response.",
              "Whenever the question has concrete design choices or trade-offs, prefer calling the interactive `question` tool (with a `(Recommended)` first option) so the user can select or type an answer directly in the UI.",
              "When discovery is sufficient, provide a specification with exactly 14 sections: 1. Summary, 2. Goals, 3. Non-goals, 4. User stories, 5. Requirements, 6. Decisions, 7. Architecture, 8. Files/modules, 9. Data/API changes, 10. Security/privacy, 11. Testing, 12. Acceptance criteria, 13. Risks/open questions, 14. Implementation plan. Then stop and wait for explicit user approval (tell the user they can run `/grillme spec ready` followed by `/grillme approve`, or `/grillme reset` to start a new interview).",
              "Do not implement during the interview. This prompt is guidance, not a tool-level authorization barrier; existing tool permissions still apply.",
              updated.status === "approved"
                ? "The user explicitly approved implementation after the specification was marked ready. Record this decision in the handoff; do not bypass tool or workspace policy."
                : updated.status === "cancelled"
                  ? "The user explicitly cancelled. Acknowledge cancellation and do not continue unless restarted."
                  : approved && !(updated.specReady ?? false)
                    ? "The user attempted to approve before the specification was marked ready. Do not implement; explain that the interview must produce and present the complete specification first."
                    : updated.status === "spec_ready"
                      ? "The specification is ready. Present it now and ask the user to reply 'approve' to authorize implementation, or continue discussing/revise/cancel."
                      : "Do not infer approval from requirements being complete, silence, or ambiguous text. Only a standalone explicit approval phrase counts after the specification is presented.",
              `Latest user input: ${effectiveAnswer || "(resume)"}`,
            ].join("\n"),
            delivery: input.delivery,
          })
        }).pipe(Effect.asVoid)

      editor.add({
        name: "grillme",
        description: "Interview me about a feature, then produce a specification for explicit review",
        execute: executeGrillme,
      })
      editor.add({
        name: "grill-me",
        description: "Alias for /grillme: iterative technical interview and 14-section specification review",
        execute: executeGrillme,
      })
      editor.add({
        name: "grilme",
        description: "Alias for /grillme: iterative technical interview and 14-section specification review",
        execute: executeGrillme,
      })
      editor.add({
        name: "init",
        description: "Guided AGENTS.md setup for the project",
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
        description: "Review changes [commit|branch|pr], defaults to uncommitted",
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

const GrillmeState = Schema.Struct({
  version: Schema.Literal(1),
  status: Schema.Literals(["interviewing", "spec_ready", "approved", "cancelled"]),
  specReady: Schema.optionalKey(Schema.Boolean),
  answers: Schema.Array(Schema.String),
  updatedAt: Schema.String,
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

export function selectArenaModels(available: ReadonlyArray<Model.Info>) {
  const eligible = available.filter((model) => model.enabled && model.status !== "deprecated")
  if (eligible.length === 0) return Effect.fail(new Error("Arena requires at least one enabled, non-deprecated model"))
  return Effect.succeed(eligible.slice(0, 3).map((model) => `${model.providerID}/${model.id}`))
}

export function planAndPersistMission<T>(input: {
  readonly missionID: string
  readonly goal: string
  readonly mode: string
  readonly fallbackSessionID: string
  readonly plan: (missionID: string) => Effect.Effect<ReadonlyArray<T>>
  readonly save?: (input: OmniSession.SaveSessionInput) => Effect.Effect<string>
}) {
  return Effect.gen(function* () {
    const subtasks = yield* input.plan(input.missionID)
    const sessionID = input.save
      ? yield* input.save({ id: input.missionID, goal: input.goal, mode: input.mode, subtasks })
      : input.fallbackSessionID
    return { subtasks, sessionID }
  })
}
