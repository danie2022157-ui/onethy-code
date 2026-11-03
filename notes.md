# Notes: Core Auto-Selection and Auto-Orchestration

## Initial repository findings

- `packages/core/src/omni-orchestrator.ts` currently contains a `CATEGORY_MODEL_PREFERENCES` table with many literal provider/model IDs.
- `selectModelForAgent` first matches that table, then fills from `availableModels` using name heuristics (`flash`, `opus`, `reasoner`, etc.).
- `planMission`, `planUltrawork`, and `planTeamPipeline` use fixed agent IDs and fixed task shapes.
- `DEFAULT_AGENTS` is returned directly by `getAgents`, which may prevent complete user-defined agent catalogs from being authoritative.
- `packages/core/src/tool/plugin/subagent.ts` already queries `models.available()` and applies allowed-model/cooldown checks, making it a key integration boundary.
- `packages/core/src/model-resolver.ts` and `packages/core/src/session/runner/model.ts` are likely authoritative runtime resolution paths and must be checked before changing orchestration.
- `packages/core/src/omni-config.ts` has default configuration fields, including `defaultModel`; whether these are user-facing defaults or forbidden hidden model choices must be separated.

## Constraints

- Preserve runtime dependency direction and existing protocol contracts.
- Do not edit generated client files directly.
- Tests run from package directories, not repository root.
- Existing workspace modifications are intentional and must not be reset.

## Specialist findings received

### Runtime and architecture

- The authoritative runtime seam is the Location-scoped `Model.Service` / `Provider.Service`, not HTTP handlers or `OmniOrchestrator` itself.
- `Model.Service.available()` exposes chat models by default and requires explicit type filters for image/decision models. Snapshots are immutable and cached by provider-record identity; callers must not mutate or re-sort in place.
- Provider availability is derived from plugin activation plus integration/connection state. `OPENCODE_DISABLE_FREE_MODELS` can change the catalog, so automatic routing must always sample the current catalog.
- The authority is currently split between Core hardcoded tables, `OMNICODE_*` environment variables, and TUI-owned `auto-model.json`; Core should not depend on a client side channel.
- Existing provider overlay code (`packages/core/src/config/plugin/provider.ts`) already carries capabilities, variants, limits, costs, and enabled state and should remain the catalog authority.
- Existing websearch failover (`packages/core/src/websearch.ts`) provides a useful bounded cooldown pattern: prune expired entries, respect retry-after, track attempts, and fail when no provider remains.

### Security and fail-closed findings

- Allowlist handling is fail-open in both subagent and session paths; invalid or empty filtered sets fall back to the entire catalog. The two implementations also diverge.
- `providerID === "test"` bypasses allowlist and cooldown checks and must be fixture-only or removed from production policy.
- Explicit session models can be silently replaced, including a literal `opencode/flint-40b-free` special case, changing cost/capability/privacy without user visibility.
- Cooldowns are user-global, persisted in a shared file, have no duration cap or ownership, and are treated inconsistently as either a filter or a preference.
- Model-name regex buckets and task-description regex classification permit capability spoofing and prompt-controlled tier changes.
- The shared mutable task array lets concurrent plans overwrite one another; task completion lacks mission ownership validation and throws generic `Error`.
- `.omnicode/omnicode.jsonc` is parsed by comment stripping and cast without schema validation; project config can silently override providers, MCP servers, and model settings.

### Target architecture proposal

- Add a Core-local `ModelPolicy`/selection service consuming `Model.Info` snapshots and a typed `PolicyStore`; no Core module reads `OMNICODE_*` or writes `auto-model.json` directly.
- Replace category-to-model-ID tables with intent requirements (`type`, text/tools/vision, minimum context, reasoning) plus optional user-selected tier. Rank live catalog metadata deterministically; model IDs are never ranking rules.
- Use one selection service from `SessionRunnerModel`, `tool/plugin/subagent.ts`, and orchestration. Explicit session/input/agent models win; unavailable explicit refs return typed errors.
- Keep cooldown consultive and bounded, scoped by Location/mission, and never let it expand an allowlist or silently select an incapable model.
- Migrate in parity/shadow stages: wrap old policy, cut Core's env side channel, compute capability ranking in shadow mode, unify callers, then migrate TUI/desktop/CLI adapters.

### Performance findings

- Catalog discovery already has TTL/single-flight/ETag protections in `models-dev.ts`; do not add speculative caching there.
- `subagent.ts` calls `models.available()` up to four times per execution; capture one immutable catalog snapshot and only query alternate types in the diagnostic branch.
- Current selector repeatedly classifies each model with regexes and nested membership scans; the capability selector should classify once and use Sets, but correctness/fail-closed behavior comes first.
- Cooldown file reads/parses are synchronous in the hot path and never prune expired entries. Removing global file I/O is both a correctness and latency fix.
- `getAutoCustomizationsConfig()` and memory-bank instruction loading repeat synchronous reads; cache once per layer or use a short TTL after the routing migration, without changing unrelated instruction behavior.
- Existing `Model.read()` and provider identity memoization are intentional and should not be changed.
- Align model retry `RETRY_AFTER_MAX` with cooldown semantics rather than maintaining separate fixed durations.

### Requirements / migration findings

- Canonical precedence should be explicit session override > agent configuration > category preference > configured default > catalog-derived fallback, with no hidden provider/model default.
- Typed configuration should cover default/allowed models, optimization tier, category preferences, thinking routing, and optional lightweight/title policy. Legacy `OMNICODE_ALLOWED_MODELS`, `OMNICODE_OPTIMIZE_TIER`, and `OMNICODE_THINKING_ROUTING` may remain only as a documented, temporary migration shim; file policy wins on conflicts and invalid legacy input must not widen policy.
- Replace `Model.small()` family lists and `PREFERRED_FREE` with configured lightweight/free policy or metadata-based ranking; unknown cost is not equivalent to free.
- Preserve existing `/orchestrate` and `/ultrawork` command aliases through a deprecation window unless a separate breaking-change decision is approved.

### Provider-neutral contract findings

- Discovery is Location-scoped: `/api/integration`, `/api/provider`, and `/api/model?types=chat` are snapshots and may be incomplete during plugin startup. Handle `ServiceUnavailable`/initialization explicitly.
- Distinguish provider `available`, integration `connected`, and connection `needsAuth`; connection presence does not prove execution success.
- Persist `Model.Ref` (`providerID`, catalog `id`, optional variant), not provider API `modelID`.
- Use only declared type/capability/limit/cost metadata. `family`, names, IDs, variants, and release dates do not prove intelligence, latency, or reasoning ability. Unknown cost is unknown, not zero.
- Refresh selection on `integration.updated`, `provider.updated`, and `model.updated`; do not cache catalog values globally.

### Final audit findings / approval blockers

- Current dirty changes include an unrelated P0 MCP discovery regression: auto-discovered `.claude`/`.agents` MCPs default enabled, expand environment secrets, and allow symlink/cwd escape. Any later implementation must not worsen this; restore fail-closed discovery (`disabled: true` until opt-in), trusted roots, env allowlist/no expansion, symlink/cwd validation, and explicit collision errors.
- Current dirty changes also have P1 risks: cooldown is marked but not checked during normal session resolution; allowlists parse/fail open and are skipped for normal selected models; `providerID === "test"` bypasses policy; hardcoded routing/defaults remain; and six existing config tests fail. Treat this as a baseline gate, not as evidence the redesign is complete.
- Existing command aliases `/orchestrate` and `/ultrawork` must be retained or deliberately deprecated with tests and release notes.

### Regression test matrix

- New focused suites: `packages/core/test/omni-model-selection.test.ts` and `packages/core/test/session-runner-model.test.ts`.
- Extend: `omni-orchestrator.test.ts`, `omni-policy.test.ts`, `omni-config.test.ts`, and `tool-subagent.test.ts`.
- Cover provider-neutral selection, deterministic tie-breaking independent of catalog insertion order, empty pools, cooldown skip/all-cooled semantics, explicit/session/agent/category/default precedence, typed unavailable/variant errors, legacy environment migration conflicts, lightweight/title/free/unknown-cost policy, MCP fail-closed discovery, command aliases, mission ownership, and no `test` provider bypass.
- Use existing `testEffect`/`AppNodeBuilder`, `offlineModels`, `withEnv`, and temporary `OMNICODE_STATE_DIR`; avoid global mocks and sleeps. Run tests from `packages/core`, then `bun typecheck`, `bun run typecheck:tsc`, and root `bun run check` only after focused suites are green.
