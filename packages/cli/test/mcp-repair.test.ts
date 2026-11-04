import { describe, expect, test } from "bun:test"
import { shouldRetry } from "../src/commands/handlers/mcp/repair"

describe("MCP repair policy", () => {
  test("retries failed servers without silently starting disabled integrations", () => {
    expect(shouldRetry("failed", false)).toBe(true)
    expect(shouldRetry("disabled", false)).toBe(false)
    expect(shouldRetry("needs_auth", false)).toBe(false)
    expect(shouldRetry("connected", false)).toBe(false)
    expect(shouldRetry("pending", false)).toBe(false)
  })
  test("explicit --all opts in to disabled MCPs without bypassing OAuth", () => {
    expect(shouldRetry("disabled", true)).toBe(true)
    expect(shouldRetry("needs_auth", true)).toBe(false)
  })
})
