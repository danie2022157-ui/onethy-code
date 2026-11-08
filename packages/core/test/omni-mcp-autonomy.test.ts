import { describe, expect, test } from "bun:test"
import { canRetryMcp, diagnoseMcp, redactMcpError, RECOVERY_COOLDOWN_MS } from "../src/mcp/autonomy"

describe("Onethy autonomous MCP recovery policy", () => {
  test("keeps disabled, pending and auth-required MCPs out of automatic repair", () => {
    for (const status of ["disabled", "pending", "needs_auth"] as const)
      expect(diagnoseMcp({ status }).recoverable).toBe(false)
    expect(diagnoseMcp({ status: "failed", error: "401 Unauthorized" }).recoverable).toBe(false)
    expect(diagnoseMcp({ status: "failed", error: "ENOENT command not found" }).recoverable).toBe(false)
    expect(diagnoseMcp({ status: "failed", error: "unsupported protocol" }).recoverable).toBe(false)
  })

  test("can recover standby and transient server failures, not healthy connections", () => {
    expect(diagnoseMcp({ status: "standby" }).recoverable).toBe(true)
    expect(diagnoseMcp({ status: "failed", error: "ECONNRESET" }).recoverable).toBe(true)
    expect(diagnoseMcp({ status: "connected" }).recoverable).toBe(false)
  })

  test("enforces a cooldown between agent-driven connection attempts", () => {
    expect(canRetryMcp(undefined, 100)).toBe(true)
    expect(canRetryMcp(100, 100)).toBe(false)
    expect(canRetryMcp(100, 100 + RECOVERY_COOLDOWN_MS - 1)).toBe(false)
    expect(canRetryMcp(100, 100 + RECOVERY_COOLDOWN_MS)).toBe(true)
  })

  test("does not surface bearer tokens, API keys or authentication headers", () => {
    const result = redactMcpError("Bearer abc123 token=xyz api_key=secret authorization=more https://foo/mcp?api_key=hidden")
    expect(result).not.toContain("abc123")
    expect(result).not.toContain("xyz")
    expect(result).not.toContain("secret")
    expect(result).not.toContain("hidden")
    expect(result).toContain("[redacted]")
  })
})
