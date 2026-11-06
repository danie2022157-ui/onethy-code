/** Configurable, deterministic efficiency bounds. Does not invoke a model or alter user permissions. */
export type EfficiencyMode = "economy" | "balanced" | "quality"

export type EfficiencyProfile = {
  mode: EfficiencyMode
  goalRounds: number
  missionRounds: number
  parallel: number
  toolOutputBytes: number
  toolOutputLines: number
  /** Absolute character ceiling for auto-injected memory; full documents remain available on demand. */
  projectMemoryChars: number
  globalMemoryChars: number
}

const PROFILES: Record<EfficiencyMode, EfficiencyProfile> = {
  economy: {
    mode: "economy", goalRounds: 18, missionRounds: 12, parallel: 2,
    toolOutputBytes: 12 * 1024, toolOutputLines: 500,
    projectMemoryChars: 8_000, globalMemoryChars: 5_000,
  },
  balanced: {
    mode: "balanced", goalRounds: 30, missionRounds: 24, parallel: 3,
    toolOutputBytes: 24 * 1024, toolOutputLines: 1_000,
    projectMemoryChars: 16_000, globalMemoryChars: 12_000,
  },
  quality: {
    mode: "quality", goalRounds: 50, missionRounds: 40, parallel: 3,
    toolOutputBytes: 50 * 1024, toolOutputLines: 2_000,
    projectMemoryChars: 48_000, globalMemoryChars: 36_000,
  },
}

/** Other OpenCode hosts are unchanged. Invalid choices fall back to balanced. */
export function efficiencyProfile(env: Readonly<Record<string, string | undefined>> = process.env): EfficiencyProfile {
  if (env.OMNICODE_ACTIVE !== "1" && env.ONETHY_ACTIVE !== "1") return PROFILES.quality
  const requested = env.ONETHY_EFFICIENCY_PROFILE?.trim().toLowerCase()
  return requested === "economy" || requested === "quality" || requested === "balanced"
    ? PROFILES[requested] : PROFILES.balanced
}

/**
 * Model ranking by task: lightweight discovery can prioritize cost; hard architecture/review
 * needs context; coding keeps the quality-oriented newest ranking unless economy is chosen.
 * Explicit model selections must bypass this function at the call site.
 */
export function agentModelRanking(
  agent: string,
  mode: EfficiencyMode,
): "cost" | "context" | "newest" {
  if (mode === "economy") return ["architect", "reviewer"].includes(agent) ? "context" : "cost"
  if (mode === "quality") return ["architect", "reviewer"].includes(agent) ? "context" : "newest"
  return ["explore", "researcher", "librarian"].includes(agent) ? "cost" :
    ["architect", "reviewer"].includes(agent) ? "context" : "newest"
}

/**
 * Total app-context characters used for memory. Prioritize high-value documents, but never
 * suppress a complete small document. Omitted content remains on disk for on-demand access.
 */
export function boundedMemorySections(
  sections: ReadonlyArray<{ name: string; text: string }>,
  maxChars: number,
  label = "Memory Bank",
): string[] {
  let remaining = Math.max(0, maxChars)
  return sections.flatMap(({ name, text }) => {
    const trimmed = text.trim()
    if (!trimmed || !remaining) return []
    const header = "### [" + label + ": " + name + "]\n"
    if (remaining <= header.length + 80) return []
    const limit = remaining - header.length
    const shown = trimmed.length <= limit ? trimmed : trimmed.slice(0, limit).trimEnd()
    remaining -= header.length + shown.length
    return [header + shown + (shown.length < trimmed.length
      ? "\n[More memory available on demand via omni_memory: " + name + "]" : "")]
  })
}
