export function curatedLocalMCPs() {
  return JSON.stringify({ mcpServers: {
    "onethy-browser": { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"], disabled: true },
    "onethy-sequential-thinking": { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"], disabled: true },
    "onethy-time": { type: "stdio", command: "uvx", args: ["mcp-server-time"], disabled: true },
  } }, null, 2) + "\n"
}
