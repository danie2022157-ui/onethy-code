import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  buildDesktopInvocation, formatDesktopResult, resolveDesktopBinary, runAgentDesktop,
  type DesktopRequest,
} from "../src/agent-desktop"

const request = (action: DesktopRequest["action"], data: Partial<DesktopRequest> = {}): DesktopRequest =>
  ({ action, ...data })

describe("native Agent Desktop bridge", () => {
  test("status checks do not need approval; inspection does", () => {
    expect(buildDesktopInvocation(request("status"))).toMatchObject({
      args: ["status"],
      requiresApproval: false,
    })
    expect(buildDesktopInvocation(request("snapshot", { app: "Notepad" }))).toMatchObject({
      args: ["snapshot", "--app=Notepad", "-i", "--compact"],
      requiresApproval: true,
      resource: "snapshot:Notepad",
    })
    expect(buildDesktopInvocation(request("list-apps")).requiresApproval).toBe(true)
  })

  test("requires explicit app or window scope to avoid inspecting unrelated windows", () => {
    expect(() => buildDesktopInvocation(request("snapshot"))).toThrow("requires app or windowId")
    expect(() => buildDesktopInvocation(request("find", { query: "Save" }))).toThrow("requires app or windowId")
    expect(() => buildDesktopInvocation(request("press", { keys: "ctrl+s" }))).toThrow("requires app or windowId")
    expect(() => buildDesktopInvocation(request("find", { app: "Notepad" }))).toThrow("requires query")
    expect(buildDesktopInvocation(request("find", { app: "Notepad", name: "Save" })).args).toContain("--name=Save")
  })

  test("uses qualified snapshot refs and never embeds typed text in command arguments", () => {
    expect(() => buildDesktopInvocation(request("click", { ref: "@e8" }))).toThrow("qualified ref")
    const text = "private phrase with spaces and ; && | $()"
    const result = buildDesktopInvocation(request("type", { ref: "@s123:e8", text }))
    expect(result.args).toEqual(["type", "@s123:e8", "--stdin"])
    expect(result.stdin).toBe(text)
    expect(JSON.stringify(result.args)).not.toContain(text)
    expect(result.requiresApproval).toBe(true)
    expect(() => buildDesktopInvocation(request("type", { ref: "@s123:e8", text: "a".repeat(10_001) })))
      .toThrow("10,000")
  })

  test("builds headed mouse actions with bounded coordinates and approval", () => {
    expect(buildDesktopInvocation(request("mouse-move", { x: 120, y: 240, headed: true }))).toMatchObject({
      args: ["--headed", "mouse-move", "--xy=120,240"],
      requiresApproval: true,
      resource: "headed:mouse-move:*",
    })
    expect(buildDesktopInvocation(request("mouse-click", { x: 12, y: 34, button: "right", headed: true })).args)
      .toEqual(["--headed", "mouse-click", "--xy=12,34", "--button=right"])
    expect(buildDesktopInvocation(request("drag", { fromX: 1, fromY: 2, toX: 300, toY: 400, headed: true }))).toMatchObject({
      args: ["--headed", "drag", "--from-xy=1,2", "--to-xy=300,400"],
      requiresApproval: true,
      resource: "headed:drag:*",
    })
    expect(buildDesktopInvocation(request("mouse-wheel", { x: 1, y: 2, dy: -3, headed: true })).args)
      .toEqual(["--headed", "mouse-wheel", "--x=1", "--y=2", "--dx=0", "--dy=-3"])
  })

  test("requires complete drag endpoints and validates mouse arguments", () => {
    expect(() => buildDesktopInvocation(request("drag", { fromRef: "@s1:e2", headed: true }))).toThrow("both refs")
    expect(() => buildDesktopInvocation(request("drag", { fromRef: "@s1:e2", toRef: "@s1:e3", fromX: 1, fromY: 2, toX: 3, toY: 4, headed: true }))).toThrow("both refs or both coordinate endpoints")
    expect(() => buildDesktopInvocation(request("mouse-click", { x: 1, y: 2, button: "bad" as "left", headed: true }))).toThrow("button")
    expect(() => buildDesktopInvocation(request("hover", { headed: true }))).toThrow("x must be an integer")
  })

  test("rejects invalid or potentially unbounded parameters before spawning", () => {
    expect(() => buildDesktopInvocation(request("scroll", { ref: "@abc:e2", amount: 100000 })))
      .toThrow("between 1 and 20")
    expect(() => buildDesktopInvocation(request("wait", { waitMs: 10_000 }))).toThrow("between 1 and 5000")
    expect(() => buildDesktopInvocation(request("launch", { app: "" }))).toThrow("app")
    expect(() => buildDesktopInvocation(request("snapshot", { app: "Editor\0Private" }))).toThrow("--app")
    expect(() => buildDesktopInvocation(request("not-a-command" as DesktopRequest["action"]))).toThrow("Unsupported")
  })

  test("finds the installed native executable on Windows instead of executing an npm .cmd shim", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onethy-desktop-"))
    try {
      const executable = path.join(root, "npm", "node_modules", "agent-desktop", "bin", "agent-desktop-win32-x64.exe")
      fs.mkdirSync(path.dirname(executable), { recursive: true })
      fs.writeFileSync(executable, "placeholder executable")
      expect(resolveDesktopBinary({ APPDATA: root, PATH: "" }, "win32", "x64")).toBe(executable)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test("keeps text redacted even if the native tool echoes the entered value", () => {
    const sensitive = "never store typed secrets in tool output"
    const formatted = formatDesktopResult({ ok: true, data: { value: sensitive } }, "type")
    expect(formatted).not.toContain(sensitive)
    expect(formatted).toContain("resnapshot")
  })

  test("executes a bounded JSON CLI process without a shell (no desktop required)", async () => {
    const data = await runAgentDesktop({
      args: ["-e", 'process.stdout.write(JSON.stringify({ok:true,command:"status",data:{platform:"mock"}}))'],
      resource: "status:*",
      requiresApproval: false,
    }, { binary: process.execPath, timeoutMs: 10_000 })
    expect(data.ok).toBe(true)
    expect(data.data).toEqual({ platform: "mock" })
  })

  test("rejects non-JSON process results", async () => {
    await expect(runAgentDesktop({
      args: ["-e", 'process.stdout.write("not JSON")'],
      resource: "status:*",
      requiresApproval: false,
    }, { binary: process.execPath, timeoutMs: 10_000 })).rejects.toThrow("valid JSON")
  })
})
