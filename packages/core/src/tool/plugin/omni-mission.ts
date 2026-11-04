export * as OmniMissionTool from "./omni-mission.js"

import { Effect, Schema } from "effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { OmniOrchestrator } from "../../omni-orchestrator.js"

export const name = "omni_mission"

export const Input = Schema.Struct({
  action: Schema.Literals(["create", "status", "claim", "complete", "fail", "retry"]).annotate({
    description: "create: save dependency graph; status: inspect; claim: reserve runnable tasks; complete/fail/retry: transition task.",
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
  "A claim is a reservation, not work completion. Invoke the assigned agent or tools, then complete only with an actual result.",
  "If a worker cannot run or fails, call fail; report the blocker rather than inventing success.",
  "Retry failed tasks deliberately. Serial stages never run until prior stages complete.",
  "This tool manages the persisted queue; it is not an autonomous background worker.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.omni_mission",
  effect: Effect.fn("OmniMissionTool.Plugin")(function* (ctx: Context) {
    const orchestrator = yield* OmniOrchestrator.Service

    yield* ctx.tool.transform((editor) => {
      if (process.env.OMNICODE_ACTIVE !== "1") return
      editor.add({
        name,
        options: { codemode: false },
        description,
        input: Input,
        output: Output,
        execute: (params) => Effect.gen(function* () {
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
            const tasks = yield* orchestrator.claimReadyTasks(missionID, params.maxParallel ?? 3)
            const summary = tasks.length
              ? `Reserved tasks for ${missionID}; dispatch to assigned agents:\n${describe(tasks)}`
              : `No runnable tasks for ${missionID}. Check status for running, failed or completed stages.`
            return { output: { action: "claim", summary }, content: summary, metadata: { missionID, count: tasks.length } }
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
