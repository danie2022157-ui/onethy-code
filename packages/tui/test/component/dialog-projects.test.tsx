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
    frame.includes("Gerenciar projetos") &&
    frame.includes("Criar novo projeto") &&
    frame.includes("Adicionar pasta existente"),
  )
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Criar novo projeto") && frame.includes("Nome ou caminho"))
  expect(setup.captureCharFrame()).toContain("Criar novo projeto")
})

test("/projects can create a real project folder without deleting files", async () => {
  await using temp = await tmpdir()
  await using setup = await renderLocal()
  const target = path.join(temp.path, "new-app")
  setup.dialog.replace(() => <DialogProjects />)
  await setup.waitForFrame((frame) => frame.includes("Criar novo projeto"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Nome ou caminho"))
  await setup.mockInput.typeText(target)
  setup.mockInput.pressEnter()
  await setup.waitFor(() => fs.existsSync(target))
  expect(fs.statSync(target).isDirectory()).toBe(true)
})
