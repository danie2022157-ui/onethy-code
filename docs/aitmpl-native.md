# AITmpl → OnethyCode

The optional importer in `script/aitmpl-sync.mjs` downloads the current open-source AITmpl catalog and copies compatible file-based customizations to OnethyCode's native OpenCode configuration directories. It does **not** install Claude Code or execute downloaded code.

## Usage

From the root of an OnethyCode project (Node.js and Git required):

```sh
node script/aitmpl-sync.mjs
node script/aitmpl-sync.mjs --install
node script/aitmpl-sync.mjs --install --type skills
node script/aitmpl-sync.mjs --install --global
```

Without `--install`, the script only previews counts. By default it installs to `.opencode/`; `--global` targets `~/.config/opencode/`. Existing files are never overwritten. The script removes its temporary catalog clone after completion.

## Compatibility boundary

| Catalog type | Import status |
| --- | --- |
| Skills | Files copied into native `skills/` directory; dependencies and runtime requirements are not automatically provisioned |
| Agents | Markdown definitions copied to native `agents/` directory; compatibility of Claude-only frontmatter must be checked |
| Slash commands | Markdown definitions copied to native `commands/` directory; Claude-specific tooling references may require adaptation |
| Settings | Not installed: requires schema-aware translation and merging |
| Hooks | Not installed: requires hook-event adapter and explicit execution permissions |
| MCP | Not installed: requires schema translation, credentials, connectivity checks and authorization |
| Plugins/mods/loops | Not installed: may rely on Claude Code runtime internals and cannot safely be treated as native |

**This is an initial import mechanism, not proof that every catalog component runs correctly.** Run `onethy mcp doctor` for configured MCPs and validate imported prompts before enabling them. No credentials or provider connections are included.

Source: https://github.com/davila7/claude-code-templates
