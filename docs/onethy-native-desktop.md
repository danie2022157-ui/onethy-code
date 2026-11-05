# Native Agent Desktop integration

OnethyCode includes a first-party `desktop_control` tool backed by [Vercel Labs Agent Desktop](https://github.com/vercel-labs/agent-desktop) (Apache-2.0). It is **not** an MCP server, browser extension, VS Code extension, or remote provider.

The integration uses the upstream native accessibility binary for **Windows**, **macOS**, and **Linux**. This preserves the upstream OS adapters instead of trying to reimplement their accessibility and UI automation logic in TypeScript.

## Setup in the TUI

Open `/desktop`, select **Native Desktop** on the OnethyCode Home screen, click the `/desktop Computer Use` quick action, or select **Manage desktop computer use** in the main command palette (`Ctrl+P`). The manager has English-language actions to:

- Check the native runtime status.
- Check accessibility permissions.
- Install the pinned `agent-desktop@1.2.0` local runtime, after an explicit confirmation.
- Read usage guidance.

The TUI installer invokes the official npm package. Its upstream installer fetches platform-specific binaries from GitHub Releases and validates checksums. If this installation is not possible (for example, npm is missing or the global package directory is not writable), install the upstream runtime manually and run the status check again. The integration does not attempt to silently install dependencies when an agent invokes a tool.

## Agents and permissions

The native tool is registered for OnethyCode sessions, including delegated agents. It offers scoped app discovery and accessibility snapshots, element queries and qualified-reference actions, keyboard input, app/window management, and waits.

Example conversational request: "Inspect the running Notepad window, type my note, and verify it was saved." The agent can use the `desktop_control` tool:

1. `action: "status"` to detect runtime/permissions.
2. `action: "list-windows"` and then `action: "snapshot", app: "Notepad"`.
3. `action: "click", ref: "@snapshot-id:e8"` using a ref actually returned by the snapshot.
4. `action: "type", ref: "@snapshot-id:e8", text: "Hello"`.
5. A new `snapshot` to verify the result.

Refs are qualified by snapshot and may become stale. Never guess a ref or retry a mutating operation blindly.

**Session permissions apply:** every desktop inspection or action (apart from the non-invasive health/version/permission checks) goes through the existing OnethyCode permission system. The integration does not grant unattended agents hidden access to apps. Agent Desktop itself requires the relevant OS accessibility permissions.

Text entered through `type` and `set-value` is delivered through stdin, not command-line arguments. Tool outputs redact typed text. CLI stdout is capped and is not logged by the integration. Desktop snapshots may still expose sensitive content; only inspect apps explicitly authorized by the user. The public Git repository, CI and chat transcripts should never contain captured private desktop information.

## Where commands run

**The tool controls the machine on which the OnethyCode backend process runs.** A remote server or container does not automatically gain access to your local Windows desktop; an unattended/headless environment may have no GUI accessibility session. For a Windows app, run OnethyCode on Windows with the native Windows Agent Desktop runtime rather than inside a Linux WSL session.

There is no model, API key, or hosted desktop service bundled with Agent Desktop. It is a native operating-system bridge used by the already-configured OnethyCode agents.

Environment override: set `ONETHY_AGENT_DESKTOP_BIN` to the trusted absolute path of an Agent Desktop native executable if it is not on the default system path.

## Supported tool actions

Read/status: `status`, `permissions`, `version`, `list-apps`, `list-windows`, `list-displays`, `list-surfaces`, `snapshot`, `find`, `get`, `is`.

Operate: `click`, `double-click`, `right-click`, `type`, `set-value`, `clear`, `focus`, `select`, `toggle`, `check`, `uncheck`, `expand`, `collapse`, `scroll`, `scroll-to`, `press`, `focus-window`, `launch`, `close-app`, `minimize`, `maximize`, `restore`, `wait`.

Some advanced upstream commands, including screenshots, clipboard reads and raw coordinate actions, are intentionally not exposed in this first-party tool. Users who need them can assess the upstream tool's security implications separately.

## Limitations

- The first-party integration is native to OnethyCode, but the third-party **OS runtime must be installed locally**. Adding this source code alone does not install the Rust binary on a user's computer.
- Agent Desktop may not expose every control in every application; its OS permissions and application accessibility implementations determine coverage.
- GitHub CI tests the bridge, schema and permission registration. It cannot prove interaction with a real user desktop; that requires manual on-device verification.
