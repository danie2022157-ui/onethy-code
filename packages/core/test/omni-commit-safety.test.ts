import { describe, expect, test } from "bun:test"
import { isSensitiveCommitPath, parseChangedGitPaths } from "../src/omni-commit-safety"

describe("Onethy safe commit preflight", () => {
  test("blocks credentials and internal Onethy session and memory data", () => {
    for (const file of [
      ".env", ".env.local", "apps/api/.env.production",
      "credentials.json", "service-account.json", "keys/private.pem",
      ".omnicode/memory-bank/active-context.md",
      ".omnicode/sessions/ses-1.json",
      "client\\.omnicode\\omnicode.jsonc",
      "secrets.json", "id_rsa",
    ]) expect(isSensitiveCommitPath(file)).toBe(true)
  })
  test("does not block ordinary source code or example configuration templates", () => {
    for (const file of ["src/index.ts", "README.md", "tests/example.test.ts", ".env.example", ".env.sample", ".env.template"])
      expect(isSensitiveCommitPath(file)).toBe(false)
  })
  test("parses NUL-separated modified, renamed and untracked paths", () => {
    const status = " M src/index.ts\0?? .env.local\0R  docs/current.md\0docs/previous.md\0"
    expect(parseChangedGitPaths(status)).toEqual([
      "src/index.ts", ".env.local", "docs/current.md", "docs/previous.md",
    ])
    expect(parseChangedGitPaths(status).filter(isSensitiveCommitPath)).toEqual([".env.local"])
  })
})
