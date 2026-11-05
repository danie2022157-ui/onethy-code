import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink, readdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { syncAITmpl } from "../packages/cli/src/services/aitmpl-native.mjs"

test("AITmpl imports only native personalizations; never imports slash commands or executes hooks", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-aitmpl-test-"))
  try {
    const catalog = join(root, "catalog")
    const project = join(root, "project")
    const skill = join(catalog, "cli-tool/components/skills/development/example/SKILL.md")
    const asset = join(catalog, "cli-tool/components/skills/development/example/example.txt")
    const agent = join(catalog, "cli-tool/components/agents/development-team/frontend.md")
    const command = join(catalog, "cli-tool/components/commands/testing/generate.md")
    const hook = join(catalog, "cli-tool/components/hooks/git/malicious.sh")
    const mcp = join(catalog, "cli-tool/components/mcps/integration/github.json")
    for (const file of [skill, asset, agent, command, hook, mcp]) await mkdir(dirname(file), { recursive: true })
    await mkdir(project, { recursive: true })
    await writeFile(skill, "---\nname: example\ndescription: Example skill\n---\nA skill")
    await writeFile(asset, "asset content")
    await writeFile(agent, "---\nname: frontend\ntools: Read, Write, Edit, Bash\n---\nAgent body")
    await writeFile(command, "---\ndescription: Generate tests\n---\nCommand body")
    await writeFile(hook, "touch should-not-exist")
    await writeFile(mcp, JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "some-mcp-package"], env: { GITHUB_TOKEN: "<YOUR_TOKEN>" } } } }))
    const run = (install) => syncAITmpl({ sourceDir: catalog, cwd: project, install })
    const preview = await run(false)
    assert.equal(preview.installed, 0)
    assert.equal(preview.ready, 4)
    await assert.rejects(stat(join(project, ".opencode")))
    const installed = await run(true)
    assert.equal(installed.installed, 4)
    const converted = await readFile(join(project, ".opencode/agents/development-team-frontend.md"), "utf8")
    assert.match(converted, /mode: subagent/)
    assert.match(converted, /Use only tools and connected services actually available/)
    assert.ok(!converted.includes("read: true"))
    assert.ok(!converted.includes("tools: Read, Write"))
    const skillText = await readFile(join(project, ".opencode/skills/development-example/SKILL.md"), "utf8")
    assert.match(skillText, /name: development-example/)
    assert.equal(await readFile(join(project, ".opencode/skills/development-example/example.txt"), "utf8"), "asset content")
    const mcpFiles = await readdir(join(project, ".opencode/mcp/aitmpl"))
    assert.equal(mcpFiles.length, 1)
    const nativeMcp = JSON.parse(await readFile(join(project, ".opencode/mcp/aitmpl", mcpFiles[0]), "utf8"))
    const definition = Object.values(nativeMcp.mcpServers)[0]
    assert.equal(definition.disabled, true)
    assert.equal(definition.command, "npx")
    assert.ok(!("env" in definition))
    assert.ok(!JSON.stringify(nativeMcp).includes("<YOUR_TOKEN>"))
    const repeat = await run(true)
    assert.equal(repeat.installed, 0)
    assert.equal(repeat.existing, 4)
    await assert.rejects(stat(join(project, ".opencode/commands")))
    await assert.rejects(stat(join(project, "should-not-exist")))
    const otherSkill = join(catalog, "cli-tool/components/skills/development/escape/SKILL.md")
    await mkdir(dirname(otherSkill), { recursive: true })
    await writeFile(otherSkill, "---\\nname: escape\\ndescription: Another skill\\n---\\nunsafe destination")
    const external = join(root, "external")
    await mkdir(external, { recursive: true })
    await symlink(external, join(project, ".opencode/skills/development-escape"), process.platform === "win32" ? "junction" : "dir")
    const guarded = await run(true)
    assert.ok(guarded.rejected > 0)
    assert.deepEqual(await readdir(external), [])
    const global = join(root, "native-global")
    const globally = await syncAITmpl({ sourceDir: catalog, global: true, globalDir: global, install: true, type: "skills" })
    assert.equal(globally.installed, 3)
    assert.equal(await readFile(join(global, "skills/development-example/example.txt"), "utf8"), "asset content")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("MCP converter supports remote URLs, sanitizes headers and rejects unsafe wrappers", async () => {
  const { convertMcpTemplate } = await import("../packages/cli/src/services/aitmpl-mcp.mjs")
  const source = JSON.stringify({ mcpServers: {
    remote: { type: "http", url: "https://api.example.org/mcp", headers: { Authorization: "Bearer SECRET" } },
    shell: { command: "bash", args: ["-c", "curl bad.example"] },
  } })
  const value = convertMcpTemplate(source, "integrations/sample.json")
  assert.equal(value.count, 1)
  const file = JSON.parse(value.json)
  const server = Object.values(file.mcpServers)[0]
  assert.equal(server.url, "https://api.example.org/mcp")
  assert.equal(server.disabled, true)
  assert.ok(!("headers" in server))
  assert.ok(!value.json.includes("SECRET"))
  assert.ok(value.warnings.some(w => w.includes("shell wrapper")))
  const sensitive = convertMcpTemplate(JSON.stringify({ mcpServers: { leaked: { url: "https://example.org/mcp?token=secret" }, argv: { command: "npx", args: ["--token=secret"] } } }), "unsafe/sample.json")
  assert.equal(sensitive.count, 0)
  assert.equal(sensitive.json, null)
})
