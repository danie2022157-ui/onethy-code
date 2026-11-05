import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, stat } from "node:fs/promises"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import {
  bundlePath, listNativeMCPs, readNativeBundle, removeNativeMCP,
  restoreNativeMCP, isNativeMCP,
} from "../packages/cli/src/services/onethy-mcp-manager.mjs"
import { LOCAL_MCP_NAMES } from "../packages/cli/src/services/onethy-customizations-local-mcp.mjs"

test("native MCPs support listing, removal, restoration and persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-mcp-manager-"))
  try {
    const before = await listNativeMCPs(root)
    assert.equal(before.length, 8)
    assert.ok(before.every(item => !item.installed))
    const restored = await restoreNativeMCP(root, "all")
    assert.equal(restored.length, 8)
    assert.deepEqual(Object.keys((await readNativeBundle(root)).mcpServers), [...LOCAL_MCP_NAMES])
    const name = "onethy-desktop-commander"
    const remaining = "onethy-playwright"
    assert.equal(await removeNativeMCP(root, name), true)
    assert.equal(await removeNativeMCP(root, name), false)
    const after = await readNativeBundle(root)
    assert.equal(Object.keys(after.mcpServers).length, 7)
    assert.equal(after.mcpServers[name], undefined)
    assert.equal(after.mcpServers[remaining].disabled, true)
    assert.equal((await listNativeMCPs(root)).find(item => item.name === name).installed, false)
    assert.deepEqual(await restoreNativeMCP(root, name), [name])
    assert.equal((await readNativeBundle(root)).mcpServers[name].disabled, true)
    await assert.rejects(removeNativeMCP(root, "not-a-native-mcp"), /Not a bundled/)
    await assert.rejects(restoreNativeMCP(root, "unknown"), /Unknown bundled/)
    assert.equal(isNativeMCP(name), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("restoring one MCP never replaces unrelated customized MCPs", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-mcp-merge-"))
  try {
    await restoreNativeMCP(root, "all")
    const file = bundlePath(root)
    const config = JSON.parse(await readFile(file, "utf8"))
    config.mcpServers["custom-local"] = {
      type: "stdio", command: "uvx", args: ["custom"], disabled: false,
    }
    config.mcpServers["onethy-git"].disabled = false
    await writeFile(file, JSON.stringify(config))
    await restoreNativeMCP(root, "onethy-git")
    const after = await readNativeBundle(root)
    assert.equal(after.mcpServers["onethy-git"].disabled, true)
    assert.deepEqual(after.mcpServers["custom-local"], config.mcpServers["custom-local"])
    await removeNativeMCP(root, "onethy-git")
    assert.ok(Object.hasOwn((await readNativeBundle(root)).mcpServers, "custom-local"))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("MCP deletion refuses symlinked bundles", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-mcp-links-"))
  try {
    const external = join(root, "external.json")
    await writeFile(external, '{"mcpServers":{"onethy-git":{"disabled":true}}}')
    const file = bundlePath(root)
    await mkdir(dirname(file), { recursive: true })
    await symlink(external, file, "file")
    await assert.rejects(removeNativeMCP(root, "onethy-git"), /symlink/)
    await assert.rejects(restoreNativeMCP(root, "onethy-git"), /symlink/)
    assert.ok((await stat(external)).isFile())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a damaged native MCP config cannot be overwritten by management operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-mcp-invalid-"))
  try {
    const file = bundlePath(root)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, "{invalid")
    await assert.rejects(removeNativeMCP(root, "onethy-git"), /Invalid native MCP JSON/)
    await assert.rejects(restoreNativeMCP(root, "all"), /Invalid native MCP JSON/)
    assert.equal(await readFile(file, "utf8"), "{invalid")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
