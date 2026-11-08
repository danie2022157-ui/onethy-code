import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { MAX_READ_BYTES, filterLines, readBytes, readLogs, redact, logPath, errorLogPath } from "@opencode/util/observability/log-view"

describe("OnethyCode unified diagnostics", () => {
  test("keeps errors in a dedicated diagnostic file with the same channel and source labels", async () => {
    expect(errorLogPath()).not.toBe(logPath())
    expect(errorLogPath().endsWith("opencode-errors-local.log")).toBe(true)
    expect(errorLogPath("production").endsWith("opencode-errors.log")).toBe(true)
    const dir = await mkdtemp(path.join(tmpdir(), "onethy-incidents-"))
    const incidentFile = path.join(dir, "errors.log")
    try {
      await writeFile(incidentFile, [
        "timestamp=now level=WARN role=server message=provider-cooldown",
        "timestamp=now level=ERROR role=tui message=render-failed api_key=secret-incidents",
        "timestamp=now level=ERROR role=cli message=process-failed",
      ].join("\n") + "\n")
      const ui = await readLogs(incidentFile, { source: "tui", level: "ERROR" })
      expect(ui).toHaveLength(1)
      expect(ui[0]).toContain("render-failed")
      expect(ui[0]).not.toContain("secret-incidents")
      expect(await readLogs(incidentFile, { level: "WARN" })).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("redacts known auth tokens before filtering or sharing", () => {
    const input = [
      "timestamp=now level=ERROR role=server",
      'authorization="Bearer 123456789abcdefghi"',
      "password=secretpassword123",
      "refresh_token=eyJhbGciOi123456789",
      "x-api-key=abcdef123456789",
      "key=visible",
      "github_pat_12345678901234567890",
      "sk-abcdefghijklmnopqrstuvwxyz",
      "https://alice:password123@example.com/path",
    ].join(" ")
    const filtered = redact(input)
    for (const secret of ["123456789abcdefghi", "secretpassword123", "eyJhbGciOi123456789",
      "abcdef123456789", "github_pat_12345678901234567890", "sk-abcdefghijklmnopqrstuvwxyz"]) {
      expect(filtered).not.toContain(secret)
    }
    expect(filtered).toContain("role=server")
    expect(filtered).toContain("level=ERROR")
  })

  test("filters actual cli/tui/server sources and severity from the shared log", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "onethy-log-view-"))
    const file = path.join(dir, "all.log")
    try {
      await writeFile(file, [
        "timestamp=one level=INFO role=server message=core",
        "timestamp=two level=DEBUG role=tui message=interface",
        "timestamp=three level=ERROR role=cli message=cli-error password=hidden-secret",
      ].join("\n") + "\n")
      expect(await readLogs(file, { source: "server" })).toHaveLength(1)
      expect(await readLogs(file, { source: "tui", level: "DEBUG" })).toEqual([
        "timestamp=two level=DEBUG role=tui message=interface",
      ])
      expect(await readLogs(file, { level: "ERROR" })).toEqual([
        "timestamp=three level=ERROR role=cli message=cli-error password=[REDACTED]",
      ])
      expect(await readLogs(file, { search: "interface" })).toHaveLength(1)
      expect(await readLogs(path.join(dir, "missing.log"))).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("caps reads, supports follow offsets, and does not load entire large logs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "onethy-log-cap-"))
    const file = path.join(dir, "all.log")
    try {
      await writeFile(file, ("timestamp=old level=DEBUG role=server message=old\n").repeat(15_000))
      await appendFile(file, "timestamp=new level=ERROR role=tui message=latest\n")
      const lines = await readLogs(file, { lines: 9999 })
      expect(lines.length).toBeLessThanOrEqual(500)
      expect(lines.at(-1)).toContain("message=latest")
      expect(lines[0]).not.toContain("timestamp=oldest")
      const initial = await readBytes(file, 0, true)
      expect(Buffer.byteLength(initial.text)).toBeLessThanOrEqual(MAX_READ_BYTES)
      await appendFile(file, "timestamp=follow level=INFO role=server message=follow\n")
      const next = await readBytes(file, initial.offset)
      expect(next.text).toContain("message=follow")
      expect(filterLines(next.text.split("\n"), { source: "server" })).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
