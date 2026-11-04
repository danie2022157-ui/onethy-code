import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { onethySourceCheckout, onethyInstalledLauncher, uninstallWorkerCommand } from "../src/feature-plugins/system/uninstall"

describe("OnethyCode source checkout removal confirmation", () => {
  test("recognizes a verified checkout within the user's home", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "onethy-source-test-"))
    const source = path.join(home, "onethy-code-atualizado")
    try {
      await mkdir(path.join(source, "bin"), { recursive: true })
      await writeFile(path.join(source, "bin", "onethy.js"), "launcher")
      await writeFile(path.join(source, "install.ps1"), "installer")
      expect(onethySourceCheckout({ USERPROFILE: home, ONETHY_INSTALL_ROOT: source }, "win32")).toBe(source)
      expect(onethySourceCheckout({ USERPROFILE: home, ONETHY_INSTALL_ROOT: home }, "win32")).toBeUndefined()
      expect(onethySourceCheckout({ USERPROFILE: home, ONETHY_INSTALL_ROOT: path.dirname(home) }, "win32")).toBeUndefined()
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test("requires a verified checkout and launcher and deletes them only after the CLI returns", () => {
    const checkout = path.resolve("C:/Users/Demo/onethy-code")
    const launcher = path.resolve("C:/Users/Demo/Microsoft/WindowsApps/onethy.cmd")
    const script = uninstallWorkerCommand(123, checkout, launcher, 456)
    expect(script).toContain("--purge --force --defer-launchers")
    expect(script).toContain("Get-Process -Id 456")
    expect(script.indexOf("--defer-launchers")).toBeLessThan(script.indexOf("Remove-Item"))
    expect(script).toContain("onethy.ps1")
    expect(script).toContain("onethy-config.json")
    expect(script).toContain("Remove-Item -LiteralPath $checkout -Recurse -Force")
    expect(() => uninstallWorkerCommand(123, "", launcher)).toThrow()
    expect(() => uninstallWorkerCommand(-1, checkout, launcher)).toThrow()
  })

  test("verifies global onethy.cmd belongs to the current checkout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "onethy-launcher-test-"))
    const checkout = path.join(root, "onethy-code")
    const directory = path.join(root, "Microsoft", "WindowsApps")
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, "onethy-config.json"), JSON.stringify({ checkout }))
      await writeFile(path.join(directory, "onethy.ps1"), 'Get-Content "onethy-config.json"; Join-Path $config.checkout "bin\\\\onethy.js"')
      await writeFile(path.join(directory, "onethy.cmd"), 'powershell.exe -File "%~dp0onethy.ps1" %*')
      expect(onethyInstalledLauncher(checkout, { LOCALAPPDATA: root })).toBe(path.join(directory, "onethy.cmd"))
      expect(onethyInstalledLauncher(path.join(root, "other"), { LOCALAPPDATA: root })).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
