import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  addProjectDirectory,
  cleanProjectPath,
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

  test("accepts File Explorer Copy as path with quotes, spaces and absolute Windows drive paths", () => {
    const cwd = "C:\\Users\\Daniel\\onethy-code\\onethy-code\\packages\\cli"
    const expected = "C:\\Users\\Daniel\\Documents\\REMOTION VIDEO CRIA"
    expect(cleanProjectPath('  "' + expected + '"  ')).toBe(expected)
    expect(resolveProjectDirectory('"' + expected + '"', cwd, "win32")).toBe(expected)
    expect(resolveProjectDirectory("'" + expected + "'", cwd, "win32")).toBe(expected)
    expect(resolveProjectDirectory("“" + expected + "”", cwd, "win32")).toBe(expected)
    expect(resolveProjectDirectory(expected, cwd, "win32")).toBe(expected)
    expect(resolveProjectDirectory("new-project", cwd, "win32")).toBe(
      "C:\\Users\\Daniel\\onethy-code\\onethy-code\\packages\\cli\\new-project",
    )
    expect(resolveProjectDirectory('"\\\\server\\share\\folder with spaces"', cwd, "win32")).toBe(
      "\\\\server\\share\\folder with spaces",
    )
    expect(() => resolveProjectDirectory('"C:\\\\"', cwd, "win32")).toThrow("root")
    expect(() => resolveProjectDirectory("C:relative-project", cwd, "win32")).toThrow("full Windows path")
    expect(() => resolveProjectDirectory("\\relative-to-drive", cwd, "win32")).toThrow("full Windows path")
  })

  test("pasted quoted paths with spaces work for both existing and newly created projects", () =>
    sandbox((root) => {
      const existing = path.join(root, "REMOTION VIDEO CRIA")
      fs.mkdirSync(existing)
      expect(addProjectDirectory('"' + existing + '"', root)).toBe(existing)
      const created = path.join(root, "new project with spaces")
      expect(createProjectDirectory('"' + created + '"', root)).toBe(created)
      expect(fs.statSync(created).isDirectory()).toBe(true)
      expect(() => createProjectDirectory(created, root)).toThrow("Add existing folder")
      expect(() => addProjectDirectory('"'+path.join(root,"not-present")+'"', root)).toThrow("Create new project")
      expect(() => createProjectDirectory(path.join(root, "not-present", "child"), root)).toThrow("Parent folder")
    }),
  )

  test("rejects malformed input and Windows paths in a non-Windows backend with actionable messages", () => {
    expect(() => cleanProjectPath('  ""  ')).toThrow("valid project folder")
    expect(() => cleanProjectPath('"C:\\foo" garbage')).toThrow("embedded quotes")
    expect(() => cleanProjectPath('hello\nworld')).toThrow("line breaks")
    if (process.platform !== "win32") {
      expect(() => resolveProjectDirectory('"C:\\Users\\Daniel\\Documents\\REMOTION VIDEO CRIA"', "/tmp", "linux"))
        .toThrow("OnethyCode directly on Windows")
    }
  })

})
