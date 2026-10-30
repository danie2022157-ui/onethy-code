export * as InstructionBuiltIns from "./builtins.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import fs from "node:fs"
import path from "node:path"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Global } from "@opencode/util/global"
import { Location } from "../location.js"
import { Instructions } from "./index.js"

export interface Interface {
  readonly load: () => Effect.Effect<Instructions.List>
}


function readMemoryBank(directory: string): string {
  const memDir = path.join(directory, ".omnicode", "memory-bank")
  if (!fs.existsSync(memDir)) {
    return [
      "<auto_memory_bank>",
      "  Status: active",
      "  Location: .omnicode/memory-bank/",
      "  Instruction: Automatically persist key architecture patterns and technical decisions to .omnicode/memory-bank/ using the 'omni_memory' tool.",
      "</auto_memory_bank>",
    ].join("\n")
  }

  const files = ["project-brief.md", "system-patterns.md", "tech-context.md", "active-context.md"]
  const sections: string[] = []
  for (const file of files) {
    const full = path.join(memDir, file)
    if (fs.existsSync(full)) {
      try {
        const content = fs.readFileSync(full, "utf8").trim()
        if (content) {
          sections.push(`### [Memory Bank: ${file}]\n${content}`)
        }
      } catch {}
    }
  }

  if (sections.length === 0) {
    return [
      "<auto_memory_bank>",
      "  Status: initialized-empty",
      "  Location: .omnicode/memory-bank/",
      "  Instruction: Maintain .omnicode/memory-bank/ updated with project architecture patterns and current progress.",
      "</auto_memory_bank>",
    ].join("\n")
  }

  return [
    "<auto_memory_bank>",
    "Durable cross-session project memory loaded automatically from .omnicode/memory-bank/:\n",
    sections.join("\n\n"),
    "\nInstruction: You MUST keep this memory bank in sync whenever architectural decisions or milestones change using 'omni_memory'.",
    "</auto_memory_bank>",
  ].join("\n")
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstructionBuiltIns") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const location = yield* Location.Service
    return Service.of({
      load: () =>
        Effect.succeed(
          Instructions.combine([
            Instructions.make({
              key: Instructions.Key.make("core/date"),
              codec: Schema.toCodecJson(Schema.String),
              read: DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
              render: {
                initial: (date) => `Today's date: ${date}`,
                changed: (_previous, date) => `Today's date is now: ${date}`,
              },
            }),
            Instructions.make({
              key: Instructions.Key.make("core/environment"),
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.sync(() =>
                [
                  "<env>",
                  `  Working directory: ${location.directory}`,
                  `  Workspace root folder: ${location.project.directory}`,
                  `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
                  `  Platform: ${process.platform}`,
                  `  Prefer ${global.tmp} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`,
                  "</env>",
                ].join("\n"),
              ),
              render: {
                initial: (environment) =>
                  ["Here is some useful information about the environment you are running in:", environment].join("\n"),
                changed: (_previous, environment) =>
                  ["The environment you are running in is now:", environment].join("\n"),
              },
            }),
            Instructions.make({
              key: Instructions.Key.make("omnicode/memory-bank"),
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.sync(() => readMemoryBank(location.directory)),
              render: {
                initial: (memory) => memory,
                changed: (_previous, memory) => memory,
              },
            }),
          ]),
        ),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Global.node, Location.node] })
