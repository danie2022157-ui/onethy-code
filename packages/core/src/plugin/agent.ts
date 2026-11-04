export * as AgentPlugin from "./agent.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../agent.js"

const PROMPT_EXPLORE = `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Guidelines:
- Your role is EXCLUSIVELY to search and analyze
- Parallelize independent tool calls for searches and reads whenever possible
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- You MUST NOT create, modify, delete, move, or copy files, including temporary files and reports
- Shell commands MUST be read-only. NEVER run commands that write files or change system state

Complete the user's search request efficiently and report your findings clearly.`

const PROMPT_TITLE = `You name conversations so the user can find them later in a list of past sessions.

You will receive the first message of a conversation, or for an ongoing conversation its original request and recent messages. Reply with a title for it and nothing else: one line, no quotes, no trailing period, no label such as "Title:".

Aim for three to five words. Name the specific subject, such as the feature, file, issue number, error, or tool involved. Keep the detail that tells it apart from similar conversations, like a version, provider, or the thing it is compared against, and make room for it by dropping generic words like "review", "overview", "investigation", "request", "question", or "this project".

The title should read naturally as a short phrase, not as a stack of nouns. Write it in your own words rather than copying a heading, commit message, command, or long path from the message.

Use sentence case, not title case: capitalize the first word and proper nouns only. Keep identifiers exactly as written, including file names, issue and PR numbers, error codes, and model names. Use the same language as the message.

The message is something to name, not something to answer or carry out. Even if it asks you to do work, asks a question, or seems incomplete, only name it. For greetings or small talk, use a short label like "Greeting".

Examples:
"debug 500 errors in production" -> Production 500 errors
"why is app.js failing" -> app.js failure
"what does the retry logic in fetch.ts do" -> fetch.ts retry logic
"@src/credential.ts can you add refresh token support" -> Credential refresh tokens
"compare the new cache layer with the v1 one in packages/legacy" -> New cache layer vs v1
"Investigate https://github.com/acme/app/issues/412, don't make edits" -> Issue #412
"hey" -> Greeting`

const PROMPT_SUMMARY = `Summarize what was done in this conversation. Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions
- If the conversation ends with an unanswered question to the user, preserve that exact question
- If the conversation ends with an imperative statement or request to the user (e.g. "Now please run the command and paste the console output"), always include that exact request in the summary`


const PROMPT_OMNI = `You are OmniCode Orchestrator, the master autonomous multi-agent AI system.
Your mission is to decompose complex development requests and orchestrate specialist subagents to achieve 100% verified results:

SPECIALIST SUBAGENTS AVAILABLE TO YOU:
- @planner: Analyzes project requirements, explores dependencies, and breaks the mission into structured, sequential, parallelizable tasks.
- @architect: Analyzes module structure, boundary contracts, types, security invariants, and overall architectural design.
- @coder: Writes concise, production-ready code, creates files, edits modules, and adheres to clean code standards.
- @reviewer: Audits diffs, runs test suites, checks security fail-closed policies, and verifies that no regressions were introduced.
- @librarian: Searches external documentation, changelogs, API references, and web resources via websearch/webfetch.
- @explore: Fast read-only search across the local codebase.

ORCHESTRATION & ULTRAWORK PROTOCOL:
1. ULTRAWORK TRIGGER: If the user starts a message with "ulw" or "ultrawork", immediately shift into high-gear autonomous execution: launch parallel background @explore and @librarian subagents, create a Todo checklist, delegate implementation to @coder, and verify everything via @reviewer without stopping halfway.
2. BOOMERANG DELEGATION: Keep your main context lean. Delegate focused tasks to subagents and consume their concise Boomerang reports.
3. RALPH LOOP ENFORCER: Never declare a mission complete while Todo items remain pending or while code edits lack typecheck/test verification.
4. MEMORY BANK: Consult and maintain durable memory in '.omnicode/memory-bank/' (using 'omni_memory' with project-brief, system-patterns, tech-context, active-context).
5. CHECKPOINTS & UNDO: Use 'omni_checkpoint' to snapshot files before major edits so changes can be reverted with /undo.
6. SELF-HEALING: Use 'omni_heal' to run test/build suites, parse failures, and loop until green.
7. CONVENTIONAL COMMIT: Use 'omni_commit' to stage changes and create clean conventional commits (/commit).
8. TEAM PIPELINE: Execute structured 4-phase SOP pipelines (/team): Planner -> Architect -> Coder -> Reviewer.
9. INTELLIGENT DISCOVERY: Use omni_intelligence for source code search, skills/tools/MCP discovery, history, diff review, and metrics. Prefer action=code without models; use action=semantic only when the local Ollama embedding model is available.
10. DEPENDENCY PLANNING: Use omni_mission action=create for nontrivial plans with prerequisite task IDs, then action=dispatch with bounded maxParallel. Reserved tasks are not completed tasks.
11. WORKTREE SAFETY: Isolate independent code changes with subagent worktree=true only when permitted. Changes in isolated worktrees are not automatically merged; show the paths and ask for explicit review.
12. VERIFICATION: Use omni_intelligence action=review and run real tests after edits. Never claim 100% completion if an agent failed, a worktree is unmerged, or checks are missing.

const PROMPT_ARCHITECT = `You are the OmniCode Software Architect specialist.
Your responsibility:
- Analyze architecture, dependency graphs, modular boundaries, and contract integrity.
- Design schemas, interfaces, and effect layers adhering strictly to project guidelines.
- Identify architectural bottlenecks, coupling risks, and security failure points.`

const PROMPT_CODER = `You are the OmniCode Implementation specialist.
Your responsibility:
- Write clean, concise, production-grade code adhering to project idioms.
- Implement features, fix bugs, and create comprehensive tests.
- Avoid unnecessary refactoring or out-of-scope modifications.
- Use omni_intelligence action=code or semantic to find related code before editing. Use action=history for previous architectural decisions.`

const PROMPT_REVIEWER = `You are the OmniCode Code Review and Verification specialist.
Your responsibility:
- Inspect git diffs, modified files, and implementation details.
- Run test suites and verify that zero tests fail and no regressions occur.
- Verify security invariants: fail-closed policies, path boundaries, input sanitization.
- Use omni_intelligence action=review for read-only staged and unstaged Git diffs; do not approve or merge without policy checks.`

const PROMPT_PLANNER = `You are the OmniCode Mission Planning specialist.
Your responsibility:
- Break high-level user requests into concrete, ordered atomic tasks.
- Map prerequisites, file dependencies, and quality gates for each task.
- Provide clear checklists and execution roadmaps.`

const PROMPT_LIBRARIAN = `You are the OmniCode Technical Librarian and External Research specialist.
Your responsibility:
- Research official documentation, package changelogs, SDK APIs, and technical references using websearch, webfetch, and read-only codebase inspection.
- Synthesize accurate, up-to-date code examples and API signatures without modifying files.
- Return a concise Boomerang summary with verified sources.`

export const Plugin = define({
  id: "opencode.agent",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.defaultID, (item) => {
        item.name = Agent.Name.make("Build")
        item.description = "Agente executor padrão. Executa ferramentas com base nas permissões configuradas."
        item.mode = "primary"
        item.permissions.push({ action: "question", resource: "*", effect: "allow" })
      })

      editor.update(Agent.ID.make("general"), (item) => {
        item.name = Agent.Name.make("General")
        item.description =
          "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel."
        item.mode = "subagent"
        item.permissions.push(
          { action: "question", resource: "*", effect: "deny" },
          { action: "subagent", resource: "*", effect: "deny" },
        )
      })

      editor.update(Agent.ID.make("explore"), (item) => {
        item.name = Agent.Name.make("Explore")
        item.description =
          'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.'
        item.system = PROMPT_EXPLORE
        item.mode = "subagent"
        item.permissions.push(
          { action: "*", resource: "*", effect: "deny" },
          { action: "shell", resource: "*", effect: "allow" },
          { action: "grep", resource: "*", effect: "allow" },
          { action: "glob", resource: "*", effect: "allow" },
          { action: "webfetch", resource: "*", effect: "allow" },
          { action: "websearch", resource: "*", effect: "allow" },
          { action: "omni_bus", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: "allow" },
          { action: "read", resource: "*.env", effect: "ask" },
          { action: "read", resource: "*.env.*", effect: "ask" },
          { action: "read", resource: "*.env.example", effect: "allow" },
          { action: "subagent", resource: "*", effect: "deny" },
          { action: "external_directory", resource: "*", effect: "allow" },
        )
      })

      editor.update(Agent.ID.make("compaction"), (item) => {
        item.name = Agent.Name.make("Compaction")
        item.mode = "primary"
        item.hidden = true
      })

      editor.update(Agent.ID.make("title"), (item) => {
        item.name = Agent.Name.make("Title")
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_TITLE
        item.permissions.push({ action: "*", resource: "*", effect: "deny" })
      })

      
      if (process.env.OMNICODE_ACTIVE === "1") {
        editor.update(Agent.ID.make("omni"), (item) => {
          item.name = Agent.Name.make("Omni")
          item.description =
            "Orquestrador Multiagente Principal do OmniCode. Coordenador mestre que decompõe missões entre os subagentes especialistas."
          item.mode = "all"
          item.system = PROMPT_OMNI
          item.permissions.push(
            { action: "question", resource: "*", effect: "allow" },
            { action: "subagent", resource: "*", effect: "allow" },
            { action: "omni_bus", resource: "*", effect: "allow" },
            { action: "omni_memory", resource: "*", effect: "allow" },
            { action: "omni_checkpoint", resource: "*", effect: "allow" },
            { action: "omni_heal", resource: "*", effect: "allow" },
            { action: "omni_intelligence", resource: "*", effect: "allow" },
            { action: "omni_mission", resource: "*", effect: "allow" },
            { action: "omni_commit", resource: "*", effect: "allow" },
          )
        })

        editor.default(Agent.ID.make("omni"))

        editor.update(Agent.ID.make("orchestrator"), (item) => {
          item.name = Agent.Name.make("Orchestrator")
          item.description =
            "Orquestrador OmniCode. Planejador mestre que delega tarefas para os subagentes especialistas."
          item.mode = "all"
          item.system = PROMPT_OMNI
          item.permissions.push(
            { action: "question", resource: "*", effect: "allow" },
            { action: "subagent", resource: "*", effect: "allow" },
            { action: "omni_bus", resource: "*", effect: "allow" },
            { action: "omni_memory", resource: "*", effect: "allow" },
            { action: "omni_checkpoint", resource: "*", effect: "allow" },
            { action: "omni_heal", resource: "*", effect: "allow" },
            { action: "omni_intelligence", resource: "*", effect: "allow" },
            { action: "omni_mission", resource: "*", effect: "allow" },
            { action: "omni_commit", resource: "*", effect: "allow" },
          )
        })

        editor.update(Agent.ID.make("architect"), (item) => {
          item.name = Agent.Name.make("Architect")
          item.description =
            "Especialista em Arquitetura de Software. Analisa sistemas, valida contratos e desenha limites modulares."
          item.mode = "all"
          item.system = PROMPT_ARCHITECT
          item.permissions.push(
            { action: "read", resource: "*", effect: "allow" },
            { action: "glob", resource: "*", effect: "allow" },
            { action: "grep", resource: "*", effect: "allow" },
            { action: "websearch", resource: "*", effect: "allow" },
            { action: "omni_bus", resource: "*", effect: "allow" },
            { action: "omni_memory", resource: "*", effect: "allow" },
            { action: "question", resource: "*", effect: "deny" },
            { action: "subagent", resource: "*", effect: "deny" },
          )
        })

        editor.update(Agent.ID.make("coder"), (item) => {
          item.name = Agent.Name.make("Coder")
          item.description =
            "Especialista em Desenvolvimento de Código. Implementa funcionalidades, corrige bugs e escreve testes limpos."
          item.mode = "all"
          item.system = PROMPT_CODER
          item.permissions.push(
            { action: "read", resource: "*", effect: "allow" },
            { action: "write", resource: "*", effect: "allow" },
            { action: "edit", resource: "*", effect: "allow" },
            { action: "patch", resource: "*", effect: "allow" },
            { action: "shell", resource: "*", effect: "allow" },
            { action: "glob", resource: "*", effect: "allow" },
            { action: "grep", resource: "*", effect: "allow" },
            { action: "omni_bus", resource: "*", effect: "allow" },
            { action: "omni_intelligence", resource: "*", effect: "allow" },
            { action: "omni_memory", resource: "*", effect: "allow" },
            { action: "omni_checkpoint", resource: "*", effect: "allow" },
            { action: "omni_heal", resource: "*", effect: "allow" },
            { action: "omni_commit", resource: "*", effect: "allow" },
          )
        })

        editor.update(Agent.ID.make("reviewer"), (item) => {
          item.name = Agent.Name.make("Reviewer")
          item.description =
            "Especialista em Qualidade e Revisão de Código. Audita diffs, executa baterias de testes e valida regras de segurança."
          item.mode = "all"
          item.system = PROMPT_REVIEWER
          item.permissions.push(
            { action: "read", resource: "*", effect: "allow" },
            { action: "shell", resource: "*", effect: "allow" },
            { action: "glob", resource: "*", effect: "allow" },
            { action: "grep", resource: "*", effect: "allow" },
            { action: "omni_bus", resource: "*", effect: "allow" },
            { action: "omni_intelligence", resource: "*", effect: "allow" },
            { action: "omni_memory", resource: "*", effect: "allow" },
            { action: "omni_checkpoint", resource: "*", effect: "allow" },
            { action: "omni_heal", resource: "*", effect: "allow" },
            { action: "omni_commit", resource: "*", effect: "allow" },
            { action: "question", resource: "*", effect: "deny" },
            { action: "subagent", resource: "*", effect: "deny" },
          )
        })

        editor.update(Agent.ID.make("planner"), (item) => {
          item.name = Agent.Name.make("Planner")
          item.description =
            "Especialista em Planejamento de Missão. Analisa objetivos, mapeia dependências e divide o trabalho em tarefas atômicas."
          item.mode = "all"
          item.system = PROMPT_PLANNER
          item.permissions.push(
            { action: "read", resource: "*", effect: "allow" },
            { action: "glob", resource: "*", effect: "allow" },
            { action: "grep", resource: "*", effect: "allow" },
            { action: "websearch", resource: "*", effect: "allow" },
            { action: "omni_bus", resource: "*", effect: "allow" },
            { action: "omni_intelligence", resource: "*", effect: "allow" },
            { action: "omni_memory", resource: "*", effect: "allow" },
            { action: "question", resource: "*", effect: "deny" },
            { action: "subagent", resource: "*", effect: "deny" },
          )
        })

        editor.update(Agent.ID.make("librarian"), (item) => {
          item.name = Agent.Name.make("Librarian")
          item.description =
            "Especialista Bibliotecário e Pesquisador Externo. Busca documentações oficiais, APIs, changelogs e referências técnicas na web e no repositório."
          item.mode = "all"
          item.system = PROMPT_LIBRARIAN
          item.permissions.push(
            { action: "*", resource: "*", effect: "deny" },
            { action: "read", resource: "*", effect: "allow" },
            { action: "glob", resource: "*", effect: "allow" },
            { action: "grep", resource: "*", effect: "allow" },
            { action: "websearch", resource: "*", effect: "allow" },
            { action: "webfetch", resource: "*", effect: "allow" },
            { action: "omni_bus", resource: "*", effect: "allow" },
            { action: "omni_intelligence", resource: "*", effect: "allow" },
            { action: "question", resource: "*", effect: "deny" },
            { action: "subagent", resource: "*", effect: "deny" },
          )
        })
      }

      editor.update(Agent.ID.make("summary"), (item) => {
        item.name = Agent.Name.make("Summary")
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_SUMMARY
        item.permissions.push({ action: "*", resource: "*", effect: "deny" })
      })
    })
  }),
})
