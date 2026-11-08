export * as InstructionBuiltIns from "./builtins.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import fs from "node:fs"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Global } from "@opencode/util/global"
import { Location } from "../location.js"
import { Instructions } from "./index.js"
import { OmniOrchestrator } from "../omni-orchestrator.js"
import { boundedMemorySections, efficiencyProfile } from "../efficiency-profile.js"
import { projectMemoryDirectory, readMemoryFile, renderGlobalMemory } from "../omni-memory-bank.js"

export interface Interface {
  readonly load: () => Effect.Effect<Instructions.List>
}


function readMemoryBank(directory: string): string {
  const memDir = projectMemoryDirectory(directory)
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
  const sections: Array<{ name: string; text: string }> = []
  for (const file of files) {
    // A corrupt or unreadable memory file must never prevent the entire app from starting.
    try {
      const content = readMemoryFile(memDir, file)?.trim()
      if (content) sections.push({ name: file, text: content.slice(0, 12000) })
    } catch {
      // Continue loading the remaining trusted local files.
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
    boundedMemorySections(sections, efficiencyProfile().projectMemoryChars).join("\n\n"),
    "\nInstruction: You MUST keep this memory bank in sync whenever architectural decisions or milestones change using 'omni_memory'.",
    "</auto_memory_bank>",
  ].join("\n")
}

function renderAutoCustomizationsDirective(_directory: string): string {
  const config = OmniOrchestrator.getAutoCustomizationsConfig()
  const activeFeatures: string[] = []
  if (config.useSkills) {
    activeFeatures.push(
      "- [SKILLS]: Antes de tarefas especializadas (testes, arquitetura, segurança, UI, SEO etc.), consulte omni_intelligence action=customizations com query relacionado à tarefa para descobrir as skills registradas. Carregue via skill apenas as pertinentes, respeitando permissões; não presuma que uma skill esteja instalada.",
    )
  }
  if (config.useAgents) {
    activeFeatures.push(
      "- [SUBAGENTES]: Quando houver benefício real de delegação, descubra especialistas via omni_intelligence action=customizations query=<tarefa> e use subagent agent=auto para seleção conservadora ou um ID explícito de especialista. Evite delegações desnecessárias.",
    )
  }
  if (config.useMcps) {
    activeFeatures.push(
      "- [SERVIDORES MCP]: Utilize os servidores MCP locais que estiverem habilitados e conectados de acordo com a tarefa; não tente iniciar servidores desativados sem aprovação.",
    )
  }
  if (config.useHooks) {
    activeFeatures.push(
      "- [GANCHOS & HOOKS]: Execute e respeite ganchos pré/pós tarefa (como hook-pre-commit, hook-verify) e regras de integridade do projeto.",
    )
  }
  if (config.useMods) {
    activeFeatures.push("- [MODS & PLUGINS]: Aproveite as extensões e integrações ativas no workspace.")
  }
  if (config.useCommands) {
    activeFeatures.push(
      "- [COMANDOS SLASH & LOOPS]: Sugira ou acione loops de verificação e comandos dedicados (/loop-*, /plan, /review) quando o fluxo exigir verificação contínua.",
    )
  }
  if (config.useSettings) {
    activeFeatures.push(
      "- [MODOS & SETTINGS]: Respeite estritamente o modo de autonomia e as configurações definidas pelo usuário.",
    )
  }

  if (activeFeatures.length === 0) return ""

  return [
    "<auto_customizations_orchestrator>",
    "  Status: ATIVO PARA TODOS OS AGENTES (categorias disponíveis permanentemente)",
    "  Diretrizes de Execução Proativa:",
    ...activeFeatures.map((f) => `  ${f}`),
    "  Instrução Geral: Cada agente e subagente deve selecionar recursos pertinentes à tarefa; usar apenas MCPs conectados, plugins e hooks explicitamente habilitados. Respeitar permissões, confirmações, escopo do projeto e disponibilidade real. Nunca interpretar a seleção automática como autorização para ativar servidores ou executar scripts não confiáveis.",
    "</auto_customizations_orchestrator>",
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
              read: Effect.sync(() =>
                process.env.OMNICODE_ACTIVE === "1" ? readMemoryBank(location.project.directory) : Instructions.removed,
              ),
              render: {
                initial: (memory) => memory,
                changed: (_previous, memory) => memory,
              },
            }),
            Instructions.make({
              key: Instructions.Key.make("omnicode/global-memory"),
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.sync(() => {
                const memory = process.env.OMNICODE_ACTIVE === "1" ? renderGlobalMemory(global.config) : ""
                return memory.trim() ? memory : Instructions.removed
              }),
              render: {
                initial: (memory) => memory,
                changed: (_previous, memory) => memory,
              },
            }),
            Instructions.make({
              key: Instructions.Key.make("omnicode/auto-customizations"),
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.sync(() => {
                const directive = process.env.OMNICODE_ACTIVE === "1"
                  ? renderAutoCustomizationsDirective(location.directory) : ""
                return directive.trim() ? directive : Instructions.removed
              }),
              render: {
                initial: (directive) => directive,
                changed: (_previous, directive) => directive,
              },
            }),
          ]),
        ),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Global.node, Location.node] })
