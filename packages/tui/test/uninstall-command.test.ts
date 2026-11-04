import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { onethySourceCheckout, uninstallWorkerCommand } from "../src/feature-plugins/system/uninstall"

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

  test("a worker never deletes source without explicit selected path", () => {
    expect(uninstallWorkerCommand(123)).not.toContain("Remove-Item")
    expect(uninstallWorkerCommand(123, "C:\\Users\\Demo\\onethy-code")).toContain("Remove-Item")
    expect(() => uninstallWorkerCommand(-1)).toThrow()
  })
})
