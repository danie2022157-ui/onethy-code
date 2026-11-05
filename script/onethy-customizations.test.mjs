import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink, readdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { syncOnethyCustomizations } from "../packages/cli/src/services/onethy-customizations.mjs"

test("native customizations import local-only MCPs, commands, hooks and mods without running external code", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-customization-test-"))
  try {
    const sourceDir = join(root, "catalog")
    const cwd = join(root, "project")
    const base = join(sourceDir, "cli-tool/components")
    const sources = {
      skill: join(base, "skills/development/example/SKILL.md"),
      asset: join(base, "skills/development/example/extra.txt"),
      agent: join(base, "agents/development/frontend.md"),
      command: join(base, "commands/testing/generate.md"),
      hook: join(base, "hooks/git/prevent-direct-push.py"),
      mod: join(base, "mods/security/secret-redactor/.claude-plugin/plugin.json"),
      local: join(base, "mcps/local/memory.json"),
      remote: join(base, "mcps/integrations/remote.json"),
    }
    for (const file of Object.values(sources)) await mkdir(dirname(file), { recursive: true })
    await mkdir(cwd, { recursive: true })
    await writeFile(sources.skill, "---\nname: example\ndescription: Local development skill\n---\nFollow the user's instructions.")
    await writeFile(sources.asset, "supporting local asset")
    await writeFile(sources.agent, "---\ndescription: Local development assistant\ntools: Read, Bash\n---\nSupport the project.")
    await writeFile(sources.command, "---\ndescription: Generate tests\nallowed-tools: Read, Bash\n---\nAnalyze $ARGUMENTS; !\`echo NOT_ALLOWED\`")
    await writeFile(sources.hook, "import sys\n# Inert source fixture; MUST NEVER EXECUTE\n")
    await writeFile(sources.mod, JSON.stringify({ name: "secret-redactor", description: "Redacts credentials locally" }))
    await writeFile(sources.local, JSON.stringify({ mcpServers: { memory: {
      command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"],
    } } }))
    await writeFile(sources.remote, JSON.stringify({ mcpServers: {
      cloud: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "TOKEN" } },
      hosted: { url: "https://example.org/mcp", headers: { Authorization: "Bearer TOKEN" } },
    } }))

    const preview = await syncOnethyCustomizations({ sourceDir, cwd })
    assert.equal(preview.installed, 0)
    assert.equal(preview.ready, 8)
    await assert.rejects(stat(join(cwd, ".opencode")))
    const first = await syncOnethyCustomizations({ sourceDir, cwd, install: true })
    assert.equal(first.installed, 8)
    assert.ok(first.pending >= 1)

    const config = join(cwd, ".opencode")
    assert.equal(await readFile(join(config, "skills/development-example/extra.txt"), "utf8"), "supporting local asset")
    const skill = await readFile(join(config, "skills/development-example/SKILL.md"), "utf8")
    assert.match(skill, /name: development-example/)
    const agents = await readdir(join(config, "agents"))
    const agent = await readFile(join(config, "agents", agents[0]), "utf8")
    assert.match(agent, /mode: subagent/)
    assert.ok(!agent.includes("tools: Read"))

    const commands = await readdir(join(config, "commands"))
    assert.equal(commands.length, 1)
    const command = await readFile(join(config, "commands", commands[0]), "utf8")
    assert.match(command, /\$ARGUMENTS/)
    assert.ok(!command.includes("!\`echo NOT_ALLOWED\`"))
    assert.ok(!command.includes("allowed-tools:"))

    const hookFiles = await readdir(join(config, "hooks/onethy"))
    const modFiles = await readdir(join(config, "mods/onethy"))
    assert.equal(hookFiles.length, 1)
    assert.equal(modFiles.length, 1)
    const hook = JSON.parse(await readFile(join(config, "hooks/onethy", hookFiles[0]), "utf8"))
    const mod = JSON.parse(await readFile(join(config, "mods/onethy", modFiles[0]), "utf8"))
    assert.equal(hook.implementation, "protected-push")
    assert.equal(mod.implementation, "secret-redactor")
    assert.equal(hook.enabled, false)
    assert.equal(mod.enabled, false)

    const mcpFiles = await readdir(join(config, "mcp/onethy"))
    assert.equal(mcpFiles.length, 2)
    const localDefaults = JSON.parse(await readFile(join(config, "mcp/onethy/local-tools.json"), "utf8"))
    assert.equal(Object.keys(localDefaults.mcpServers).length, 3)
    assert.ok(Object.values(localDefaults.mcpServers).every(server => server.disabled === true))
    assert.ok(Object.keys(localDefaults.mcpServers).includes("onethy-browser"))
    const mcp = JSON.parse(await readFile(join(config, "mcp/onethy", mcpFiles.find(file => file !== "local-tools.json")), "utf8"))
    const [name, definition] = Object.entries(mcp.mcpServers)[0]
    assert.ok(name.startsWith("onethy-"))
    assert.equal(definition.type, "stdio")
    assert.equal(definition.disabled, true)
    assert.ok(!JSON.stringify(mcp).includes("TOKEN"))
    assert.ok(!JSON.stringify(mcp).includes("github"))

    const repeated = await syncOnethyCustomizations({ sourceDir, cwd, install: true })
    assert.equal(repeated.installed, 0)
    assert.equal(repeated.existing, 8)
    await assert.rejects(stat(join(cwd, "NOT_ALLOWED")))

    const another = join(base, "skills/development/escape/SKILL.md")
    await mkdir(dirname(another), { recursive: true })
    await writeFile(another, "---\nname: escape\ndescription: Escape\n---\nDo not follow symlinks")
    const external = join(root, "external")
    await mkdir(external)
    await symlink(external, join(config, "skills/development-escape"), process.platform === "win32" ? "junction" : "dir")
    const guarded = await syncOnethyCustomizations({ sourceDir, cwd, install: true })
    assert.ok(guarded.rejected >= 1)
    assert.deepEqual(await readdir(external), [])

    const globalDir = join(root, "user-global")
    const global = await syncOnethyCustomizations({ sourceDir, global: true, globalDir, type: "skills", install: true })
    assert.equal(global.installed, 3)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("local MCP allowlist rejects all remote, authenticated and unknown providers", async () => {
  const { convertMcpTemplate } = await import("../packages/cli/src/services/onethy-customization-mcp.mjs")
  const source = JSON.stringify({ mcpServers: {
    localMemory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] },
    localThinking: { command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"] },
    needsKey: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], env: { API_KEY: "SECRET" } },
    hosted: { url: "https://hosted.example.net/mcp" },
    unknown: { command: "npx", args: ["-y", "unknown-provider-mcp"] },
    unsafeArg: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory", "--token=SECRET"] },
  } })
  const converted = convertMcpTemplate(source, "local/no-account.json")
  assert.equal(converted.count, 2)
  assert.equal(Object.keys(JSON.parse(converted.json).mcpServers).length, 2)
  assert.ok(!converted.json.includes("SECRET"))
  assert.ok(!converted.json.includes("unknown-provider"))
  assert.ok(converted.warnings.length >= 4)
})

test("obsolete generated MCP templates are pruned but user-customized ones are preserved", async () => {
  const { cleanupObsoleteGeneratedMCPs } = await import("../packages/cli/src/services/onethy-customizations-cleanup.mjs")
  const root = await mkdtemp(join(tmpdir(), "onethy-legacy-mcp-test-"))
  try {
    const deprecated = String.fromCharCode(97, 105, 116, 109, 112, 108)
    const folder = join(root, "mcp", deprecated)
    await mkdir(folder, { recursive: true })
    const generated = join(folder, "unused.json")
    const configured = join(folder, "manual.json")
    await writeFile(generated, JSON.stringify({ mcpServers: { [deprecated + "-generated"]: {
      disabled: true, type: "stdio", command: "npx", args: ["-y", "provider-account"],
    } } }))
    await writeFile(configured, JSON.stringify({ mcpServers: { [deprecated + "-custom"]: {
      disabled: false, type: "stdio", command: "npx", args: ["-y", "user-modified"],
    } } }))
    assert.equal(await cleanupObsoleteGeneratedMCPs(root), 1)
    await assert.rejects(stat(generated))
    assert.equal((await stat(configured)).isFile(), true)
    assert.equal(await cleanupObsoleteGeneratedMCPs(root), 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
