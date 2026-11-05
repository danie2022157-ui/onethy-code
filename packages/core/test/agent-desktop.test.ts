import { describe, expect, test } from "bun:test"
import {
  buildDesktopInvocation, formatDesktopResult, runAgentDesktop,
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

  test("rejects invalid or potentially unbounded parameters before spawning", () => {
    expect(() => buildDesktopInvocation(request("scroll", { ref: "@abc:e2", amount: 100000 })))
      .toThrow("between 1 and 20")
    expect(() => buildDesktopInvocation(request("wait", { waitMs: 10_000 }))).toThrow("between 1 and 5000")
    expect(() => buildDesktopInvocation(request("launch", { app: "" }))).toThrow("app")
    expect(() => buildDesktopInvocation(request("snapshot", { app: "Editor\0Private" }))).toThrow("--app")
    expect(() => buildDesktopInvocation(request("not-a-command" as DesktopRequest["action"]))).toThrow("Unsupported")
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
