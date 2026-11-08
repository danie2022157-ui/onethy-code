import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolveConfigPath } from "../src/commands/handlers/mcp/add"

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
