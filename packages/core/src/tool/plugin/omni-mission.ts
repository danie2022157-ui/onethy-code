export * as OmniMissionTool from "./omni-mission.js"

import { Effect, Schema } from "effect"
import crypto from "node:crypto"
import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { OmniOrchestrator } from "../../omni-orchestrator.js"
import { Tool } from "../../tool.js"
import { efficiencyProfile } from "../../efficiency-profile.js"

export const name = "omni_mission"

export const Input = Schema.Struct({
  action: Schema.Literals(["create", "status", "claim", "dispatch", "complete", "fail", "retry"]).annotate({
    description: "create: dependency graph; status: inspect; claim: reserve only; dispatch: run workers and verify completion; complete/fail/retry: task transitions.",
  }),
  missionID: Schema.String.annotate({ description: "Mission ID; existing for all actions except create." }),
  goal: Schema.optionalKey(Schema.String).annotate({ description: "Required to create a mission." }),
  tasks: Schema.optionalKey(Schema.Array(Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    assignedAgent: Schema.String,
    dependsOn: Schema.optionalKey(Schema.Array(Schema.String)),
  }))).annotate({ description: "New mission tasks and their prerequisite IDs." }),
  taskId: Schema.optionalKey(Schema.String).annotate({ description: "Required for complete, fail and retry." }),
  result: Schema.optionalKey(Schema.String).annotate({ description: "Required non-empty evidence/summary for complete or fail." }),
  isolateWorkers: Schema.optionalKey(Schema.Boolean).annotate({ description: "Use native isolated worktrees for coding workers during dispatch (default true)." }),
  maxParallel: Schema.optionalKey(Schema.Number).annotate({
    description: "Claim at most this many tasks. Integer from 1 to 8, default 3.",
  }),
})

export const Output = Schema.Struct({
  action: Schema.String,
  summary: Schema.String,
})

export const description = [
  "Persistent mission task control for Onethy Code agents.",
  "Create plans with an acyclic dependency graph, then claim runnable tasks.",
  "Call status before coordinating work. Claim runnable stages before executing them.",
  "dispatch starts real subagents in bounded parallel batches; work is completed only on confirmed results.",
  "A claim is a reservation, not work completion. Invoke the assigned agent or tools, then complete only with an actual result.",
  "If a worker cannot run or fails, call fail; report the blocker rather than inventing success.",
  "Retry failed tasks deliberately. Serial stages never run until prior stages complete.",
  "dispatch runs during this tool call, not as a permanently running background service.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.omni_mission",
  effect: Effect.fn("OmniMissionTool.Plugin")(function* (ctx: Context) {
    const orchestrator = yield* OmniOrchestrator.Service
    const tools = yield* Tool.Service

    yield* ctx.tool.transform((editor) => {
      if (process.env.OMNICODE_ACTIVE !== "1") return
      editor.add({
        name,
        options: { codemode: false },
        description,
        input: Input,
        output: Output,
        execute: (params, context) => Effect.gen(function* () {
          const missionID = params.missionID.trim()
          if (!missionID) return yield* new ToolFailure({ message: "missionID is required." })
          if (params.maxParallel !== undefined && (!Number.isInteger(params.maxParallel) || params.maxParallel < 1 || params.maxParallel > 8)) {
            return yield* new ToolFailure({ message: "maxParallel must be an integer from 1 to 8." })
          }
          const taskId = params.taskId?.trim()
          if (["complete", "fail", "retry"].includes(params.action) && !taskId) {
            return yield* new ToolFailure({ message: "taskId is required for complete, fail or retry." })
          }
          if (["complete", "fail"].includes(params.action) && !params.result?.trim()) {
            return yield* new ToolFailure({ message: "An actual non-empty work result or failure reason is required." })
          }

          if (params.action === "create") {
            if (!params.goal?.trim() || !params.tasks?.length)
              return yield* new ToolFailure({ message: "A goal and at least one task are required for create." })
            const created = yield* orchestrator.createMission(params.goal, missionID, params.tasks).pipe(
              Effect.catchAllCause((cause) => new ToolFailure({
                message: "Cannot create mission; check plan dependencies, uniqueness and IDs.",
                error: cause,
              })),
            )
            const summary = "Mission " + missionID + " created with dependency graph:\n" +
              created.map((task) =>
                "[" + task.status + "] " + task.id + " @" + task.assignedAgent +
                " dependsOn=" + JSON.stringify(task.dependsOn ?? []) + " — " + task.title,
              ).join("\n")
            return { output: { action: "create", summary }, content: summary, metadata: { missionID, count: created.length } }
          }

          const describe = (tasks: ReadonlyArray<{ id: string; title: string; assignedAgent: string; status: string; result?: string }>) =>
            tasks.length ? tasks.map((task) =>
              `[${task.status}] ${task.id} @${task.assignedAgent}: ${task.title}${task.result ? ` — ${task.result.slice(0, 500)}` : ""}`
            ).join("\n") : "No tasks found for this mission."

          if (params.action === "status") {
            const tasks = yield* orchestrator.getActiveTasks(missionID)
            const summary = `Mission ${missionID}:\n${describe(tasks)}`
            return { output: { action: "status", summary }, content: summary, metadata: { missionID, count: tasks.length } }
          }
          if (params.action === "claim") {
            const tasks = yield* orchestrator.claimReadyTasks(missionID, params.maxParallel ?? efficiencyProfile().parallel)
            const summary = tasks.length
              ? `Reserved tasks for ${missionID}; dispatch to assigned agents:\n${describe(tasks)}`
              : `No runnable tasks for ${missionID}. Check status for running, failed or completed stages.`
            return { output: { action: "claim", summary }, content: summary, metadata: { missionID, count: tasks.length } }
          }

          if (params.action === "dispatch") {
            const existing = yield* orchestrator.getActiveTasks(missionID)
            if (!existing.length) return yield* new ToolFailure({ message: "Cannot dispatch an unknown or empty mission." })
            const maxParallel = params.maxParallel ?? efficiencyProfile().parallel
            const maxRounds = efficiencyProfile().missionRounds
            const outcomes: string[] = []
            const isolate = params.isolateWorkers ?? true
            for (let round = 0; round < maxRounds; round++) {
              const claimed = yield* orchestrator.claimReadyTasks(missionID, maxParallel)
              if (!claimed.length) break
              const snapshot = yield* tools.snapshot()
              const batch = yield* Effect.forEach(claimed, (task) =>
                Effect.gen(function* () {
                  const worktree = isolate && task.assignedAgent === "coder"
                  const result = yield* snapshot.execute({
                    sessionID: context.sessionID,
                    agent: context.agent,
                    messageID: context.messageID,
                    call: {
                      type: "tool-call",
                      id: "call_mission_" + crypto.randomUUID(),
                      name: "subagent",
                      input: {
                        agent: task.assignedAgent,
                        description: task.title.slice(0, 80),
                        prompt: [
                          "Mission: " + missionID + " / Task: " + task.id,
                          "Assigned goal: " + task.title,
                          "Dependencies already verified: " + JSON.stringify(task.dependsOn ?? []),
                          "Do actual work in the project. Follow permissions. Report real changes, tests and blockers.",
                          "Do not mark this mission task complete. Supervisor verifies your return.",
                        ].join("\n"),
                        background: false,
                        worktree,
                      },
                    },
                  })
                  const output = result.output
                  const summary = output && typeof output === "object" && "output" in output &&
                    typeof output.output === "string" ? output.output : "Subagent completed without a textual report."
                  if (result.metadata?.status !== "completed")
                    return { task, passed: false, summary: "Worker did not confirm completion." }
                  return { task, passed: true, summary: summary.slice(0, 7000) }
                }).pipe(
                  Effect.catchAllCause((cause) => Effect.succeed({
                    task, passed: false, summary: "Worker execution failed; check permissions and model availability. " +
                      String(cause).slice(0, 1000),
                  })),
                ), { concurrency: maxParallel })
              for (const outcome of batch) {
                if (outcome.passed) {
                  yield* orchestrator.executeTask(missionID, outcome.task.id, outcome.summary)
                  outcomes.push("[done] " + outcome.task.id + " @" + outcome.task.assignedAgent)
                } else {
                  yield* orchestrator.failTask(missionID, outcome.task.id, outcome.summary)
                  outcomes.push("[failed] " + outcome.task.id + " @" + outcome.task.assignedAgent +
                    ": " + outcome.summary.slice(0, 300))
                }
              }
              if (batch.some((outcome) => !outcome.passed)) break
            }
            const final = yield* orchestrator.getActiveTasks(missionID)
            const summary = [
              "Mission " + missionID + " dispatch results:",
              ...outcomes,
              "",
              describe(final),
              "",
              final.some((task) => task.status !== "completed")
                ? "Mission incomplete or execution budget reached. Review pending, running or failed tasks before retry."
                : "All mission tasks were confirmed completed by their subagents. Run final review and tests before merging.",
            ].join("\n")
            return { output: { action: "dispatch", summary }, content: summary, metadata: {
              missionID, executed: outcomes.length, complete: final.every((task) => task.status === "completed"),
            } }
          }

          const task = params.action === "complete"
            ? yield* orchestrator.executeTask(missionID, taskId!, params.result!.trim())
            : params.action === "fail"
              ? yield* orchestrator.failTask(missionID, taskId!, params.result!.trim())
              : yield* orchestrator.retryTask(missionID, taskId!)
          const summary = `Mission ${missionID}: ${describe([task])}`
          return { output: { action: params.action, summary }, content: summary, metadata: { missionID, taskId: task.id, status: task.status } }
        }),
      })
    }).pipe(Effect.asVoid)
  }),
}
