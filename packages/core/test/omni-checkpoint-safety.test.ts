import { describe, expect, test } from "bun:test"
import { checkpointRestoreBlocker } from "../src/tool/plugin/omni-checkpoint"

const clean = { code: 0, stdout: "" }
const head = { code: 0, stdout: "a".repeat(40) }

describe("checkpoint restore safety", () => {
  test("rejects missing explicit confirmation", () => {
    expect(checkpointRestoreBlocker({ status: clean, head, expectedHead: head.stdout })).toContain("approval")
  })
  test("rejects dirty Git state and preserves user edits", () => {
    expect(checkpointRestoreBlocker({
      confirm: true,
      status: { code: 0, stdout: " M src/index.ts" },
      head, expectedHead: head.stdout,
    })).toContain("local changes")
  })
  test("rejects changed history or failed Git checks", () => {
    expect(checkpointRestoreBlocker({
      confirm: true, status: clean, head, expectedHead: "b".repeat(40),
    })).toContain("HEAD changed")
    expect(checkpointRestoreBlocker({
      confirm: true, status: { code: 1, stdout: "" }, head, expectedHead: head.stdout,
    })).toContain("Cannot verify")
  })
  test("allows only explicitly approved clean same-commit restore", () => {
    expect(checkpointRestoreBlocker({ confirm: true, status: clean, head, expectedHead: head.stdout }))
      .toBeUndefined()
  })
})
