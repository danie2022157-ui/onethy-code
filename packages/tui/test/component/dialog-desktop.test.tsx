/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { renderLocal } from "../fixture/local"
import { DialogDesktop } from "../../src/component/dialog-desktop"
import { DialogDesktopReport } from "../../src/component/dialog-desktop-report"
import { desktopReportRows } from "../../src/component/desktop-report"

test("/desktop exposes native setup and diagnostics without installing anything automatically", async () => {
  await using setup = await renderLocal()
  setup.dialog.replace(() => <DialogDesktop />)
  await setup.waitForFrame((frame) =>
    frame.includes("Agent Desktop") &&
    frame.includes("Check native runtime status") &&
    frame.includes("Install native runtime"),
  )
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) =>
    frame.includes("Install Agent Desktop locally?") &&
    frame.includes("Cancel") &&
    frame.includes("Yes, install") &&
    frame.includes("globally with npm"),
  )
  // Cancel is the default. A single Enter must never trigger an npm install.
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Check native runtime status"))
  expect(setup.captureCharFrame()).toContain("Agent Desktop")
})


test("Agent Desktop runtime and permission reports have visible diagnostic rows", async () => {
  await using setup = await renderLocal()
  setup.dialog.replace(() => (
    <DialogDesktopReport title="Agent Desktop — OS permissions" rows={desktopReportRows({
      ok: true, data: { accessibility: { state: "granted" }, screen_recording: { state: "denied" } },
    })} />
  ))
  await setup.waitForFrame((frame) => frame.includes("Accessibility / State") && frame.includes("granted") &&
    frame.includes("Screen Recording / State") && frame.includes("denied"))
  expect(setup.captureCharFrame()).toContain("Back (Esc)")
})

test("desktop report handles unavailable data without inventing permission state", () => {
  const rows = desktopReportRows({ ok: true })
  expect(rows).toEqual([
    expect.objectContaining({ label: "Native runtime", value: "Connected" }),
    expect.objectContaining({ label: "Report", value: "No detailed data returned" }),
  ])
  const oversized = Object.fromEntries(Array.from({ length: 70 }, (_, index) => ["field_" + index, "x".repeat(500)]))
  const limited = desktopReportRows({ ok: true, data: oversized })
  expect(limited.length).toBeLessThanOrEqual(40)
  expect(limited.every((item) => item.value.length <= 281)).toBe(true)
})
