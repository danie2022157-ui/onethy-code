import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  addProjectDirectory,
  createProjectDirectory,
  forgetProject,
  rememberProject,
  resolveProjectDirectory,
  visibleProjectDirectories,
  type ProjectRegistry,
} from "../../src/util/onethy-projects"

function sandbox(run: (directory: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "onethy-project-test-"))
  try {
    run(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

describe("Onethy project management", () => {
  test("creates a new folder and registers it without overwriting an existing project", () =>
    sandbox((root) => {
      const directory = createProjectDirectory("my-new-project", root)
      expect(directory).toBe(path.join(root, "my-new-project"))
      expect(fs.statSync(directory).isDirectory()).toBe(true)
      fs.writeFileSync(path.join(directory, "main.ts"), "important source code")
      expect(() => createProjectDirectory("my-new-project", root)).toThrow()
      expect(addProjectDirectory(directory, root)).toBe(directory)
      expect(fs.readFileSync(path.join(directory, "main.ts"), "utf8")).toBe("important source code")
    }),
  )

  test("removing a project only changes the manager registry, preserving files", () =>
    sandbox((root) => {
      const first = createProjectDirectory("a", root)
      const second = createProjectDirectory("b", root)
      fs.writeFileSync(path.join(first, "readme.md"), "must remain")
      const registry: ProjectRegistry = { registered: [], hidden: [], names: {} }
      rememberProject(registry, first)
      rememberProject(registry, second)
      expect(visibleProjectDirectories([first, second], registry)).toEqual([first, second])
      registry.names[first] = "Project renamed"
      forgetProject(registry, first)
      expect(visibleProjectDirectories([first, second], registry)).toEqual([second])
      expect(registry.names[first]).toBeUndefined()
      expect(fs.readFileSync(path.join(first, "readme.md"), "utf8")).toBe("must remain")
      rememberProject(registry, first)
      expect(visibleProjectDirectories([first, second], registry)).toContain(first)
    }),
  )

  test("rejects invalid roots, missing folders and symlink project entries", () =>
    sandbox((root) => {
      expect(() => resolveProjectDirectory("", root)).toThrow()
      expect(() => resolveProjectDirectory("..", root)).toThrow()
      expect(() => resolveProjectDirectory(path.parse(root).root, root)).toThrow()
      expect(() => addProjectDirectory("does-not-exist", root)).toThrow()
      const target = createProjectDirectory("target", root)
      try {
        fs.symlinkSync(target, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir")
        expect(() => addProjectDirectory("linked", root)).toThrow("symbolic link")
      } catch (error) {
        if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error
      }
    }),
  )
})
