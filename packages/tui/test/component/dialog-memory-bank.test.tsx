/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { renderLocal } from "../fixture/local"
import { tmpdir } from "../fixture/fixture"
import { DialogMemoryBank } from "../../src/component/dialog-memory-bank"

test("memory manager can switch to global scope and initialize its own documents", async () => {
  await using temp = await tmpdir()
  await using setup = await renderLocal()
  const project = path.join(temp.path, "project")
  const config = path.join(temp.path, "config")
  fs.mkdirSync(project)
  fs.mkdirSync(config)

  setup.dialog.replace(() => <DialogMemoryBank projectDir={project} configDir={config} />)
  await setup.waitForFrame((frame) => frame.includes("Onethy Memory") && frame.includes("Switch to GLOBAL memory"))
  expect(setup.captureCharFrame()).toContain("active-context.md")

  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Switch to PROJECT memory"))
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()

  await setup.waitFor(() => fs.existsSync(path.join(config, "memory-bank", "preferences.md")))
  expect(fs.existsSync(path.join(config, "memory-bank", "rules.md"))).toBe(true)
  expect(fs.existsSync(path.join(config, "memory-bank", "knowledge.md"))).toBe(true)
  expect(fs.existsSync(path.join(project, ".omnicode", "memory-bank", "active-context.md"))).toBe(false)
})

test("memory manager initializes and labels project notes separately from global memory", async () => {
  await using temp = await tmpdir()
  await using setup = await renderLocal()
  const project = path.join(temp.path, "workspace")
  const config = path.join(temp.path, "config")
  fs.mkdirSync(project)
  fs.mkdirSync(config)

  setup.dialog.replace(() => <DialogMemoryBank projectDir={project} configDir={config} />)
  await setup.waitForFrame((frame) => frame.includes("Onethy Memory") && frame.includes("active-context.md"))
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => fs.existsSync(path.join(project, ".omnicode", "memory.md")))
  expect(fs.existsSync(path.join(project, ".omnicode", "memory-bank", "active-context.md"))).toBe(true)
  expect(fs.existsSync(path.join(config, "memory-bank", "preferences.md"))).toBe(false)
})


test("memory manager requires confirmation and never clears the other scope", async () => {
  await using temp = await tmpdir()
  await using setup = await renderLocal()
  const project = path.join(temp.path, "workspace")
  const config = path.join(temp.path, "config")
  fs.mkdirSync(project)
  fs.mkdirSync(config)
  const projectNotes = path.join(project, ".omnicode", "memory.md")
  fs.mkdirSync(path.dirname(projectNotes), { recursive: true })
  fs.writeFileSync(projectNotes, "Projeto privado")

  setup.dialog.replace(() => <DialogMemoryBank projectDir={project} configDir={config} />)
  await setup.waitForFrame((frame) => frame.includes("Switch to GLOBAL memory"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Switch to PROJECT memory"))
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  const globalFile = path.join(config, "memory-bank", "preferences.md")
  await setup.waitFor(() => fs.existsSync(globalFile))

  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Confirm deletion"))
  // Cancel is selected by default: an accidental Enter must NOT delete memories.
  setup.mockInput.pressEnter()
  expect(fs.existsSync(globalFile)).toBe(true)

  expect(fs.readFileSync(projectNotes, "utf8")).toBe("Projeto privado")
})

test("confirmed global clear removes only global memory", async () => {
  await using temp = await tmpdir()
  await using setup = await renderLocal()
  const project = path.join(temp.path, "workspace")
  const config = path.join(temp.path, "config")
  fs.mkdirSync(project)
  fs.mkdirSync(config)
  const notes = path.join(project, ".omnicode", "memory.md")
  fs.mkdirSync(path.dirname(notes), { recursive: true })
  fs.writeFileSync(notes, "Não apagar notas de projeto")

  setup.dialog.replace(() => <DialogMemoryBank projectDir={project} configDir={config} />)
  await setup.waitForFrame((frame) => frame.includes("Switch to GLOBAL memory"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Switch to PROJECT memory"))
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  const globalFile = path.join(config, "memory-bank", "preferences.md")
  await setup.waitFor(() => fs.existsSync(globalFile))

  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Confirm deletion"))
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => !fs.existsSync(globalFile))
  expect(fs.readFileSync(notes, "utf8")).toBe("Não apagar notas de projeto")
})
