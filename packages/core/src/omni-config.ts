export * as OmniConfig from "./omni-config.js"

import fs from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Location } from "./location.js"
import { Path as GlobalPath } from "@opencode/util/global"

export type AutonomyMode = "plan" | "approve" | "smart" | "auto"

export interface ProviderConfig {
  readonly apiKey?: string
  readonly endpoint?: string
  readonly models?: ReadonlyArray<string>
}

export interface McpServerConfig {
  readonly command: string
  readonly args?: ReadonlyArray<string>
  readonly env?: Readonly<Record<string, string>>
}

export interface ConfigData {
  readonly mode: AutonomyMode
  readonly defaultModel: string
  readonly providers: Readonly<Record<string, ProviderConfig>>
  readonly mcpServers: Readonly<Record<string, McpServerConfig>>
}

export interface Interface {
  readonly get: () => Effect.Effect<ConfigData, never>
  readonly setMode: (mode: AutonomyMode) => Effect.Effect<void, never>
  readonly setProvider: (id: string, config: ProviderConfig) => Effect.Effect<void, never>
  readonly getGlobalPath: () => string
  readonly getProjectPath: () => string
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OmniConfig") {}

const DEFAULT_CONFIG: ConfigData = {
  mode: "approve",
  defaultModel: "auto",
  providers: {
    gemini: { endpoint: "https://generativelanguage.googleapis.com" },
    anthropic: { endpoint: "https://api.anthropic.com" },
    openai: { endpoint: "https://api.openai.com" },
    ollama: { endpoint: "http://127.0.0.1:11434" },
  },
  mcpServers: {},
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const workspace = location.directory ?? location.project.canonical ?? location.project.directory

    const globalConfigPath = path.join(GlobalPath.config, "omnicode.jsonc")
    const projectConfigPath = path.join(workspace, ".omnicode", "omnicode.jsonc")

    let activeData: ConfigData = { ...DEFAULT_CONFIG }

    const loadFromFile = (filePath: string) =>
      Effect.promise(async () => {
        try {
          const content = await fs.readFile(filePath, "utf-8")
          const clean = content.replace(/\/\/.*$/gm, "")
          return JSON.parse(clean) as Partial<ConfigData>
        } catch {
          return undefined
        }
      })

    const refresh = Effect.gen(function* () {
      const globalOverrides = yield* loadFromFile(globalConfigPath)
      const projectOverrides = yield* loadFromFile(projectConfigPath)

      activeData = {
        mode: projectOverrides?.mode ?? globalOverrides?.mode ?? DEFAULT_CONFIG.mode,
        defaultModel: projectOverrides?.defaultModel ?? globalOverrides?.defaultModel ?? DEFAULT_CONFIG.defaultModel,
        providers: {
          ...DEFAULT_CONFIG.providers,
          ...globalOverrides?.providers,
          ...projectOverrides?.providers,
        },
        mcpServers: {
          ...DEFAULT_CONFIG.mcpServers,
          ...globalOverrides?.mcpServers,
          ...projectOverrides?.mcpServers,
        },
      }
    })

    const get = Effect.fn("OmniConfig.get")(function* () {
      yield* refresh
      return activeData
    })

    const setMode = Effect.fn("OmniConfig.setMode")(function* (mode: AutonomyMode) {
      activeData = { ...activeData, mode }
      yield* Effect.promise(async () => {
        const dir = path.dirname(projectConfigPath)
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(projectConfigPath, JSON.stringify(activeData, null, 2), "utf-8")
      })
    })

    const setProvider = Effect.fn("OmniConfig.setProvider")(function* (id: string, cfg: ProviderConfig) {
      activeData = {
        ...activeData,
        providers: {
          ...activeData.providers,
          [id]: { ...activeData.providers[id], ...cfg },
        },
      }
      yield* Effect.promise(async () => {
        const dir = path.dirname(globalConfigPath)
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(globalConfigPath, JSON.stringify(activeData, null, 2), "utf-8")
      })
    })

    const getGlobalPath = () => globalConfigPath
    const getProjectPath = () => projectConfigPath

    return Service.of({ get, setMode, setProvider, getGlobalPath, getProjectPath })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node],
})

