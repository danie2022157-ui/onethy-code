import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { openMcpCatalogCache, validCatalog, catalogCacheDirectory } from "../src/mcp/catalog-cache"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((p) => fs.rm(p, { recursive: true, force: true }))))
describe("safe local MCP catalog persistence", () => {
  test("reuses only same-workspace, same-configuration authorized local tool schemas", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "onethy-mcp-catalog-"))
    roots.push(root)
    const one = await openMcpCatalogCache(path.join(root, "workspace"), root)
    const config = { type: "local" as const, command: ["node", "server.js"], environment: { TOKEN: "top-secret" } }
    const tools = [{ name: "lookup", description: "Search", inputSchema: { type: "object" as const, properties: {} } }]
    expect(await one.save("custom-server", config, tools)).toBe(true)
    expect(await one.load("custom-server", config)).toEqual(tools)
    const content = await fs.readFile(path.join(catalogCacheDirectory(path.join(root, "workspace"), root),
      (await import("node:crypto")).createHash("sha256").update("custom-server").digest("hex") + ".json"), "utf8")
    expect(content).not.toContain("top-secret")
    expect(content).not.toContain("server.js")
    expect(await one.load("custom-server", { ...config, command: ["node", "another.js"] })).toBeUndefined()
    expect(await one.load("custom-server", { ...config, disabled: true })).toBeUndefined()
    expect(await one.load("custom-server", { type: "remote", url: "https://example.com/mcp" })).toBeUndefined()
    const other = await openMcpCatalogCache(path.join(root, "other-workspace"), root)
    expect(await other.load("custom-server", config)).toBeUndefined()
  })
  test("rejects stale, malformed or suspicious cache payloads", () => {
    const value = { version: 1, name: "mcp", fingerprint: "key", recordedAt: Date.now(),
      tools: [{ name: "tool", inputSchema: { type: "object", properties: {} } }] }
    expect(validCatalog(value, "mcp", "key")).toHaveLength(1)
    expect(validCatalog(value, "mcp", "other")).toBeUndefined()
    expect(validCatalog({ ...value, recordedAt: Date.now() - 31 * 60_000 }, "mcp", "key")).toBeUndefined()
    expect(validCatalog({ ...value, tools: [{ name: "x", inputSchema: { type: "string" } }] }, "mcp", "key")).toBeUndefined()
  })
})
