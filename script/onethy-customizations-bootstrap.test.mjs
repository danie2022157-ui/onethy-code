import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const bootstrap = resolve("script/onethy-customizations-bootstrap.mjs")

test("first Onethy install synchronizes native skills and MCP descriptors without external downloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-bootstrap-"))
  try {
    const source = join(root, "source")
    const config = join(root, "omnicode")
    const skillDir = join(source, "cli-tool", "components", "skills", "dev", "example")
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: example\ndescription: Simple safe test skill\n---\nTest safely.")
    const run = (env) => spawnSync(process.execPath, [bootstrap], {
      cwd: root, encoding: "utf8", timeout: 60000,
      env: {
        ...process.env, OMNICODE_ACTIVE: "1", ONETHY_ACTIVE: "1",
        ONETHY_INSTALL_ROOT: root, OMNICODE_CONFIG_DIR: config,
        ONETHY_CUSTOMIZATION_SOURCE_DIR: source,
        ...env,
      },
    })
    const first = run({})
    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stdout, /personalizations:/)
    assert.match(await readFile(join(config, "skills", "dev-example", "SKILL.md"), "utf8"), /Test safely/)
    const definitions = JSON.parse(await readFile(join(config, "mcp", "onethy", "local-tools.json"), "utf8"))
    assert.ok(Object.values(definitions.mcpServers).every((server) => server.disabled === true))
    const second = run({})
    assert.equal(second.status, 0, second.stderr)
    assert.match(second.stdout, /already present/)
    assert.equal((await readdir(join(config, "skills", "dev-example"))).filter((n) => n === "SKILL.md").length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("bootstrap refuses unrelated checkouts or installs without Onethy identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "onethy-bootstrap-refuse-"))
  try {
    const config = join(root, "config")
    const result = spawnSync(process.execPath, [bootstrap], {
      cwd: root, encoding: "utf8",
      env: {
        ...process.env, OMNICODE_ACTIVE: "0", ONETHY_ACTIVE: "0",
        ONETHY_INSTALL_ROOT: root, OMNICODE_CONFIG_DIR: config,
      },
    })
    assert.equal(result.status, 0)
    await assert.rejects(readdir(config), { code: "ENOENT" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
