import { describe, expect, test } from "bun:test"
import { McpClient } from "../src/mcp/client"

describe("MCP local command resolution", () => {
  test("uses Windows package-manager shims for canonical MCP config", () => {
    for (const executable of ["npx", "npm", "pnpm", "yarn"])
      expect(McpClient.windowsMcpCommand(executable, "win32")).toBe(executable + ".cmd")
  })

  test("does not change explicit executables, paths or non-Windows commands", () => {
    expect(McpClient.windowsMcpCommand("npx.cmd", "win32")).toBe("npx.cmd")
    expect(McpClient.windowsMcpCommand("C:\\tools\\npx.cmd", "win32")).toBe("C:\\tools\\npx.cmd")
    expect(McpClient.windowsMcpCommand("uvx", "win32")).toBe("uvx")
    expect(McpClient.windowsMcpCommand("npx", "linux")).toBe("npx")
  })
})
