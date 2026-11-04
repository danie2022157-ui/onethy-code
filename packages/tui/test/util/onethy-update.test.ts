import { describe, expect, test } from "bun:test"
import { checkOnethyUpdate, type GitRunner } from "../../src/util/onethy-update"

const LOCAL = "a".repeat(40)
const REMOTE = "b".repeat(40)
const URL = "https://github.com/danie2022157-ui/onethy-code.git"

function fixture(input: { local?: string; remote?: string; origin?: string; branch?: string; fail?: string } = {}) {
  const calls: string[] = []
  const git: GitRunner = async (args) => {
    const cmd = args.join(" ")
    calls.push(cmd)
    const response: Record<string, string> = {
      "branch --show-current": input.branch ?? "main",
      "remote get-url origin": input.origin ?? URL,
      "rev-parse HEAD": input.local ?? LOCAL,
      "ls-remote origin refs/heads/main": (input.remote ?? REMOTE) + "\trefs/heads/main",
    }
    return { stdout: response[cmd] ?? "", stderr: "", code: cmd === input.fail ? 1 : 0 }
  }
  return { git, calls }
}

describe("OnethyCode automatic update detection", () => {
  test("detects new commits without modifying the installation", async () => {
    const { git, calls } = fixture()
    const result = await checkOnethyUpdate({ root: "/opt/onethy", git })
    expect(result).toEqual({ current: "aaaaaaa", available: "bbbbbbb" })
    expect(calls).toEqual([
      "branch --show-current",
      "remote get-url origin",
      "rev-parse HEAD",
      "ls-remote origin refs/heads/main",
    ])
  })

  test("does not alert when the checkout is already current", async () => {
    const { git } = fixture({ remote: LOCAL })
    expect(await checkOnethyUpdate({ root: "/opt/onethy", git })).toBeUndefined()
  })

  test("only checks official origin and the main branch", async () => {
    const foreign = fixture({ origin: "https://github.com/other/repo.git" })
    expect(await checkOnethyUpdate({ root: "/opt/onethy", git: foreign.git })).toBeUndefined()
    expect(foreign.calls).not.toContain("ls-remote origin refs/heads/main")
    const branch = fixture({ branch: "feature" })
    expect(await checkOnethyUpdate({ root: "/opt/onethy", git: branch.git })).toBeUndefined()
    expect(branch.calls).toEqual(["branch --show-current"])
  })

  test("treats GitHub errors or malformed refs as unknown, not an available update", async () => {
    const unavailable = fixture({ fail: "ls-remote origin refs/heads/main" })
    expect(await checkOnethyUpdate({ root: "/opt/onethy", git: unavailable.git })).toBeUndefined()
    const invalid = fixture({ remote: "not-a-sha" })
    expect(await checkOnethyUpdate({ root: "/opt/onethy", git: invalid.git })).toBeUndefined()
  })
})
