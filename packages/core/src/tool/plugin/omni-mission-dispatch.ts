export * as OmniMissionDispatchTool from "./omni-mission-dispatch.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Context as ToolContext } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { OmniOrchestrator } from "../../omni-orchestrator.js"
import { Tool } from "../../tool.js"

export const name = "omni_mission_dispatch"
export const Input = Schema.Struct({
  missionID: Schema.String,
  taskID: Schema.String,
})
export const Output = Schema.Struct({
  missionID: Schema.String,
  taskID: Schema.String,
  childSessionID: Schema.String,
  status: Schema.Literals(["completed", "failed"]),
  output: Schema.String,
})
export const description = "Dispatch one dependency-ready OmniOrchestrator mission task to its assigned agent. Runs foreground and records lifecycle from the actual subagent outcome."

export const Plugin = {
  id: "opencode.tool.omni_mission_dispatch",
  effect: Effect.fn("OmniMissionDispatchTool.Plugin")(function* (ctx: Context) {
    const tools = yield* Tool.Service
    const orchestrator = yield* OmniOrchestrator.Service
    yield* ctx.tool.transform((editor) => {
      if (process.env.OMNICODE_ACTIVE !== "1") return
      editor.add({
        name,
        options: { codemode: false },
        description,
        input: Input,
        output: Output,
        execute: (input, context: ToolContext) => Effect.gen(function* () {
          const task = (yield* orchestrator.getActiveTasks(input.missionID)).find((item) => item.id === input.taskID)
          if (!task) return yield* new ToolFailure({ message: `Task ${input.taskID} is not part of mission ${input.missionID}.` })
          if (!(yield* orchestrator.getReadyTasks(input.missionID)).some((item) => item.id === task.id))
            return yield* new ToolFailure({ message: `Task ${input.taskID} is not ready; dependencies must complete first.` })
          const missionGoal = yield* orchestrator.getMissionGoal(input.missionID)
          const completedDependencies = (yield* orchestrator.getActiveTasks(input.missionID))
            .filter((item) => task.dependsOn.includes(item.id) && item.status === "completed")
          const dependencyResults = completedDependencies.length
            ? completedDependencies.map((item) => `- ${item.title} (${item.id}): ${item.result ?? "Completed without a result summary."}`).join("\n")
            : "None."
          yield* orchestrator.startTask(input.missionID, task.id)
          return yield* Effect.gen(function* () {
            const snapshot = yield* tools.snapshot()
            if (!snapshot.definitions.some((definition) => definition.name === "subagent"))
              return yield* new ToolFailure({ message: "The subagent tool is unavailable." })
            const result = yield* snapshot.execute({
              sessionID: context.sessionID,
              agent: context.agent,
              messageID: context.messageID,
              call: {
                type: "tool-call",
                id: context.id,
                name: "subagent",
                input: {
                  agent: task.assignedAgent,
                  description: task.title.slice(0, 60),
                  prompt: `Mission goal:\n${missionGoal ?? "Not available."}\n\nTask:\n${task.title}\n\nCompleted dependency results:\n${dependencyResults}\n\nAcceptance criteria:\n${task.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`,
                  background: false,
                },
              },
            }).pipe(Effect.catchTag("Tool.Error", (error) => Effect.fail(new ToolFailure({ message: error.message, error }))))
            const subagent = result.output
            if (subagent.status !== "completed" || typeof subagent.output !== "string")
              return yield* new ToolFailure({ message: "Subagent did not return a completed result." })
            if (subagent.sessionID) yield* orchestrator.startTask(input.missionID, task.id, subagent.sessionID)
            yield* orchestrator.executeTask(input.missionID, task.id, subagent.output)
            return {
              output: { missionID: input.missionID, taskID: task.id, childSessionID: subagent.sessionID ?? "", status: "completed" as const, output: subagent.output },
              content: subagent.output,
              metadata: { missionID: input.missionID, taskID: task.id, childSessionID: subagent.sessionID, status: "completed" },
            }
          }).pipe(Effect.onExit((exit) => {
            if (exit._tag === "Success") return Effect.void
            return Effect.exit(Effect.gen(function* () {
              const running = (yield* orchestrator.getActiveTasks(input.missionID)).find((item) => item.id === task.id && item.status === "running")
              if (running) yield* orchestrator.failTask(input.missionID, task.id, "Mission task dispatch was interrupted or failed.")
            }))
          }))
        }),
      })
    })
  }),
}
