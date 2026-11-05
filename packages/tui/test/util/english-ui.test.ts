import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

test("key OnethyCode TUI screens display English", () => {
  for (const name of ["component/dialog-mcp.tsx", "component/dialog-projects.tsx", "component/dialog-memory-bank.tsx", "util/mcp-diagnostics.ts", "routes/home.tsx", "component/logo.tsx"]) {
    const text = readFileSync(resolve(import.meta.dir, "../../src", name), "utf8")
    expect(/[ãáàâéêíóôõúüç]/i.test(text)).toBe(false)
  }
})
