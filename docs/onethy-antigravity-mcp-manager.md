# OnethyCode native Antigravity Auth + MCP lifecycle

## Built-in Antigravity Auth

The [CortexKit Antigravity Auth](https://github.com/cortexkit/antigravity-auth) package is now a **native, first-party-managed plugin source** in OnethyCode, loaded automatically in OnethyCode sessions without modifying `opencode.json` by hand.

- OnethyCode loads `@cortexkit/opencode-antigravity-auth@^3.0.30` through its normal OpenCode 2 plugin host, including the upstream server and TUI entrypoints. It does **not** copy the upstream source tree or fork authentication logic.
- The upstream `/antigravity` menu, account and quota features are provided by that plugin when successfully installed and activated on a compatible host.
- The package's own login still requires **your explicit Google authorization**; no account is added and no credentials are stored by this native registration itself.
- Reuse the usual OpenCode 2 **Auth login → Google → Google (antigravity-auth pool, browser)** method and choose the **Antigravity** saved connection. If the method is absent, inspect plugin status rather than substituting a Google API key.
- Existing 2.x credential stores may require **offline migration**, which is deliberately not automated. Quit running OpenCode/Antigravity hosts and follow [upstream migration steps](https://github.com/cortexkit/antigravity-auth/blob/main/packages/opencode/docs/MIGRATION.md).
- Disable the native integration if needed with `ONETHY_ANTIGRAVITY_AUTH=0`; or add a project plugin removal operation `-@cortexkit/opencode-antigravity-auth`. Existing manual registrations for the same package take precedence.

### Automatic updates

OnethyCode checks plugin versions every 24 hours during a running host lifecycle. For this specific native plugin, it automatically downloads newer **compatible 3.x versions** and reloads the plugin through the host's standard generation-based update handling. Installation uses a staged npm generation and retains prior generations in case a reload fails. Restart OnethyCode if a loaded plugin version remains unchanged.

**Major versions are held intentionally.** The version specifier `^3.0.30` will not pull 4.x. Such releases may require an offline account migration, and automatically applying them could make the account store unreadable. Updates are not checked while OnethyCode is closed, network connectivity is required, and an unsuccessful update preserves the installed version.

**Security and provider terms:** The upstream repository explicitly warns that using Antigravity Auth in this manner violates Google's Terms of Service and may cause account bans/suspensions. It is not endorsed by Google. OnethyCode does not bypass login prompts, modify provider authentication safeguards, or upload your OAuth secrets to GitHub. Using the native integration is a conscious choice with this risk. For terms-compliant access, use officially supported provider integrations.

## Native MCP Connection Manager improvements

In OnethyCode mode, configured MCP servers continue to start asynchronously and share their connection **per project/location**, not per tab. The following runtime management policies are now built in:

| Policy | Behavior |
| --- | --- |
| Initial connect | Starts configured, enabled MCPs asynchronously |
| Reconnect | Up to six bounded automatic retries for failed connections, exponential backoff 5 seconds to 5 minutes; never retries a server requiring authentication |
| Health checks | Checks idle connected servers' tool catalogs every three minutes (5-second timeout); only marks failed after two unsuccessful probes |
| Idle resources | After 30 minutes without activity, a server with no active tool calls enters **Standby** and its process/transport is closed |
| On-demand wake | Tool calls, prompts, and resource operations restart standby servers before use |
| Connection reuse | Location-scoped pool is reused for calls from multiple sessions; no per-session subprocess explosion |
| Permission boundary | Existing OnethyCode tool permissions remain in effect. A shared connection is **not** a process/credential isolation boundary |

Standby retains only previously discovered tool definitions, preserving agent discoverability. It does not keep processes running. Background maintenance does **not** close client-attached MCP transports owned by a different application.

The `/mcps` view displays `Standby · connects on use` when applicable. The existing Connect/Disconnect controls remain available. Disabling an MCP explicitly prevents reconnection. For robust separation of work and filesystem edits, use separate worktrees/locations; MCP server credentials are not isolated by session within the same location.

This policy is an operational improvement, **not** a guarantee every MCP supports health probing, all network failures are recoverable, or all external server tools implement session isolation.
