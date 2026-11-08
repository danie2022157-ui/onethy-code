import { expect, test } from "bun:test"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { pathToFileURL } from "node:url"

test("OmniCode global paths remain private before any runtime service is acquired", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omnicode-global-"))
  try {
    const module = pathToFileURL(path.join(import.meta.dir, "../src/global.ts")).href
    const result = Bun.spawnSync({
      cmd: [process.execPath, "-e", `const { Global } = await import(${JSON.stringify(module)}); console.log(JSON.stringify(Global.make()))`],
      env: {
        ...process.env,
        OMNICODE_ACTIVE: "1",
        OMNICODE_CONFIG_DIR: path.join(root, "config"),
        OMNICODE_DATA_DIR: path.join(root, "data"),
        OMNICODE_CACHE_DIR: path.join(root, "cache"),
        OMNICODE_STATE_DIR: path.join(root, "state"),
        OPENCODE_CONFIG_DIR: undefined,
        OPENCODE_TEST_HOME: root,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const resolved = JSON.parse(result.stdout.toString())
    expect(resolved.config).toBe(path.join(root, "config"))
    expect(resolved.data).toBe(path.join(root, "data"))
    expect(resolved.state).toBe(path.join(root, "state"))
    expect(resolved.cache).toBe(path.join(root, "cache"))
    expect(fs.readdirSync(root)).toEqual([])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
