import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { OmniConfig, parseOmniConfig } from "@opencode/core/omni-config"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"

const projectDir = AbsolutePath.make(process.cwd())

const testLocation = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: projectDir })),
)

const { effect } = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([OmniConfig.node]),
    [Location.node.replace(testLocation)],
  ),
)

describe("OmniCode Config Management", () => {
  effect("loads default approve mode and provider configuration", () =>
    Effect.gen(function* () {
      const config = yield* OmniConfig.Service
      const data = yield* config.get()

      expect(data.mode).toBe("approve")
      expect(data.defaultModel).toBe("auto")
      expect(data.providers.gemini).toBeDefined()
      expect(data.providers.anthropic).toBeDefined()
      expect(data.providers.openai).toBeDefined()
      expect(data.providers.ollama).toBeDefined()
    }),
  )

  effect("returns valid global and project configuration paths", () =>
    Effect.gen(function* () {
      const config = yield* OmniConfig.Service
      const globalPath = config.getGlobalPath()
      const projectPath = config.getProjectPath()

      expect(globalPath.endsWith("omnicode.jsonc")).toBe(true)
      expect(projectPath.endsWith(".omnicode\\omnicode.jsonc") || projectPath.endsWith(".omnicode/omnicode.jsonc")).toBe(true)
    }),
  )
})


describe("OmniCode JSONC settings", () => {
  test("preserves provider URLs and comments", () => {
    const value = parseOmniConfig(`{
      // URLs must survive JSONC comments
      "mode": "approve",
      "providers": {
        "ollama": { "endpoint": "http://127.0.0.1:11434" },
        "openai": { "endpoint": "https://api.openai.com/v1" },
      },
    }`)
    expect(value.providers?.ollama?.endpoint).toBe("http://127.0.0.1:11434")
    expect(value.providers?.openai?.endpoint).toBe("https://api.openai.com/v1")
  })

  test("rejects malformed JSONC instead of silently ignoring configuration", () => {
    expect(() => parseOmniConfig('{ "mode": "approve", "providers": {')).toThrow("Invalid OmniCode JSONC")
    expect(() => parseOmniConfig('{ "mode": "unrestricted" }')).toThrow("Invalid OmniCode autonomy mode")
  })

  test("rejects invalid MCP commands", () => {
    expect(() => parseOmniConfig('{ "mcpServers": { "example": { "command": 5 } } }')).toThrow("Invalid OmniCode MCP")
  })
})
