export * as OmniHealTool from "./omni-heal.js"

import child_process from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Location } from "../../location.js"
import { Permission } from "../../permission.js"
import { Tool } from "../../tool.js"

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
    description: "Maximum test passes, including repairs (1 to 5; default: 3).",
  }),
  autoFix: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Set true to delegate a failing test to @coder, then rerun tests within maxAttempts. Requires existing subagent permissions.",
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
  "Permission-gated test and build diagnosis for coding agents.",
  "Runs tests with shell permission, captures errors and returns repair instructions.",
  "With autoFix=true delegates failed tests to the existing @coder subagent, then reruns to verify; bounded by maxAttempts.",
  "- 'run_and_heal': Runs test suite, verifies results, and if failing, returns actionable healing instructions.",
  "- 'diagnose': Parses compiler or runtime tracebacks into targeted bugfix action items.",
].join("\n")

function detectProjectTestCommand(rootDir: string): string {
  const pkgJsonPath = path.join(rootDir, "package.json")
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"))
      if (pkg.scripts?.typecheck) return "bun run typecheck"
      if (pkg.scripts?.test) return "bun test"
      if (pkg.scripts?.check) return "bun run check"
    } catch {}
  }
  if (fs.existsSync(path.join(rootDir, "tsconfig.json"))) {
    return "npx tsc --noEmit -p tsconfig.json"
  }
  if (fs.existsSync(path.join(rootDir, "Cargo.toml"))) return "cargo test"
  if (fs.existsSync(path.join(rootDir, "pytest.ini")) || fs.existsSync(path.join(rootDir, "pyproject.toml")))
    return "pytest"
  if (fs.existsSync(path.join(rootDir, "go.mod"))) return "go test ./..."
  return "bun test"
}

function optimizeCommandForWorkspace(rawCmd: string, rootDir: string): string {
  const trimmed = rawCmd.trim()
  // Replace slow `npx tsc` with direct local `./node_modules/.bin/tsc` when available so it never hangs or downloads
  if (/^npx\s+tsc\b/i.test(trimmed)) {
    const isWin = process.platform === "win32"
    const localTsc = path.join(rootDir, "node_modules", ".bin", isWin ? "tsc.cmd" : "tsc")
    if (fs.existsSync(localTsc)) {
      const rest = trimmed.replace(/^npx\s+tsc\b/i, "").trim()
      return `& "${localTsc}" ${rest}`.trim()
    }
  }
  return trimmed
}

function buildSubprocessEnv(rootDir: string): NodeJS.ProcessEnv {
  const home = process.env.USERPROFILE || os.homedir()
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
  const sep = process.platform === "win32" ? ";" : ":"
  const extraPaths = [
    path.join(rootDir, "node_modules", ".bin"),
    path.join(localAppData, "omnicode", "bin"),
    path.join(home, ".bun", "bin"),
  ].filter((p) => fs.existsSync(p))
  const currentPath = process.env.PATH || process.env.Path || ""
  return {
    ...process.env,
    PATH: [...extraPaths, currentPath].join(sep),
  }
}

function runCommandAsync(
  commandToRun: string,
  rootDir: string,
  timeoutMs = 120_000,
): Effect.Effect<{ stdout: string; stderr: string; exitCode: number }> {
  return Effect.callback((resume) => {
    const isWin = process.platform === "win32"
    const optimized = isWin ? optimizeCommandForWorkspace(commandToRun, rootDir) : commandToRun
    const shell = isWin ? "powershell.exe" : "bash"
    const args = isWin ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", optimized] : ["-c", optimized]

    let settled = false
    const child = child_process.spawn(shell, args, {
      cwd: rootDir,
      env: buildSubprocessEnv(rootDir),
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {}
      resume(
        Effect.succeed({
          stdout,
          stderr: `${stderr}\n[omni_heal timeout after ${Math.round(timeoutMs / 1000)}s]`.trim(),
          exitCode: 124,
        }),
      )
    }, timeoutMs)

    child.on("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resume(Effect.succeed({ stdout, stderr: `${stderr}\n${String(err)}`.trim(), exitCode: 1 }))
    })

    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resume(Effect.succeed({ stdout, stderr, exitCode: code ?? 0 }))
    })

    return Effect.sync(() => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        try {
          child.kill()
        } catch {}
      }
    })
  })
}

function extractFailureDetails(output: string): string {
  const lines = output.split("\n")
  const relevant: string[] = []
  let capturing = false

  for (const line of lines) {
    if (/error|fail|exception|panic|assert|traceback|undefined|typeerror|TS\d{4}/i.test(line) || capturing) {
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
    const permission = yield* Permission.Service
    const tools = yield* Tool.Service

    yield* ctx.tool
      .transform((editor) => {
        if (process.env.OMNICODE_ACTIVE !== "1") return
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (params, context) =>
            Effect.gen(function* () {
              const rootDir = location.project.directory
              const commandToRun = params.command || detectProjectTestCommand(rootDir)
              if (params.maxAttempts !== undefined &&
                (!Number.isInteger(params.maxAttempts) || params.maxAttempts < 1 || params.maxAttempts > 5)) {
                return yield* new ToolFailure({ message: "maxAttempts must be an integer between 1 and 5." })
              }

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
                yield* permission.assert({
                  action: "shell",
                  resources: [commandToRun],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.messageID, id: context.id },
                }).pipe(Effect.mapError((error) =>
                  new ToolFailure({ message: "Test execution denied by session permissions.", error })))
                const attemptLimit = params.autoFix ? (params.maxAttempts ?? 3) : 1
                let combinedOutput = ""
                let exitCode = 1
                let attempts = 0
                const repairs: string[] = []
                for (let attempt = 1; attempt <= attemptLimit; attempt++) {
                  attempts = attempt
                  const result = yield* runCommandAsync(commandToRun, rootDir, 120_000)
                  exitCode = result.exitCode
                  combinedOutput = (result.stdout + "\n" + result.stderr).trim()
                  if (exitCode === 0) break
                  if (!params.autoFix || attempt === attemptLimit) break
                  const diagnostics = extractFailureDetails(combinedOutput).slice(0, 5000)
                  const snapshot = yield* tools.snapshot()
                  const repairResult = yield* snapshot.execute({
                    sessionID: context.sessionID,
                    agent: context.agent,
                    messageID: context.messageID,
                    call: {
                      type: "tool-call",
                      id: "call_heal_" + crypto.randomUUID(),
                      name: "subagent",
                      input: {
                        agent: "coder",
                        description: "Repair failing test suite",
                        prompt: [
                          "Tests are failing in the current project. Diagnose and fix ONLY the root cause.",
                          "Respect existing project conventions, user permissions and review gates.",
                          "Do not claim success. The parent will rerun the test command.",
                          "Command: " + commandToRun,
                          "Failure output:",
                          diagnostics,
                        ].join("\n"),
                        background: false,
                      },
                    },
                  }).pipe(
                    Effect.catchAll((error) =>
                      Effect.fail(new ToolFailure({
                        message: "Auto-repair subagent could not run. Tests remain failed; review permissions and agent availability.",
                        error,
                      })),
                  ))
                  const workerStatus = repairResult.metadata?.status
                  if (workerStatus !== "completed")
                    return yield* new ToolFailure({
                      message: "Auto-repair worker did not finish; do not mark verification as passed.",
                    })
                  repairs.push("coder completed repair attempt " + attempt)
                }

                if (exitCode === 0) {
                  const summary = "Tests passed after " + attempts + " verification pass(es).\nCommand: " +
                    commandToRun + "\n" + repairs.join("\n") + "\n" + (combinedOutput.slice(-500) || "OK")
                  return {
                    output: {
                      action: "run_and_heal", passed: true, command: commandToRun, summary,
                    },
                    content: summary,
                    metadata: { action: "run_and_heal", passed: true, command: commandToRun, attempts, repairs: repairs.length },
                  }
                }

                const diagnostics = [
                  "=== FAILING TEST OUTPUT ===",
                  extractFailureDetails(combinedOutput),
                  "",
                  "Test verification failed after " + attempts + " pass(es).",
                  "Cause and edit must be reviewed before marking the task complete.",
                  "Apply a fix then run omni_heal again (or set autoFix=true with permissions).",
                ].join("\n")
                const summary = "Tests failed (exit code " + exitCode + ") after " + attempts +
                  " verification pass(es).\nCommand: " + commandToRun
                return {
                  output: { action: "run_and_heal", passed: false, command: commandToRun, summary, diagnostics },
                  content: summary + "\n\n" + diagnostics,
                  metadata: { action: "run_and_heal", passed: false, command: commandToRun, attempts, repairs: repairs.length },
                }
              }

              return yield* new ToolFailure({ message: `Ação '${params.action}' não reconhecida.` })
            }),
        })
      })
      .pipe(Effect.asVoid)
  }),
}
