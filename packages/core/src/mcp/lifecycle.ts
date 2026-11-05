/** Bounded, conservative MCP maintenance policy for OnethyCode. */
export const MCP_POLICY = {
  idleMs: 30 * 60_000,
  healthMs: 3 * 60_000,
  tickMs: 60_000,
  healthTimeout: "5 seconds",
  maxFailures: 6,
  backoffBaseMs: 5_000,
  backoffMaxMs: 5 * 60_000,
} as const

export type McpMaintenanceState = {
  lastUsedAt?: number
  activeCalls?: number
  lastHealthAt?: number
  failures?: number
  retryAt?: number
}

export function retryDelay(failures: number) {
  return Math.min(
    MCP_POLICY.backoffMaxMs,
    MCP_POLICY.backoffBaseMs * 2 ** Math.max(0, Math.min(16, failures - 1)),
  )
}

export function retryAllowed(
  state: McpMaintenanceState,
  now: number,
  status: string,
  disabled: boolean,
): boolean {
  return !disabled && status === "failed" &&
    (state.failures ?? 0) < MCP_POLICY.maxFailures && now >= (state.retryAt ?? 0)
}

export function canIdle(
  state: McpMaintenanceState,
  now: number,
  status: string,
  disabled: boolean,
): boolean {
  return !disabled && status === "connected" && (state.activeCalls ?? 0) === 0 &&
    now - (state.lastUsedAt ?? now) >= MCP_POLICY.idleMs
}

export function shouldHealthCheck(
  state: McpMaintenanceState,
  now: number,
  status: string,
): boolean {
  return status === "connected" && (state.activeCalls ?? 0) === 0 &&
    now - (state.lastHealthAt ?? now) >= MCP_POLICY.healthMs
}
