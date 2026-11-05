# AITmpl personalizations for OnethyCode

This integration imports file-based customizations from the public [AITmpl catalog](https://github.com/davila7/claude-code-templates) into native OnethyCode / OpenCode customization folders. It does not require Claude Code and does not execute content during installation.

## Commands

From the repository root (Node.js 22+ and Git):

```bash
# Preview everything
node script/aitmpl-sync.mjs

# Install compatible skills, agents and slash commands in this project
node script/aitmpl-sync.mjs --install

# Install compatible components globally
node script/aitmpl-sync.mjs --install --global

# Restrict import to a specific category
node script/aitmpl-sync.mjs --install --type skills

# Offline testing/inventory of an existing local catalog checkout
node script/aitmpl-sync.mjs --source-dir /path/to/claude-code-templates
```

Files are placed in `.opencode/skills/`, `.opencode/agents/`, and `.opencode/commands/` respectively, or in `~/.config/opencode/` with `--global`. Category-prefixed names avoid collisions. Existing files are never overwritten. Agent tool names are converted for a small known set of OpenCode equivalents, and warnings flag references that need review.

## What works and what remains

| Type | Status |
| --- | --- |
| Skills | Imported as native skill directories with assets and normalized `name` fields. Skill-specific dependencies still need installation and validation. |
| Agents | Imported as Markdown, known Claude tool names mapped to OpenCode tool names. Unknown tools and Claude-specific instructions need review. |
| Commands | Imported as category-prefixed native Markdown slash commands. Claude-exclusive references need review. |
| Settings, hooks, MCPs, plugins, mods, loops | Inventoried only; **not** installed, registered or executed. Their runtime behavior cannot be asserted compatible with OnethyCode. |

Never insert API keys into the catalog or commit them into the repository. External MCP servers still require a correct OnethyCode configuration, credentials, user authorization and live health checks.

## Test and CI

```sh
node --check script/aitmpl-sync.mjs
node --test script/aitmpl-sync.test.mjs
```

The isolated fixture test checks preview behavior, install, conversion of known agent tool names, idempotence and refusal to execute a catalog hook. GitHub Actions runs this test when the importer changes. Passing it **does not verify** that every catalog component is operational on Windows or connected to external services.
