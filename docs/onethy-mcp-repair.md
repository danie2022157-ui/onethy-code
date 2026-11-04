# MCP recovery in OnethyCode (terminal)

OnethyCode discovers MCP servers from its normal project/global `onethy.json` / `omnicode.json` / `opencode.json` configs. With Onethy mode active, it also discovers MCP manifests in `mcp/`, `mcps/`, `mcp.json`, `.mcp.json`, `.cursor/mcp.json` and `.vscode/mcp.json`.

## Diagnose and repair

```powershell
onethy mcp list
onethy mcp repair
onethy mcp repair --all
```

- `mcp list`: inspect statuses and errors for the active project.
- `mcp repair`: retry servers that report `failed` (not servers that were deliberately disabled).
- `mcp repair --all`: **explicitly opt in** to attempting connections for disabled servers too. This affects the current server session only; use project configuration for startup persistence.
- `mcp auth <name>`: complete an OAuth login for a server that reports `needs_auth`. Never paste tokens into chat or Git.
- `mcp add <name> --url https://example.com/mcp`: add a remote MCP; use `mcp add <name> -- <command ...>` for a local stdio MCP. Set `--global` when it is meant to be shared across projects.

## Permanently enable discovered MCPs

Manifests imported from other IDEs are kept disabled by default for security. Explicitly approve a particular server in a trusted `onethy.json`:

```json
{
  "mcp": {
    "enabled": {
      "my-imported-server": true
    }
  }
}
```

The same flag works using `mcp.my-imported-server.enabled` or `mcp.servers.my-imported-server.enabled`. An enable-only entry will never create a server that has not been configured or discovered, and does not bypass the server's authentication.

For a fully declared server (not merely an imported one), use the canonical format:

```json
{
  "mcp": {
    "servers": {
      "my-service": {
        "type": "remote",
        "url": "https://example.com/mcp",
        "enabled": true
      }
    }
  }
}
```

`disabled: true` also remains supported and takes priority over `enabled: true` when both appear on the same server.

## If a connection still fails

| Status | Meaning | Next step |
| --- | --- | --- |
| `connected` | Server initialized and tools were listed successfully | Ready to use |
| `failed` | Executable, network, protocol or tool-catalog error | Inspect the full message with `onethy mcp list` and retry after fixing the cause |
| `needs_auth` | Server requires provider sign-in | `onethy mcp auth <name>` |
| `disabled` | Deactivated, including newly imported external manifests | Explicitly approve in config or use `mcp repair --all` |
| `pending` | Startup is still in progress | Recheck after startup finishes |

A repair command cannot manufacture provider credentials, install an unavailable runtime, bypass network/firewall restrictions, or guarantee that an external server is online.

**Windows:** Confirm local MCP executables such as `node`, `npx`, `bun` and any server-specific command are installed and available on the execution environment's PATH. If `mcp list` reports a process spawn error, use the actual command path or correct the installed runtime; do not place API keys directly in committed files.
