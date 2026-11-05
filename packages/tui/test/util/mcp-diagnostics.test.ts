import { test, expect } from "bun:test"
import { mcpFailureHelp, mcpFailurePreview } from "../../src/util/mcp-diagnostics"

test("MCP diagnostic explains a missing executable", () => {
  expect(mcpFailureHelp("spawn uvx ENOENT")).toContain("PATH")
  expect(mcpFailureHelp("'npx' is not recognized")).toContain("npx/uvx")
})

test("MCP diagnostic distinguishes Git root and dependency failures", () => {
  expect(mcpFailureHelp("fatal: not a git repository")).toContain("repositório Git")
  expect(mcpFailureHelp("ModuleNotFoundError: No module named 'markitdown'")).toContain("Python")
  expect(mcpFailureHelp("MCP connect timed out")).toContain("tempo")
})

test("MCP diagnostic retains full failure in the details view instead of the list", () => {
  const preview = mcpFailurePreview("super-long MCP SECRET_CONTENT request failed")
  expect(preview).not.toContain("SECRET_CONTENT")
  expect(preview).toContain("Enter")
})
