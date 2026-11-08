import { chmod, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "bun:test"
import { findBun, makeOmniEnvironment } from "../../../bin/omni-runtime.js"
import { tmpdir } from "./fixture/tmpdir"

test("finds Bun in an absolute PATH entry and ignores relative entries", async () => {
  await using directory = await tmpdir()
  const bun = path.join(directory.path, process.platform === "win32" ? "bun.exe" : "bun")
  await writeFile(bun, "")
  if (process.platform !== "win32") await chmod(bun, 0o755)

  expect(
    findBun({
      BUN_BIN: "bun",
      LOCALAPPDATA: path.join(directory.path, "local"),
      USERPROFILE: path.join(directory.path, "home"),
      PATH: [".", directory.path].join(path.delimiter),
    }),
  ).toBe(bun)
})

test("does not resolve Bun from a relative path", async () => {
  await using directory = await tmpdir()
  expect(
    findBun({
      BUN_BIN: "./bun",
      LOCALAPPDATA: path.join(directory.path, "local"),
      USERPROFILE: path.join(directory.path, "home"),
      PATH: ".",
    }),
  ).toBeUndefined()
})

test("rejects Windows batch shims as Bun executables", async () => {
  if (process.platform !== "win32") return
  await using directory = await tmpdir()
  const shim = path.join(directory.path, "bun.cmd")
  await writeFile(shim, "@echo off")

  expect(
    findBun({
      BUN_BIN: shim,
      LOCALAPPDATA: path.join(directory.path, "local"),
      USERPROFILE: path.join(directory.path, "home"),
      PATH: directory.path,
    }),
  ).toBeUndefined()
})

test("fails clearly when Bun cannot be found", async () => {
  await using directory = await tmpdir()
  const node = Bun.which("node")
  expect(node).toBeTruthy()
  if (!node) return
  const child = Bun.spawn([node, path.resolve(import.meta.dir, "../../../bin/omni.js")], {
    env: {
      ...process.env,
      BUN_BIN: path.join(directory.path, "missing.exe"),
      LOCALAPPDATA: directory.path,
      USERPROFILE: directory.path,
      PATH: directory.path,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  expect(exitCode).not.toBe(0)
  expect(`${stdout}${stderr}`).toContain("Bun was not found")
})

test("isolates inherited OpenCode settings and preserves provider credentials", () => {
  const env = makeOmniEnvironment(
    {
      OPENCODE_CONFIG_DIR: "C:\\OpenCode\\config",
      OPENCODE_DB: "C:\\OpenCode\\data.db",
      OPENAI_API_KEY: "test-key",
      PATH: "C:\\tools",
    },
    "C:\\tools\\bun.exe",
  )

  expect(env.OPENCODE_CONFIG_DIR).toBeUndefined()
  expect(env.OPENCODE_DB).toBeUndefined()
  expect(env.OMNICODE_ACTIVE).toBe("1")
  expect(env.BUN_BIN).toBe("C:\\tools\\bun.exe")
  expect(env.OPENAI_API_KEY).toBe("test-key")
  expect(env.PATH?.split(path.delimiter)[0]).toBe("C:\\tools")
})
