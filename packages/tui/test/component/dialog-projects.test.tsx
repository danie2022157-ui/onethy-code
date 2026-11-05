/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { DialogProjects } from "../../src/component/dialog-projects"
import { renderLocal } from "../fixture/local"
import { tmpdir } from "../fixture/fixture"

test("/projects renders project-management actions and opens the create form", async () => {
  await using setup = await renderLocal()
  setup.dialog.replace(() => <DialogProjects />)
  await setup.waitForFrame((frame) =>
    frame.includes("Manage projects") &&
    frame.includes("Create new project") &&
    frame.includes("Add existing folder"),
  )
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Create new project") && frame.includes("New folder name or path"))
  expect(setup.captureCharFrame()).toContain("Create new project")
})

test("/projects can create a real project folder without deleting files", async () => {
  await using temp = await tmpdir()
  await using setup = await renderLocal()
  const target = path.join(temp.path, "new-app")
  setup.dialog.replace(() => <DialogProjects />)
  await setup.waitForFrame((frame) => frame.includes("Create new project"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("New folder name or path"))
  await setup.mockInput.typeText(target)
  setup.mockInput.pressEnter()
  await setup.waitFor(() => fs.existsSync(target))
  expect(fs.statSync(target).isDirectory()).toBe(true)
})

test("/projects imports a File Explorer path with quotes and spaces without nesting it in the CLI cwd", async () => {
  await using temp = await tmpdir()
  await using setup = await renderLocal()
  const target = path.join(temp.path, "REMOTION VIDEO CRIA")
  fs.mkdirSync(target)

  setup.dialog.replace(() => <DialogProjects />)
  await setup.waitForFrame((frame) => frame.includes("Add existing folder"))
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) =>
    frame.includes("Add existing project") && frame.includes("quotes and spaces are supported"),
  )
  await setup.mockInput.typeText('"' + target + '"')
  setup.mockInput.pressEnter()
  await setup.waitFor(() =>
    setup.route.data.type === "home" && setup.route.data.location?.directory === target,
  )
  expect(fs.statSync(target).isDirectory()).toBe(true)
})
