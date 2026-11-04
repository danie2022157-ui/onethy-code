export * as OmniConfig from "./omni-config.js"

import fs from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { parse, type ParseError } from "jsonc-parser"
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

/** Parse the Onethy extension without breaking URLs or silently accepting malformed configuration. */
export function parseOmniConfig(content: string): Partial<ConfigData> {
  const errors: ParseError[] = []
  const value: unknown = parse(content, errors, { allowTrailingComma: true })
  if (errors.length > 0 || !value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid OmniCode JSONC configuration")
  }
  const data = value as Record<string, unknown>
  if (data.mode !== undefined && !["plan", "approve", "smart", "auto"].includes(String(data.mode))) {
    throw new Error("Invalid OmniCode autonomy mode")
  }
  if (data.defaultModel !== undefined && (typeof data.defaultModel !== "string" || !data.defaultModel)) {
    throw new Error("Invalid OmniCode default model")
  }
  for (const kind of ["providers", "mcpServers"] as const) {
    const record = data[kind]
    if (record === undefined) continue
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`Invalid OmniCode ${kind} configuration`)
    }
    for (const [name, entry] of Object.entries(record)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`Invalid OmniCode ${kind} entry: ${name}`)
      }
      const props = entry as Record<string, unknown>
      if (kind === "providers") {
        if ((props.apiKey !== undefined && typeof props.apiKey !== "string") ||
            (props.endpoint !== undefined && typeof props.endpoint !== "string") ||
            (props.models !== undefined && (!Array.isArray(props.models) || !props.models.every((model) => typeof model === "string")))) {
          throw new Error(`Invalid OmniCode provider settings for ${name}`)
        }
      } else if (typeof props.command !== "string" || !props.command ||
          (props.args !== undefined && (!Array.isArray(props.args) || !props.args.every((arg) => typeof arg === "string"))) ||
          (props.env !== undefined && (!props.env || typeof props.env !== "object" || Array.isArray(props.env) ||
            !Object.values(props.env).every((item) => typeof item === "string")))) {
        throw new Error(`Invalid OmniCode MCP settings for ${name}`)
      }
    }
  }
  return data as Partial<ConfigData>
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
          return parseOmniConfig(content)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
          throw new Error(`Failed to load OmniCode configuration at ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
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

    // Persist only the requested override. Never copy merged project settings (including
    // API keys and MCP environment secrets) to the user-wide configuration, or vice versa.
    const saveOverride = (filePath: string, update: (current: Partial<ConfigData>) => Partial<ConfigData>) =>
      Effect.promise(async () => {
        let current: Partial<ConfigData> = {}
        try {
          current = parseOmniConfig(await fs.readFile(filePath, "utf-8"))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        }
        const next = update(current)
        await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
        await fs.writeFile(filePath, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 })
      })

    const setMode = Effect.fn("OmniConfig.setMode")(function* (mode: AutonomyMode) {
      yield* saveOverride(projectConfigPath, (current) => ({ ...current, mode }))
      yield* refresh
    })

    const setProvider = Effect.fn("OmniConfig.setProvider")(function* (id: string, cfg: ProviderConfig) {
      yield* saveOverride(globalConfigPath, (current) => ({
        ...current,
        providers: {
          ...current.providers,
          [id]: { ...current.providers?.[id], ...cfg },
        },
      }))
      yield* refresh
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

