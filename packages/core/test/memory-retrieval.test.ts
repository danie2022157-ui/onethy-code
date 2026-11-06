import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { memoryChunks, searchMemory, tokenize } from "../src/memory-retrieval"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((p) => fs.rm(p, { recursive: true, force: true }))))
describe("bounded memory retrieval", () => {
  test("returns the matching subsection and never indexes secret files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "onethy-memory-"))
    roots.push(root)
    await fs.writeFile(path.join(root, "system-patterns.md"), "# Architecture\n\nUse an event bus for state updates.\n\nAlways check permissions.\n")
    await fs.writeFile(path.join(root, "active-context.md"), "Current task: correct a webpack build failure.\n")
    await fs.writeFile(path.join(root, "secrets.md"), "private event bus token")
    const hits = await searchMemory(root, "project", "event bus architecture", 3, false)
    expect(hits[0]?.file).toBe("system-patterns.md")
    expect(hits[0]?.excerpt).toContain("event bus")
    expect(hits.some((hit) => hit.file === "secrets.md")).toBe(false)
    expect(hits.every((hit) => hit.excerpt.length <= 650)).toBe(true)
  })

  test("does not follow symlinks and never lists arbitrary filesystem paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "onethy-memory-"))
    roots.push(root)
    await fs.writeFile(path.join(root, "private.md"), "should never index this data")
    // Some Windows runners do not grant the symlink creation privilege.
    // Always verify that arbitrary files are excluded; on capable hosts,
    // additionally assert that a symlink cannot expose their content.
    expect(memoryChunks(root, "project")).toEqual([])
    try {
      await fs.symlink(path.join(root, "private.md"), path.join(root, "project-brief.md"))
    } catch (error) {
      if (process.platform !== "win32") throw error
      return
    }
    expect(memoryChunks(root, "project")).toEqual([])
    expect(tokenize("Architectural Architecture")).toEqual(["architectural", "architecture"])
  })
})
