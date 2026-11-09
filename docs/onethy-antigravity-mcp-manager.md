# OnethyCode native Antigravity Auth + MCP lifecycle

## Built-in Antigravity Auth

OnethyCode now uses the **[JoshRob297 Antigravity OAuth plugin](https://github.com/JoshRob297/opencode-antigravity-auth)** instead of the former CortexKit package.

- The host installs the immutable archive `https://codeload.github.com/JoshRob297/opencode-antigravity-auth/tar.gz/4e670a71080c16abeeac2aa5789b0e14f376c960` (upstream **v2.5.4**). This is the **same JoshRob297 GitHub commit**; it avoids npm's failing Git dependency preparation step (`git dep preparation failed`) while using the normal plugin installer. The integration is **not** a fork or a copy of the OAuth implementation.
- The legacy `@cortexkit/opencode-antigravity-auth` registration is filtered out of OnethyCode's configured plugin operations. Other plugins are left unchanged. Previously installed packages and credentials **are not deleted from your computer**, because that would require explicit local user action.
- Using a fixed upstream Git commit avoids executing newly changed third-party authentication code without review. Upgrade by reviewing and bumping `ANTIGRAVITY_REVISION` in `packages/core/src/config/plugin/antigravity-native.ts`. **No automatic update of this OAuth plugin is performed.**
- You must explicitly sign in with Google using the OpenCode auth interface after plugin activation: `onethy auth login`, choose **Google → OAuth with Google (Antigravity)**. Google access permissions and available models depend on your account. The OnethyCode host neither opens OAuth sessions automatically nor migrates prior credentials.
- Existing CortexKit credentials may not be compatible with the new plugin's account store. Do **not** copy tokens between stores or share them in logs; authenticate anew through the plugin if required.
- To disable the native integration, set `ONETHY_ANTIGRAVITY_AUTH=0`, or apply a plugin removal operation `-opencode-antigravity-auth`. OnethyCode mode is required for the built-in registration.
- A failed dependency download, missing network/DNS access, missing Google entitlement, or exhausted quota can still prevent model requests. The plugin swap is not a workaround for account limits or DNS failures.

**Security and provider terms:** JoshRob297 explicitly documents that this is an unofficial integration, not endorsed by Google, which can violate Google's Terms of Service and result in account restrictions or bans. The plugin handles OAuth tokens; review its source and permissions before signing in. Prefer a supported Google provider integration if you need official access. OnethyCode does not enable options to weaken model safety settings.


## Google OAuth localhost callback (OnethyCode)

**Root cause corrected:** the pinned JoshRob297 v2 plugin registers Google → `OAuth with Google (Antigravity)` as `mode: "code"`, even though Google redirects to `http://localhost:51121/oauth-callback`. Previously, the localhost page was unreachable unless a callback server was separately running, and users had to copy the redirected URL manually.

OnethyCode now bridges **only** the Google `antigravity-oauth` method, and only when Google provides a matching local `/oauth-callback` redirect, to an automatic loopback listener started **before** opening the browser:

1. Run `onethy service restart` to load the updated server.
2. Run `onethy auth login` or use `/connect` → Google → **OAuth with Google (Antigravity)**.
3. Sign in and approve in the browser. The local callback should report that authorization was received; return to OnethyCode for the final connected status.
4. If the port cannot be bound or the URL is incompatible, OnethyCode falls back to its **manual code/URL prompt**. Copy the **full** redirected localhost URL from the address bar and paste it **only into OnethyCode**. Never post OAuth codes or callback URLs in chat, issues or logs.

The listener binds **only** loopback IPv4/IPv6, accepts one callback with the exact expected OAuth `state`, rejects invalid states, handles denied authorization, and closes with the attempt. It does **not** exchange or store Google credentials: the pinned plugin continues to do that.

**Windows diagnostic (PowerShell, only while login is pending):**

```powershell
Get-NetTCPConnection -LocalPort 51121 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess
```

If nothing is listening, check OnethyCode's authorization error or use its manual callback prompt. If another process owns the port, identify it before closing it and retry. For WSL2, SSH and remote machines, browser `localhost` might not reach the OnethyCode process: run the CLI directly on the browser's machine, configure trusted port forwarding, or use manual authorization when offered.

**Verification boundary:** tests use synthetic callbacks and fake credentials; they do not contact Google or verify account entitlement. OAuth success does not imply model access or available quota.

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
