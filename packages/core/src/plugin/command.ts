export * as CommandPlugin from "./command.js"

import crypto from "node:crypto"
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
                  `You are the OmniCode Multi-Agent Orchestrator (Mission Session: ${missionSessionId}).\nSubtasks registered on OmniBus:\n${taskSummary}\n\nCoordinate specialists (@planner, @architect, @coder, @reviewer, @explore) to achieve this goal:\n\n$ARGUMENTS`,
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
                `⚡ [ULTRAWORK MODE ACTIVE — Session: ${missionSessionId}]\nPlan persisted at: ${planPath}\n\nGenerated subtasks:\n${taskSummary}\n\nULTRAWORK DIRECTIVES:\n1. Launch @explore and @librarian in parallel (background=true) when applicable.\n2. Create and maintain the Todo checklist.\n3. Delegate implementation to @coder with concise Boomerang responses.\n4. Apply RALPH LOOP ENFORCER: run @reviewer + typecheck/tests and DO NOT stop until 100% of items are verified.\n\nGoal:\n$ARGUMENTS`,
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
                  "🎯 [FULL TEAM PIPELINE — 4 AUTONOMOUS PHASES]\nStarting execution with multidisciplinary specialist team:\n1. @planner: Formal requirements specification, acceptance criteria, and scope.\n2. @architect: Interface design, schemas, type contracts, and module boundaries.\n3. @coder: Atomic implementation of modules and test suites.\n4. @reviewer: Security audit, git diff review, and 100% green tests verification (Ralph Loop).\n\nMission goal:\n$ARGUMENTS",
                  input.prompt.text,
                ),
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })

        editor.add({
          name: "auto-customizations",
          description: "Auto-Customizations Orchestrator: configures proactive use of skills, agents, MCPs, hooks, and mods",
          execute: (input) =>
            Effect.gen(function* () {
              const cfg = OmniOrchestrator.getAutoCustomizationsConfig()
              const summary = [
                `Global Orchestration Status: ${cfg.enabled ? "ENABLED" : "DISABLED"}`,
                `- Specialized Skills: ${cfg.useSkills ? "Yes" : "No"}`,
                `- Specialist Subagents (@architect, @coder, etc.): ${cfg.useAgents ? "Yes" : "No"}`,
                `- Connected MCP Servers: ${cfg.useMcps ? "Yes" : "No"}`,
                `- Hooks & Triggers: ${cfg.useHooks ? "Yes" : "No"}`,
                `- Mods & Plugins: ${cfg.useMods ? "Yes" : "No"}`,
                `- Slash Commands & Loops: ${cfg.useCommands ? "Yes" : "No"}`,
                `- Modes & Settings: ${cfg.useSettings ? "Yes" : "No"}`,
              ].join("\n")
              yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: `⚙️ [PROACTIVE RESOURCE AUTO-ORCHESTRATION CONFIG]\n${summary}\n\nTip: To adjust these options interactively with a single keypress, open the selector via /variants, /agents, or the customizations dialog.\n\n$ARGUMENTS`,
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })
      }

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
