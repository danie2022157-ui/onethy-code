import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  GLOBAL_TEMPLATES,
  globalMemoryDirectory,
  projectMemoryDirectory,
  globalMemoryFilename,
  memoryFilename,
  initializeMemoryBank,
  writeMemoryFile,
  readMemoryFile,
  renderGlobalMemory,
  deleteMemoryFile,
} from "@opencode/core/omni-memory-bank"

function withRoots(run: (roots: { global: string; projectA: string; projectB: string }) => void) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onethy-memory-"))
  try {
    run({
      global: path.join(directory, "config"),
      projectA: path.join(directory, "repo-a"),
      projectB: path.join(directory, "repo-b"),
    })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

describe("Onethy global memory across workspaces", () => {
  test("global notes survive sessions and are shared without copying project notes", () =>
    withRoots(({ global, projectA, projectB }) => {
      const shared = globalMemoryDirectory(global)
      const first = projectMemoryDirectory(projectA)
      const second = projectMemoryDirectory(projectB)
      expect(initializeMemoryBank(shared, GLOBAL_TEMPLATES)).toHaveLength(3)
      expect(initializeMemoryBank(shared, GLOBAL_TEMPLATES)).toHaveLength(0)

      writeMemoryFile(shared, "preferences", "Preferir PT-BR e testes automatizados.")
      writeMemoryFile(first, "active-context", "Projeto A: serviço de pagamentos")
      writeMemoryFile(second, "active-context", "Projeto B: editor de mídia")

      const fromA = renderGlobalMemory(global)
      const fromB = renderGlobalMemory(global)
      expect(fromA).toBe(fromB)
      expect(fromA).toContain("PT-BR")
      expect(fromA).not.toContain("serviço de pagamentos")
      expect(fromA).not.toContain("editor de mídia")
      expect(readMemoryFile(second, "active-context")).toContain("Projeto B")
      expect(readMemoryFile(first, "active-context")).toContain("Projeto A")
    }),
  )

  test("global notes can be appended and individually removed", () =>
    withRoots(({ global }) => {
      const dir = globalMemoryDirectory(global)
      initializeMemoryBank(dir, GLOBAL_TEMPLATES)
      writeMemoryFile(dir, "rules", "Exigir aprovação antes de ações sensíveis.")
      writeMemoryFile(dir, "rules", "Executar os testes antes de publicar.", true)
      expect(readMemoryFile(dir, "rules")).toContain("Exigir aprovação")
      expect(readMemoryFile(dir, "rules")).toContain("Executar os testes")
      expect(deleteMemoryFile(dir, "rules")).toBe(true)
      expect(deleteMemoryFile(dir, "rules")).toBe(false)
      expect(renderGlobalMemory(global)).not.toContain("Executar os testes")
    }),
  )

  test("rejects traversal, absolute paths, arbitrary global docs and unsafe names", () => {
    expect(memoryFilename("active-context")).toBe("active-context.md")
    expect(globalMemoryFilename("knowledge")).toBe("knowledge.md")
    for (const name of ["../secrets", "../../outside.md", "C:\\\\temp", "/etc/passwd", ".env", "a/b", "a\\\\b", ""]) {
      expect(() => memoryFilename(name)).toThrow("Invalid memory file name")
    }
    expect(() => globalMemoryFilename("private-client-notes")).toThrow("Unknown global memory document")
  })

  test("bounds loaded context and rejects oversized writes", () =>
    withRoots(({ global }) => {
      const dir = globalMemoryDirectory(global)
      initializeMemoryBank(dir, GLOBAL_TEMPLATES)
      writeMemoryFile(dir, "knowledge", "x".repeat(15_000))
      const context = renderGlobalMemory(global)
      expect(context).toContain("<global_memory>")
      expect(context).toContain("knowledge.md")
      expect(context).not.toContain("x".repeat(12_001))
      expect(() => writeMemoryFile(dir, "knowledge", "x".repeat(100_000))).toThrow("96 KiB")
    }),
  )

  test("does not follow symbolic links masquerading as memory files", () =>
    withRoots(({ global, projectA }) => {
      const dir = globalMemoryDirectory(global)
      fs.mkdirSync(dir, { recursive: true })
      fs.mkdirSync(projectA, { recursive: true })
      const outside = path.join(projectA, "sensitive.txt")
      fs.writeFileSync(outside, "private content")
      try {
        fs.symlinkSync(outside, path.join(dir, "preferences.md"), "file")
      } catch (error) {
        if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") return
        throw error
      }
      expect(readMemoryFile(dir, "preferences")).toBeUndefined()
      expect(renderGlobalMemory(global)).not.toContain("private content")
      expect(() => writeMemoryFile(dir, "preferences", "something")).toThrow("Unsafe memory file")
    }),
  )
})
