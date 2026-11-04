import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import { purgePaths, ownedOnethyLaunchers } from "../src/commands/handlers/uninstall"

describe("Onethy full uninstall boundaries", () => {
  test("only targets the application's own directories", () => {
    const home = path.resolve("C:/Users/test")
    const parent = path.join(home, "AppData", "Local", "omnicode")
    const roots = {
      home,
      config: path.join(home, "AppData", "Roaming", "omnicode"),
      data: path.join(parent, "data"),
      cache: path.join(parent, "cache"),
      state: path.join(parent, "state"),
    }
    expect(purgePaths(roots)).toEqual([roots.data, roots.config, roots.state, roots.cache])
  })

  test("never targets a home directory, repository, or unrelated OpenCode data", () => {
    const home = path.resolve("C:/Users/test")
    const roots = {
      home,
      config: path.join(home, "projects", "customer"),
      data: path.join(home, ".config", "opencode"),
      cache: path.join(home, "projects", "onethy-code"),
      state: home,
    }
    expect(purgePaths(roots)).toEqual([])
  })
})

describe("Onethy Windows installer cleanup", () => {
  test("selects only verified launchers for the current checkout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "onethy-uninstall-"))
    const checkout = path.join(root, "onethy-code")
    const directory = path.join(root, "Microsoft", "WindowsApps")
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, "onethy-config.json"), JSON.stringify({ nodePath: "node.exe", checkout }))
      await writeFile(path.join(directory, "onethy.ps1"), `Join-Path $PSScriptRoot "onethy-config.json"; Join-Path $config.checkout "bin\\onethy.js"`)
      const command = `@echo off\n"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0onethy.ps1" %*\nexit /b %ERRORLEVEL%`
      await writeFile(path.join(directory, "onethy.cmd"), command)
      await writeFile(path.join(directory, "omni.cmd"), "echo not-owned")
      const env = { LOCALAPPDATA: root, ONETHY_INSTALL_ROOT: checkout }
      expect(await ownedOnethyLaunchers(env, "win32")).toEqual([
        path.join(directory, "onethy.cmd"),
        path.join(directory, "onethy.ps1"),
        path.join(directory, "onethy-config.json"),
      ])
      expect(await ownedOnethyLaunchers({ ...env, ONETHY_INSTALL_ROOT: path.join(root, "another-checkout") }, "win32")).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
