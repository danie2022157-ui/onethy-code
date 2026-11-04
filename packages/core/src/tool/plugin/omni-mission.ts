export * as OmniMissionTool from "./omni-mission.js"

import { Effect, Schema } from "effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { OmniOrchestrator } from "../../omni-orchestrator.js"

export const name = "omni_mission"

export const Input = Schema.Struct({
  action: Schema.Literals(["status", "claim", "complete", "fail", "retry"]).annotate({
    description: "status: inspect tasks; claim: reserve ready tasks; complete/fail: finish running task; retry: requeue a failed task.",
  }),
  missionID: Schema.String.annotate({ description: "Existing mission ID returned by /team, /omni or /ultrawork." }),
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
