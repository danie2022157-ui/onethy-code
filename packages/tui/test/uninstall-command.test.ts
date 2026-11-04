import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { onethySourceCheckout, uninstallWorkerArgs } from "../src/feature-plugins/system/uninstall"

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

  test("starts a self-contained PowerShell script and waits for Onethy processes", () => {
    const checkout = path.resolve("C:/Users/Demo/onethy-code")
    const script = path.resolve("C:/Temp/onethy-uninstall-1/uninstall.ps1")
    const args = uninstallWorkerArgs(script, checkout, 123, 456)
    expect(args).toContain("-File")
    expect(args).toContain(script)
    expect(args).toContain("-Checkout")
    expect(args).toContain(checkout)
    expect(args).toContain("-ChildPid")
    expect(args).toContain("123")
    expect(args).toContain("-ParentPid")
    expect(args).toContain("456")
    expect(args).toContain("-Yes")
    expect(args).toContain("-KeepWindow")
    expect(() => uninstallWorkerArgs(script, checkout, -1, 456)).toThrow()
    expect(() => uninstallWorkerArgs("", checkout, 123, 456)).toThrow()
  })
})
