import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import {
  rankCatalog, relevance, reviewDiff, searchProjectHistory, searchWorkspace, tokenize,
} from "../src/omni-intelligence.js"

const roots: string[] = []
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "onethy-intelligence-"))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("Onethy terminal intelligence", () => {
  test("handles accented language, identifiers and intent aliases", () => {
    expect(tokenize("Autenticação userProfile_name")).toEqual(["autenticacao", "user", "profile", "name"])
    expect(relevance("login", "src/authentication.ts", "validate credentials")).toBeGreaterThan(0)
    expect(rankCatalog([
      { category: "skill", name: "database-inspector", description: "query SQL storage" },
      { category: "tool", name: "image-generate", description: "render illustration" },
    ], "banco")).toEqual([
      { category: "skill", name: "database-inspector", description: "query SQL storage" },
    ])
  })

  test("finds code by meaning and line, skipping generated and secret files", async () => {
    const root = fixture()
    fs.mkdirSync(path.join(root, "src"))
    fs.mkdirSync(path.join(root, "node_modules"))
    fs.writeFileSync(path.join(root, "src", "authentication.ts"), [
      "export function authenticate(name: string) {",
      "  return name.length > 3",
      "}",
    ].join("\n"))
    fs.writeFileSync(path.join(root, ".env.local"), "AUTH_SECRET=not-indexed")
    fs.writeFileSync(path.join(root, "node_modules", "ignored.ts"), "function login() {}")
    const results = await searchWorkspace(root, "login")
    expect(results.map((item) => item.file)).toContain("src/authentication.ts")
    expect(results.every((item) => !item.file.includes(".env") && !item.file.includes("node_modules"))).toBe(true)
    expect(results[0]!.line).toBeGreaterThan(0)
  })

  test("searches actual persisted project history", async () => {
    const root = fixture()
    const sessions = path.join(root, ".omnicode", "sessions")
    fs.mkdirSync(sessions, { recursive: true })
    fs.writeFileSync(path.join(sessions, "ses-1.json"), JSON.stringify({
      id: "ses-1", goal: "Corrigir timeout de autenticação no login", mode: "approve",
    }))
    const results = await searchProjectHistory(root, "login")
    expect(results).toHaveLength(1)
    expect(results[0]!.name).toContain("ses-1.json")
    expect(await searchProjectHistory(root, "video")).toHaveLength(0)
  })

  test("returns staged and unstaged changes without modifying files", async () => {
    const root = fixture()
    const run = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" })
    run("init", "-q")
    fs.writeFileSync(path.join(root, "main.ts"), "export const ready = true\n")
    run("add", "main.ts")
    run("-c", "user.name=Onethy CI", "-c", "user.email=ci@example.invalid", "commit", "-qm", "initial")
    fs.writeFileSync(path.join(root, "main.ts"), "export const ready = false\n")
    const result = await reviewDiff(root)
    expect(result.patch).toContain("ready = false")
    expect(result.changed.some((line) => line.includes("main.ts"))).toBe(true)
    expect(fs.readFileSync(path.join(root, "main.ts"), "utf8")).toContain("false")
  })
})
