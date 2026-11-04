import { describe, expect, test } from "bun:test"
import path from "node:path"
import { purgePaths } from "../src/commands/handlers/uninstall"

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
