import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolveConfigPath } from "../src/commands/handlers/mcp/add"
import { approveServers } from "../src/commands/handlers/mcp/doctor"
import { parse as parseJsonc } from "jsonc-parser"

describe("Onethy MCP CLI configuration", () => {
  test("reuses existing onethy.json rather than creating opencode.json", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "onethy-mcp-config-"))
    try {
      await writeFile(path.join(root, "onethy.json"), "{}")
      expect(await resolveConfigPath(root)).toBe(path.join(root, "onethy.json"))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("finds existing .onethy config and uses Onethy filename for fresh config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "onethy-mcp-config-"))
    try {
      expect(await resolveConfigPath(root)).toBe(path.join(root, "onethy.json"))
      await mkdir(path.join(root, ".onethy"))
      await writeFile(path.join(root, ".onethy", "onethy.jsonc"), "{ /* existing */ }")
      expect(await resolveConfigPath(root)).toBe(path.join(root, ".onethy", "onethy.jsonc"))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe("Onethy MCP batch approval", () => {
  test("approves only named MCP servers and preserves unrelated config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "onethy-mcp-approve-"))
    try {
      const filename = path.join(root, "onethy.jsonc")
      await writeFile(filename, '{ // keep me\\n "model": "test", "mcp": {"overrides":{"untouched":false}} }')
      await approveServers(root, ["filesystem", "git", "filesystem"])
      const { readFile } = await import("node:fs/promises")
      const content = await readFile(filename, "utf8")
      expect(content).toContain("// keep me")
      const parsed = parseJsonc(content) as { model: string; mcp: { overrides: Record<string, boolean> } }
      expect(parsed.model).toBe("test")
      expect(parsed.mcp.overrides).toEqual({ untouched: false, filesystem: true, git: true })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
