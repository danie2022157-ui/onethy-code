/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { renderLocal } from "../fixture/local"
import { DialogDesktop } from "../../src/component/dialog-desktop"

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
    frame.includes("Yes, install"),
  )
  // Cancel is the default. A single Enter must never trigger an npm install.
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Check native runtime status"))
  expect(setup.captureCharFrame()).toContain("Agent Desktop")
})
