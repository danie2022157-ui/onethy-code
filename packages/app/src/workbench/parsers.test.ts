import { describe, expect, test } from "bun:test"
import { parseVimgrepOutput } from "./panels/search-panel"
import { parseGitPorcelain } from "./panels/git-panel"
import { parseDiagnosticOutput } from "./bottom/problems-tab"

describe("workbench pure parsers", () => {
  test("parseVimgrepOutput parses standard and Windows paths with line/col", () => {
    const raw = [
      "src/app.ts:12:5:const value = 42",
      "packages/app/src/shell/shell.tsx:104:9:return <ActivityBar />",
      "README.md:3:1:Onethy Code IDE",
    ].join("\n")

    const parsed = parseVimgrepOutput(raw)
    expect(parsed.length).toBe(3)
    expect(parsed[0]).toMatchObject({ file: "src/app.ts", line: 12, column: 5, text: "const value = 42" })
    expect(parsed[1]).toMatchObject({ file: "packages/app/src/shell/shell.tsx", line: 104, column: 9 })
  })

  test("parseGitPorcelain splits staged, working, and untracked files accurately", () => {
    const raw = [
      "M  packages/app/src/shell/shell.tsx",
      " M packages/app/src/workbench/state.tsx",
      "MM packages/ui/src/theme/context.tsx",
      "A  packages/ui/src/theme/themes/onethy.json",
      "?? packages/app/src/workbench/icons.tsx",
    ].join("\n")

    const parsed = parseGitPorcelain(raw)
    expect(parsed.staged.map((item) => item.path)).toEqual([
      "packages/app/src/shell/shell.tsx",
      "packages/ui/src/theme/context.tsx",
      "packages/ui/src/theme/themes/onethy.json",
    ])
    expect(parsed.unstaged.map((item) => item.path)).toEqual([
      "packages/app/src/workbench/state.tsx",
      "packages/ui/src/theme/context.tsx",
      "packages/app/src/workbench/icons.tsx",
    ])
  })

  test("parseDiagnosticOutput parses tsc and bun check diagnostics", () => {
    const raw = [
      "src/workbench/state.tsx(42,10): error TS2345: Argument of type 'string' is not assignable.",
      "src/workbench/sidebar.tsx:18:5 - warning TS6133: Unused variable.",
    ].join("\n")

    const diagnostics = parseDiagnosticOutput(raw)
    expect(diagnostics.length).toBe(2)
    expect(diagnostics[0]).toMatchObject({
      severity: "error",
      file: "src/workbench/state.tsx",
      line: 42,
      column: 10,
    })
    expect(diagnostics[1]).toMatchObject({
      severity: "warning",
      file: "src/workbench/sidebar.tsx",
      line: 18,
      column: 5,
    })
  })
})
