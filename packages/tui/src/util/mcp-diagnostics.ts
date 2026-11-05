/**
 * Short, actionable guidance for local MCP failures. The actual transport error
 * remains available via Enter -> full error details.
 */
export function mcpFailureHelp(error: string): string {
  const text = error.toLowerCase()
  if (/enoent|executable not found|command not found|is not recognized|failed to spawn|spawn .*not found/.test(text)) {
    return "Local command not found. Check that npx/uvx is on PATH and restart OnethyCode after installation."
  }
  if (/not a git repository|no git repository|not inside a git work tree/.test(text)) {
    return "Open OnethyCode inside a Git repository; the Git MCP uses the current project directory."
  }
  if (/no module named|modulenotfounderror|python.*not found/.test(text)) {
    return "Python dependency missing. Check uvx and the server's initial setup."
  }
  if (/npm err|404 not found|package.*not found/.test(text)) {
    return "MCP package unavailable. Check the package name, internet connection and npm cache."
  }
  if (/timed? out|timeout|deadline exceeded/.test(text)) {
    return "Startup timed out. Check network access, dependencies and runtime logs."
  }
  if (/permission denied|eacces|eperm/.test(text)) {
    return "Access denied by the operating system. Check file and executable permissions."
  }
  return "Startup failed. Press Enter to view and copy the complete error."
}

export function mcpFailurePreview(error: string): string {
  const reason = mcpFailureHelp(error)
  return reason + "  [Enter: detalhes]"
}
