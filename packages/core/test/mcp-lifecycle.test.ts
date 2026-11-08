import { describe, expect, test } from "bun:test"
import { MCP_POLICY, canIdle, retryAllowed, retryDelay, shouldHealthCheck } from "../src/mcp/lifecycle"

describe("Onethy MCP maintenance policy", () => {
  const now = 50_000_000

  test("reconnect retries are bounded exponential backoff without a tight loop", () => {
    expect(retryDelay(1)).toBe(5_000)
    expect(retryDelay(2)).toBe(10_000)
    expect(retryDelay(3)).toBe(20_000)
    expect(retryDelay(100)).toBe(MCP_POLICY.backoffMaxMs)
    expect(retryAllowed({ failures: 1, retryAt: now + 1 }, now, "failed", false)).toBe(false)
    expect(retryAllowed({ failures: 1, retryAt: now }, now, "failed", false)).toBe(true)
    expect(retryAllowed({ failures: 6 }, now, "failed", false)).toBe(false)
    expect(retryAllowed({ failures: 1 }, now, "needs_auth", false)).toBe(false)
    expect(retryAllowed({ failures: 1 }, now, "disabled", true)).toBe(false)
  })

  test("idle closes only inactive, unused connections and never in-flight calls", () => {
    const state = { lastUsedAt: now - MCP_POLICY.idleMs, activeCalls: 0 }
    expect(canIdle(state, now, "connected", false)).toBe(true)
    expect(canIdle(state, now, "connected", true)).toBe(false)
    expect(canIdle({ ...state, activeCalls: 1 }, now, "connected", false)).toBe(false)
    expect(canIdle({ ...state, lastUsedAt: now - 100 }, now, "connected", false)).toBe(false)
    expect(canIdle(state, now, "standby", false)).toBe(false)
  })

  test("adaptive idle window honors recent MCP usage without allowing in-flight calls to stop", () => {
    const now = 50_000_000
    const state = { lastUsedAt: now - 20 * 60_000, activeCalls: 0 }
    expect(canIdle(state, now, "connected", false, 10 * 60_000)).toBe(true)
    expect(canIdle(state, now, "connected", false, 60 * 60_000)).toBe(false)
    expect(canIdle({ ...state, activeCalls: 1 }, now, "connected", false, 10 * 60_000)).toBe(false)
  })

  test("health checks are only performed while no session is using a connection", () => {
    const state = { lastHealthAt: now - MCP_POLICY.healthMs, activeCalls: 0 }
    expect(shouldHealthCheck(state, now, "connected")).toBe(true)
    expect(shouldHealthCheck(state, now, "standby")).toBe(false)
    expect(shouldHealthCheck(state, now, "failed")).toBe(false)
    expect(shouldHealthCheck({ ...state, activeCalls: 1 }, now, "connected")).toBe(false)
    expect(shouldHealthCheck({ lastHealthAt: now }, now, "connected")).toBe(false)
  })
})
