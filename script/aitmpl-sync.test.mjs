import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises"
import { join, resolve, dirname } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

const script = resolve("script/aitmpl-sync.mjs")
test("AITmpl imports native files without executing catalog scripts or overwriting existing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-aitmpl-test-"))
  try {
    const catalog = join(root, "catalog")
    const project = join(root, "project")
    const skill = join(catalog, "cli-tool/components/skills/development/example/SKILL.md")
    const asset = join(catalog, "cli-tool/components/skills/development/example/example.txt")
    const agent = join(catalog, "cli-tool/components/agents/development-team/frontend.md")
    const command = join(catalog, "cli-tool/components/commands/testing/generate.md")
    const hook = join(catalog, "cli-tool/components/hooks/git/malicious.sh")
    for (const file of [skill, asset, agent, command, hook]) await mkdir(dirname(file), { recursive: true })
    await mkdir(project, { recursive: true })
    await writeFile(skill, "---\nname: example\ndescription: Example skill\n---\nA skill")
    await writeFile(asset, "asset content")
    await writeFile(agent, "---\nname: frontend\ntools: Read, Write, Edit, Bash\n---\nAgent body")
    await writeFile(command, "---\ndescription: Generate tests\n---\nCommand body")
    await writeFile(hook, "touch should-not-exist")
    const run = (...opts) => {
      const proc = spawnSync(process.execPath, [script, "--source-dir", catalog, ...opts], { cwd: project, encoding: "utf8" })
      assert.equal(proc.status, 0, proc.stderr)
      return JSON.parse(proc.stdout.slice(0, proc.stdout.indexOf("\nNOTE:") >= 0 ? proc.stdout.indexOf("\nNOTE:") : undefined))
    }
    const preview = run()
    assert.equal(preview.installed, 0)
    assert.ok(preview.ready >= 4)
    await assert.rejects(stat(join(project, ".opencode")))
    const installed = run("--install")
    assert.equal(installed.installed, 4)
    const converted = await readFile(join(project, ".opencode/agents/development-team-frontend.md"), "utf8")
    assert.match(converted, /read: true/)
    assert.match(converted, /bash: true/)
    assert.ok(!converted.includes("tools: Read, Write"))
    assert.equal(await readFile(join(project, ".opencode/skills/development-example/example.txt"), "utf8"), "asset content")
    const repeat = run("--install")
    assert.equal(repeat.installed, 0)
    assert.equal(repeat.existing, 4)
    await assert.rejects(stat(join(project, "should-not-exist")))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
