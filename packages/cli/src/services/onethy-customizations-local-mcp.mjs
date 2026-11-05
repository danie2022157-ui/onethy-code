/**
 * OnethyCode bundled local MCP server templates.
 *
 * All eight servers use local stdio processes, require no provider account,
 * API key or OAuth, and are disabled until the user explicitly enables them.
 * The native MCP transport launches each server with the workspace directory
 * as its cwd; "." therefore refers to the currently opened project.
 *
 * These are launch definitions, not preinstalled binaries. npx/uvx may fetch
 * their packages on first use. Never run installation commands on import.
 */
export const LOCAL_MCP_NAMES = Object.freeze([
  "onethy-playwright",
  "onethy-chrome-devtools",
  "onethy-serena",
  "onethy-filesystem",
  "onethy-git",
  "onethy-memory",
  "onethy-markitdown",
  "onethy-desktop-commander",
])

export function curatedLocalMCPs() {
  const local = (command, args) => ({
    type: "stdio", command, args, disabled: true,
    // First-run package downloads and language-server initialization can be slow.
    timeout: { startup: 120000, catalog: 60000 },
  })
  return JSON.stringify({ mcpServers: {
    "onethy-playwright": local("npx", ["-y", "@playwright/mcp@latest"]),
    "onethy-chrome-devtools": local("npx", ["-y", "chrome-devtools-mcp@latest"]),
    "onethy-serena": local("uvx", [
      "-p", "3.13", "--from", "serena-agent",
      "serena", "start-mcp-server", "--project-from-cwd", "--context", "ide",
      "--open-web-dashboard", "false",
    ]),
    // The filesystem server is confined to the workspace cwd by default.
    "onethy-filesystem": local("npx", ["-y", "@modelcontextprotocol/server-filesystem", "."]),
    // Restrict Git to the workspace repository instead of all local repos.
    "onethy-git": local("uvx", ["mcp-server-git", "--repository", "."]),
    "onethy-memory": local("npx", ["-y", "@modelcontextprotocol/server-memory"]),
    "onethy-markitdown": local("uvx", ["markitdown-mcp"]),
    // Grants broad local process/filesystem access. Never auto-enable.
    "onethy-desktop-commander": local("npx", ["-y", "@wonderwhy-er/desktop-commander@latest"]),
  } }, null, 2) + "\n"
}
