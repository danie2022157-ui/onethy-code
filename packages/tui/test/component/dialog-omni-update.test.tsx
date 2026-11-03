/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { DialogOmniUpdate } from "../../src/component/dialog-omni-update"
import { ExitProvider } from "../../src/context/exit"
import { renderLocal } from "../fixture/local"

for (const scenario of ["available", "up-to-date", "network-error"] as const) {
  test(`/update renders the ${scenario} state without invalid text nodes`, async () => {
    await using setup = await renderLocal()
    const git = async (command: string) => {
      const code = scenario === "network-error" && command === "git fetch origin main" ? 1 : 0
      const outputs: Record<string, string> = {
        "git branch --show-current": "main",
        "git rev-parse --short HEAD": "abc123",
        "git log HEAD..origin/main --oneline -n 6":
          scenario === "available" ? "def456 fix(tui): prevent updater crash" : "",
        "git rev-parse --short origin/main": "def456",
        "git log -1 --pretty=%s": "Previous release",
      }
      return { stdout: outputs[command] ?? "", stderr: code ? "GitHub connection failed" : "", code }
    }

    setup.dialog.replace(() => (
      <ExitProvider exit={() => {}}>
        <DialogOmniUpdate git={git} />
      </ExitProvider>
    ))

    const expected =
      scenario === "available"
        ? "New update available!"
        : scenario === "up-to-date"
          ? "Active commit:"
          : "GitHub connection failed"
    await setup.waitForFrame((frame) => frame.includes("OnethyCode Updater") && frame.includes(expected))
    expect(setup.captureCharFrame()).toContain(expected)
  })
}
