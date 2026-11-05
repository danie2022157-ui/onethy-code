import { describe, expect, test } from "bun:test"
import {
  isCurrentSessionDiff,
  loadSessionReview,
  sessionReviewFiles,
  sessionReviewFingerprint,
  type ChangedFile,
} from "../../src/component/prompt/review-bar-session"

const edits = (file: string): ChangedFile[] => [{
  file, additions: 1, deletions: 0, status: "modified",
}]

describe("session-isolated review bar", () => {
  test("does not invent changes from the shared Git worktree when a session has no diff", async () => {
    const calls: string[] = []
    const snapshots = new Map<string, ChangedFile[]>([
      ["session-a", edits("a.ts")],
      ["session-b", []],
      ["session-c", edits("c.ts")],
    ])
    const fetch = async (sessionID: string) => {
      calls.push(sessionID)
      return { data: snapshots.get(sessionID) ?? [] }
    }
    expect(await loadSessionReview("session-a", fetch)).toEqual(edits("a.ts"))
    expect(await loadSessionReview("session-b", fetch)).toEqual([])
    expect(await loadSessionReview("session-c", fetch)).toEqual(edits("c.ts"))
    expect(calls).toEqual(["session-a", "session-b", "session-c"])
  })

  test("failed or malformed session diffs display no unrelated changes", async () => {
    expect(await loadSessionReview("session-b", async () => { throw new Error("offline") })).toEqual([])
    expect(await loadSessionReview("session-b", async () => ({ data: null }))).toEqual([])
    expect(sessionReviewFiles(undefined)).toEqual([])
    expect(sessionReviewFiles({ data: [{ file: "x.ts", additions: 2, deletions: 0, status: "modified" }] }))
      .toEqual([{ file: "x.ts", additions: 2, deletions: 0, status: "modified" }])
    expect(sessionReviewFiles({ data: [{ file: "", status: "modified" }, { file: "fake", status: "unknown" }] }))
      .toEqual([])
  })

  test("a stale async response for a previous tab cannot enter the active session", () => {
    expect(isCurrentSessionDiff("session-a", 3, "session-b", 4)).toBe(false)
    expect(isCurrentSessionDiff("session-a", 3, "session-a", 4)).toBe(false)
    expect(isCurrentSessionDiff("session-a", 4, "session-a", 4)).toBe(true)
    expect(isCurrentSessionDiff("session-a", 4, undefined, 4)).toBe(false)
  })

  test("Keep fingerprints are scoped to the session, latest turn, and changed files", () => {
    const sameFiles = edits("shared.ts")
    const a = sessionReviewFingerprint("session-a", "turn-1", sameFiles)
    expect(sessionReviewFingerprint("session-b", "turn-1", sameFiles)).not.toBe(a)
    expect(sessionReviewFingerprint("session-a", "turn-2", sameFiles)).not.toBe(a)
    expect(sessionReviewFingerprint("session-a", "turn-1", edits("other.ts"))).not.toBe(a)
    expect(sessionReviewFingerprint("session-a", "turn-1", sameFiles)).toBe(a)
  })
})
