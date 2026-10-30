export * as OmniHealTool from "./omni-heal.js"

import child_process from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Location } from "../../location.js"

export const name = "omni_heal"

export const Input = Schema.Struct({
  action: Schema.Literals(["run_and_heal", "diagnose"]).annotate({
    description:
      "Action: 'run_and_heal' executes the test/check command and diagnoses failures; 'diagnose' analyzes an existing error log.",
  }),
  command: Schema.optionalKey(Schema.String).annotate({
    description: "Custom test or typecheck command to execute. If omitted, detects project runner automatically.",
  }),
  maxAttempts: Schema.optionalKey(Schema.Number).annotate({
    description: "Maximum healing iterations to attempt (default: 3).",
  }),
  errorLog: Schema.optionalKey(Schema.String).annotate({
    description: "Raw error log text to diagnose when action is 'diagnose'.",
  }),
})

export const Output = Schema.Struct({
  action: Schema.String,
  passed: Schema.Boolean,
  command: Schema.String,
  summary: Schema.String,
  diagnostics: Schema.optionalKey(Schema.String),
})

export const description = [
  "Self-Healing Autonomous Test & Build Loop (Claude Code / Ralph loop pattern).",
  "Executes test suites or typechecks, captures error outputs, isolates failing files and assertion traces, and formulates step-by-step healing plans for @coder.",
  "- 'run_and_heal': Runs test suite, verifies results, and if failing, returns actionable healing instructions.",
  "- 'diagnose': Parses compiler or runtime tracebacks into targeted bugfix action items.",
].join("\n")

function detectProjectTestCommand(rootDir: string): string {
  const pkgJsonPath = path.join(rootDir, "package.json")
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"))
      if (pkg.scripts?.test) return "bun test"
      if (pkg.scripts?.typecheck) return "bun run typecheck"
      if (pkg.scripts?.check) return "bun run check"
    } catch {}
  }
  if (fs.existsSync(path.join(rootDir, "Cargo.toml"))) return "cargo test"
  if (fs.existsSync(path.join(rootDir, "pytest.ini")) || fs.existsSync(path.join(rootDir, "pyproject.toml")))
    return "pytest"
  if (fs.existsSync(path.join(rootDir, "go.mod"))) return "go test ./..."
  return "bun test"
}

function extractFailureDetails(output: string): string {
  const lines = output.split("\n")
  const relevant: string[] = []
  let capturing = false

  for (const line of lines) {
    if (/error|fail|exception|panic|assert|traceback|undefined|typeerror/i.test(line) || capturing) {
      relevant.push(line)
      if (relevant.length > 50) break
    }
  }

  return relevant.length > 0 ? relevant.join("\n") : output.slice(0, 2000)
}

export const Plugin = {
  id: "opencode.tool.omni_heal",
  effect: Effect.fn("OmniHealTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service

    yield* ctx.tool
      .transform((editor) => {
        if (process.env.OMNICODE_ACTIVE !== "1") return
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (params) =>
            Effect.gen(function* () {
              const rootDir = location.project.directory
              const commandToRun = params.command || detectProjectTestCommand(rootDir)

              if (params.action === "diagnose") {
                const raw = params.errorLog || ""
                const diag = extractFailureDetails(raw)
                const summary = "Diagnóstico de erro gerado para @coder."
                const diagnostics = `[FALHAS IDENTIFICADAS]\n${diag}\n\n[INSTRUÇÃO PARA @CODER]\n1. Inspecione os arquivos e linhas apontados no traceback.\n2. Faça a correção mínima necessária sem quebrar compatibilidade.\n3. Re-execute 'omni_heal' para verificar se os testes passaram.`
                return {
                  output: {
                    action: "diagnose",
                    passed: false,
                    command: "diagnose",
                    summary,
                    diagnostics,
                  },
                  content: `${summary}\n\n${diagnostics}`,
                  metadata: { action: "diagnose", passed: false },
                }
              }

              if (params.action === "run_and_heal") {
                let stdout = ""
                let stderr = ""
                let exitCode = 0

                try {
                  const isWin = process.platform === "win32"
                  const shell = isWin ? "powershell" : "bash"
                  const flag = isWin ? "-Command" : "-c"
                  const res = child_process.spawnSync(shell, [flag, commandToRun], {
                    cwd: rootDir,
                    encoding: "utf-8",
                    timeout: 90000,
                  })
                  stdout = res.stdout || ""
                  stderr = res.stderr || ""
                  exitCode = res.status ?? 0
                } catch (e: any) {
                  exitCode = 1
                  stderr = String(e)
                }

                const combinedOutput = `${stdout}\n${stderr}`.trim()

                if (exitCode === 0) {
                  const summary = `✅ SUCESSO: Todos os testes e validações passaram limpos!\nComando: ${commandToRun}\n\nSaída:\n${combinedOutput.slice(-500) || "OK"}`
                  return {
                    output: {
                      action: "run_and_heal",
                      passed: true,
                      command: commandToRun,
                      summary,
                    },
                    content: summary,
                    metadata: { action: "run_and_heal", passed: true, command: commandToRun },
                  }
                }

                const diag = extractFailureDetails(combinedOutput)
                const summary = `❌ FALHA DETECTADA (Exit code ${exitCode}):\nComando: ${commandToRun}\n\nIniciando ciclo de autocura (Self-Healing Loop)...`
                const diagnostics = [
                  "=== TRACEBACK DE FALHA ===",
                  diag,
                  "",
                  "=== PLANO DE AUTOCURA PARA @CODER ===",
                  "1. Identifique a causa raiz nos arquivos apontados pelo traceback acima.",
                  "2. Aplique a correção nos arquivos afetados.",
                  "3. Re-execute 'omni_heal' para testar novamente até atingir 100% verde.",
                ].join("\n")

                return {
                  output: {
                    action: "run_and_heal",
                    passed: false,
                    command: commandToRun,
                    summary,
                    diagnostics,
                  },
                  content: `${summary}\n\n${diagnostics}`,
                  metadata: { action: "run_and_heal", passed: false, command: commandToRun },
                }
              }

              return yield* new ToolFailure({ message: `Ação '${params.action}' não reconhecida.` })
            }),
        })
      })
      .pipe(Effect.asVoid)
  }),
}
