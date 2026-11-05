/** Session-specific review data. Never substitute global VCS diffs for an empty turn. */
export interface ChangedFile {
  readonly file: string
  readonly additions: number
  readonly deletions: number
  readonly status: "added" | "modified" | "deleted"
}

export function sessionReviewFiles(result: unknown): ChangedFile[] {
  const raw = Array.isArray(result)
    ? result
    : result && typeof result === "object" && "data" in result
      ? (result as { data: unknown }).data
      : undefined
  if (!Array.isArray(raw)) return []
  return raw.flatMap((value): ChangedFile[] => {
    if (!value || typeof value !== "object") return []
    const item = value as Record<string, unknown>
    if (typeof item.file !== "string" || !item.file.trim()) return []
    if (item.status !== "added" && item.status !== "modified" && item.status !== "deleted") return []
    return [{
      file: item.file,
      additions: typeof item.additions === "number" && Number.isFinite(item.additions)
        ? Math.max(0, item.additions) : 0,
      deletions: typeof item.deletions === "number" && Number.isFinite(item.deletions)
        ? Math.max(0, item.deletions) : 0,
      status: item.status,
    }]
  })
}

/** Per-session revision identity keeps a previous Keep from hiding a later turn. */
export function sessionReviewFingerprint(
  sessionID: string,
  turnID: string,
  files: readonly ChangedFile[],
): string {
  return JSON.stringify([
    sessionID,
    turnID,
    files.map(({ file, additions, deletions, status }) => [file, additions, deletions, status]),
  ])
}

/** A running request may finish after the user switches tabs. Ignore that stale result. */
export function isCurrentSessionDiff(
  requestedSessionID: string,
  requestID: number,
  currentSessionID: string | undefined,
  latestRequestID: number,
): boolean {
  return requestedSessionID === currentSessionID && requestID === latestRequestID
}
