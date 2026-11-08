import { test, expect } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { parse } from "jsonc-parser"
import { manageMcp, managedMcpList } from "../src/services/mcp-manager"
import { readNativeBundle, restoreNativeMCP } from "../src/services/onethy-mcp-manager.mjs"

test("MCP enable/disable writes only scoped overrides with no network requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-mcp-config-"))
  try {
    const project = join(root, "project")
    const globalRoot = join(root, "global")
    await mkdir(project)
    await restoreNativeMCP(globalRoot, "all")
    await manageMcp({ action: "enable", name: "onethy-git", cwd: project, globalRoot })
    const local = join(project, "onethy.json")
    let info = parse(await readFile(local, "utf8"))
    expect(info.mcp.overrides["onethy-git"]).toBe(true)
    await manageMcp({ action: "disable", name: "onethy-git", cwd: project, globalRoot })
    info = parse(await readFile(local, "utf8"))
    expect(info.mcp.overrides["onethy-git"]).toBe(false)
    expect((await managedMcpList(project, globalRoot)).find(item => item.name === "onethy-git")?.enabled).toBe(false)
    const bundle = await readNativeBundle(globalRoot)
    expect(bundle?.mcpServers["onethy-git"]).toBeDefined()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("MCP removal respects global scope and restores only a selected built-in", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-mcp-scope-"))
  try {
    const cwd = join(root, "project")
    const globalRoot = join(root, "global")
    await mkdir(cwd)
    await restoreNativeMCP(globalRoot, "all")
    await expect(manageMcp({ action: "remove", name: "onethy-git", cwd, globalRoot }))
      .rejects.toThrow("--global")
    await manageMcp({ action: "remove", name: "onethy-git", cwd, globalRoot, global: true })
    const bundleAfterRemove = (await readNativeBundle(globalRoot)) as { mcpServers: Record<string, unknown> } | undefined;
    expect(bundleAfterRemove?.mcpServers["onethy-git"]).toBeUndefined()
    expect(Object.keys(bundleAfterRemove?.mcpServers ?? {})).toHaveLength(7)
    await manageMcp({ action: "restore", name: "onethy-git", cwd, globalRoot, global: true })
    const bundleAfterRestore = (await readNativeBundle(globalRoot)) as { mcpServers: Record<string, { disabled?: boolean }> } | undefined;
    expect(bundleAfterRestore?.mcpServers["onethy-git"]?.disabled).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("removing manual MCP preserves other servers and JSONC comments", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-mcp-jsonc-"))
  try {
    const cwd = join(root, "project")
    const globalRoot = join(root, "global")
    await mkdir(cwd)
    const config = join(cwd, "onethy.jsonc")
    await writeFile(config, `{
      // Do not delete the user's other MCPs
      "mcp": {
        "servers": {
          "my-one": { "type": "local", "command": ["uvx", "one"] },
          "my-two": { "type": "local", "command": ["uvx", "two"] }
        },
        "overrides": { "my-one": true, "my-two": false }
      }
    }`)
    await manageMcp({ action: "remove", name: "my-one", cwd, globalRoot })
    const source = await readFile(config, "utf8")
    const parsed = parse(source)
    expect(source).toContain("Do not delete")
    expect(parsed.mcp.servers["my-one"]).toBeUndefined()
    expect(parsed.mcp.overrides["my-one"]).toBeUndefined()
    expect(parsed.mcp.servers["my-two"]).toBeDefined()
    expect(parsed.mcp.overrides["my-two"]).toBe(false)
    await expect(manageMcp({ action: "remove", name: "my-one", cwd, globalRoot }))
      .rejects.toThrow("not found")
  } finally { await rm(root, { recursive: true, force: true }) }
})
