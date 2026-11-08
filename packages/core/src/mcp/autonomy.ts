/** Conservative diagnostics for configured MCP servers; never handles credentials or installs packages. */
export type McpState = {
  readonly status: "connected" | "pending" | "standby" | "disabled" | "failed" | "needs_auth"
  readonly error?: string
}

export const RECOVERY_COOLDOWN_MS = 30_000

/** Avoid putting tokens from remote MCP exceptions into a model transcript. */
export function redactMcpError(input: string): string {
  return input
    .replace(/(Bearer\s+)[^\s"'<>]+/gi, "$1[redacted]")
    .replace(/((?:token|api[_-]?key|client[_-]?secret|secret|password|authorization)[=:]\s*)[^\s&"'<>]+/gi, "$1[redacted]")
    .replace(/([?&](?:token|api[_-]?key|secret|password)=)[^&#\s]+/gi, "$1[redacted]")
    .slice(0, 500)
}

export function diagnoseMcp(state: McpState): { recoverable: boolean; advice: string } {
  if (state.status === "connected") return { recoverable: false, advice: "Connected and ready." }
  if (state.status === "standby") return { recoverable: true, advice: "Standby: safe to reconnect on demand." }
  if (state.status === "pending") return { recoverable: false, advice: "Connection is initializing; do not start another." }
  if (state.status === "disabled") return {
    recoverable: false, advice: "Disabled by configuration or policy. User must explicitly enable this server.",
  }
  if (state.status === "needs_auth") return {
    recoverable: false, advice: "Authentication is required. Run onethy mcp auth <server>; never bypass login.",
  }
  const error = state.error ?? ""
  if (/(?:unauthorized|forbidden|access denied|auth(?:entication|orization)? required|invalid credentials|invalid api.key|\b401\b|\b403\b)/i.test(error))
    return { recoverable: false, advice: "Credential or permission failure. Verify the account and sign in manually." }
  if (/(?:ENOENT|command not found|not recognized as an internal|cannot find module|module not found|executable not found)/i.test(error))
    return { recoverable: false, advice: "Executable or dependency missing. Review the configured command; do not auto-install." }
  if (/(?:invalid config|configuration error|unsupported protocol|invalid schema)/i.test(error))
    return { recoverable: false, advice: "Configuration or protocol mismatch. Inspect the MCP config manually." }
  return { recoverable: true, advice: "Connection failure. Attempt one bounded reconnect, then verify the tool catalog." }
}

export function canRetryMcp(lastAttempt: number | undefined, now: number, cooldown = RECOVERY_COOLDOWN_MS): boolean {
  return lastAttempt === undefined || now - lastAttempt >= cooldown
}
