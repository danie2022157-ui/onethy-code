# OmniCode integration map — OpenCode v2.2.2

The pinned checkout is a monorepo, not the legacy Node prototype. Keep upstream public protocol dependencies directed as documented in `AGENTS.md`; no HTTP or generated client contract is changed by the initial foundation work.

## Confirmed entry points

| Concern | Upstream surface | Integration constraint |
| --- | --- | --- |
| CLI entry point | `packages/cli/src/index.ts` | Owns handler registration, service layers and process lifecycle; Omni bootstrap must run before its imports. |
| Command contract | `packages/cli/src/commands/commands.ts` | `Commands`/`Spec` define the command tree. Preserve upstream subcommands instead of duplicating parsing. |
| Source process respawn | `packages/cli/src/util/process.ts` | `selfCommand()` derives the entry point from argv; Omni children must respawn through the Omni bootstrap. |
| Data, config, cache, state and locks | `packages/util/src/global.ts` | `Global.Path`, `Global.make`, `Global.layerWith`; initialization creates directories, pure resolution does not. |
| Platform defaults | `packages/util/src/global-roots.ts` | Original OpenCode uses XDG roots. Omni gets private Windows/XDG roots from its own resolver. |
| Session DB path | `packages/cli/src/database-path.ts` | Uses `OPENCODE_DB` or channel filename under global data; Omni must not inherit the user's live DB override. |
| Service discovery | `packages/cli/src/services/service-config.ts` | Registration is global-state and channel scoped. Use a separate Omni channel; never discover/start/restart the installed OpenCode service. |
| CLI version/channel | `packages/cli/src/version.ts` | Development builds default to `local`; distinct Omni channel is required for service/default-port isolation. |
| Binary loader | `packages/cli/bin/opencode.cjs` | Resolves official platform packages and `OPENCODE_BIN_PATH`; it is not safe to rename this loader and silently install official binaries as OmniCode. |
| Tests | `packages/util/test/global.test.ts`, `packages/cli/test/fixture/environment.ts` | Existing tests cover no-write imports, service directory creation, and isolated child environments. Run from package directories. |

## Toolchain and baseline

- Root package pins Bun `1.4.4`. A portable verified build is used; no global toolchain changes.
- Dependency install uses the upstream lockfile and disables lifecycle scripts initially. Required native setup scripts must be inspected before execution.
- Root `bunfig.toml` deliberately blocks root tests. Use per-package scripts and core's isolated test runner.
- Initial Omni path/environment tests live in `packages/util/test/omnicode.test.ts` and do not import runtime services.
- The integration test `packages/util/test/omnicode-global.test.ts` must pass before claiming that the runtime itself is isolated.
- Security/agent/session integration mapping and baseline results are recorded in `progress.md` as they are verified; this document does not mark those features complete.
