import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink, readdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { syncOnethyCustomizations } from "../packages/cli/src/services/onethy-customizations.mjs"
import { LOCAL_MCP_NAMES, curatedLocalMCPs } from "../packages/cli/src/services/onethy-customizations-local-mcp.mjs"

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
    assert.equal(preview.ready, 9)
    await assert.rejects(stat(join(cwd, ".opencode")))
    const first = await syncOnethyCustomizations({ sourceDir, cwd, install: true })
    assert.equal(first.installed, 9)
    assert.equal(first.pending, 0)

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
    assert.deepEqual(mcpFiles, ["local-tools.json"])
    const localDefaults = JSON.parse(await readFile(join(config, "mcp/onethy/local-tools.json"), "utf8"))
    assert.deepEqual(Object.keys(localDefaults.mcpServers).toSorted(),
      [...LOCAL_MCP_NAMES].toSorted())
    assert.ok(Object.values(localDefaults.mcpServers).every(server =>
      server.disabled === true && server.type === "stdio" && !("env" in server) && !("headers" in server)))

    const pluginFiles = await readdir(join(config, "plugins/onethy"))
    assert.equal(pluginFiles.length, 2)
    const pluginDefinitions = await Promise.all(pluginFiles.map(async name =>
      JSON.parse(await readFile(join(config, "plugins/onethy", name), "utf8"))))
    assert.ok(pluginDefinitions.every(value => value.enabled === false && value.kind === "plugin"))
    assert.deepEqual(pluginDefinitions.map(p => p.implementation).toSorted(),
      ["local-sensitive-file-guard", "local-tool-preference"])
    const repeated = await syncOnethyCustomizations({ sourceDir, cwd, install: true })
    assert.equal(repeated.installed, 0)
    assert.equal(repeated.existing, 9)
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

test("MCP-only synchronization never imports remote provider definitions and works without a catalog clone", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-mcp-only-"))
  try {
    const result = await syncOnethyCustomizations({
      sourceDir: join(root, "no-catalog-needed"),
      cwd: root,
      type: "mcps",
      install: true,
    })
    assert.equal(result.installed, 1)
    const files = await readdir(join(root, ".opencode", "mcp", "onethy"))
    assert.deepEqual(files, ["local-tools.json"])
    const definitions = JSON.parse(await readFile(join(root, ".opencode", "mcp", "onethy", files[0]), "utf8"))
    assert.ok(Object.values(definitions.mcpServers).every(server =>
      server.disabled === true && !("url" in server) && !("environment" in server)))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("plugins are first-party descriptors without third-party executable code", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-plugin-only-"))
  try {
    const result = await syncOnethyCustomizations({ sourceDir: join(root, "nonexistent"), cwd: root, type: "plugins", install: true })
    assert.equal(result.installed, 2)
    const files = await readdir(join(root, ".opencode", "plugins", "onethy"))
    assert.equal(files.length, 2)
    for (const file of files) {
      const descriptor = JSON.parse(await readFile(join(root, ".opencode", "plugins", "onethy", file), "utf8"))
      assert.equal(descriptor.enabled, false)
      assert.equal(descriptor.kind, "plugin")
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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

test("obsolete generated MCP imports are removed without touching user-managed configs", async () => {
  const { cleanupGeneratedOnethyMCPs } = await import("../packages/cli/src/services/onethy-customizations-cleanup.mjs")
  const root = await mkdtemp(join(tmpdir(), "onethy-mcp-generated-"))
  try {
    const folder = join(root, "mcp", "onethy")
    await mkdir(folder, { recursive: true })
    const generated = join(folder, "integration-memory-1234abcd.json")
    const enabled = join(folder, "integration-user-1234abcd.json")
    const modified = join(folder, "integration-private-1234abcd.json")
    await writeFile(generated, JSON.stringify({ mcpServers: {
      "onethy-integration-memory-1234abcd": {
        disabled: true, type: "stdio", command: "npx", args: ["-y", "external-mcp"],
      },
    } }))
    await writeFile(enabled, JSON.stringify({ mcpServers: {
      "onethy-integration-user-1234abcd": {
        disabled: false, type: "stdio", command: "npx", args: ["-y", "my-mcp"],
      },
    } }))
    await writeFile(modified, JSON.stringify({ mcpServers: {
      "onethy-integration-private-1234abcd": {
        disabled: true, type: "stdio", command: "npx", args: ["-y", "my-mcp"], environment: { MY_SETTING: "configured" },
      },
    } }))
    await writeFile(join(folder, "local-tools.json"), JSON.stringify({ mcpServers: { "onethy-time": { disabled: true } } }))
    assert.equal(await cleanupGeneratedOnethyMCPs(root), 1)
    await assert.rejects(stat(generated))
    assert.ok((await stat(enabled)).isFile())
    assert.ok((await stat(modified)).isFile())
    assert.ok((await stat(join(folder, "local-tools.json"))).isFile())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


test("all eight first-party MCPs have local account-free commands and workspace confinement", () => {
  const names = [
    "onethy-playwright", "onethy-chrome-devtools", "onethy-serena",
    "onethy-filesystem", "onethy-git", "onethy-memory",
    "onethy-markitdown", "onethy-desktop-commander",
  ]
  assert.deepEqual([...LOCAL_MCP_NAMES], names)
  const doc = JSON.parse(curatedLocalMCPs())
  assert.deepEqual(Object.keys(doc), ["mcpServers"])
  assert.equal(Object.keys(doc.mcpServers).length, 8)
  assert.deepEqual(Object.keys(doc.mcpServers), names)
  for (const [id, config] of Object.entries(doc.mcpServers)) {
    assert.equal(config.disabled, true, id)
    assert.equal(config.type, "stdio", id)
    assert.ok(["npx", "uvx"].includes(config.command), id)
    assert.ok(config.args.length >= 1, id)
    assert.ok(config.args.every(arg => typeof arg === "string"), id)
    assert.ok(!("env" in config) && !("headers" in config) && !("url" in config), id)
    assert.ok(!config.args.some(arg => /(?:api[_-]?key|access[_-]?token|oauth|remote)/i.test(arg)), id)
  }
  assert.equal(doc.mcpServers["onethy-filesystem"].args.at(-1), ".")
  assert.deepEqual(doc.mcpServers["onethy-git"].args.slice(-2), ["--repository", "."])
  assert.ok(doc.mcpServers["onethy-serena"].args.includes("--project-from-cwd"))
  assert.ok(!doc.mcpServers["onethy-desktop-commander"].args.includes("remote"))
})

test("upgrade from unmodified three-MCP bundle installs all eight and preserves edited versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-eight-mcp-upgrade-"))
  try {
    const dir = join(root, ".opencode", "mcp", "onethy")
    await mkdir(dir, { recursive: true })
    const file = join(dir, "local-tools.json")
    const original = { mcpServers: {
      "onethy-browser": { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"], disabled: true },
      "onethy-sequential-thinking": { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"], disabled: true },
      "onethy-time": { type: "stdio", command: "uvx", args: ["mcp-server-time"], disabled: true },
    } }
    await writeFile(file, JSON.stringify(original, null, 2))
    const report = await syncOnethyCustomizations({
      sourceDir: join(root, "not-required"), cwd: root, type: "mcps", install: true,
    })
    assert.equal(report.migratedLocalMcpBundle, true)
    assert.equal(report.installed, 1)
    assert.deepEqual(Object.keys(JSON.parse(await readFile(file, "utf8")).mcpServers), [...LOCAL_MCP_NAMES])

    await writeFile(file, JSON.stringify({ mcpServers: {
      ...original.mcpServers,
      "local-custom": { type: "stdio", command: "uvx", args: ["my-custom-tool"], disabled: false },
    } }))
    const preserved = await syncOnethyCustomizations({
      sourceDir: join(root, "not-required"), cwd: root, type: "mcps", install: true,
    })
    assert.equal(preserved.migratedLocalMcpBundle, false)
    assert.equal(preserved.installed, 0)
    assert.equal(preserved.existing, 1)
    assert.equal(Object.keys(JSON.parse(await readFile(file, "utf8")).mcpServers).length, 4)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
