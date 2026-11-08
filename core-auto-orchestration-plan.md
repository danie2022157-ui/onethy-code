# Core Auto-Selection / Auto-Orchestration Implementation Plan

> **For the implementation session:** use the `writing-plans` and `executing-plans` workflows. Do not begin implementation until this plan is approved. Preserve all unrelated dirty changes in the working tree.

**Goal:** Make automatic agent/model selection and orchestration depend only on the current Location-scoped connected catalog and explicit user policy, while making unavailable-model behavior fail-closed, deterministic, observable, and testable.

**Architecture:** Keep `Model.Service` and `Provider.Service` as the sole runtime source of connected models. Add one Core policy/selection service that consumes immutable catalog snapshots, validates user policy at the boundary, and returns a typed decision or typed failure. `SessionRunnerModel`, the subagent tool, and orchestration planning all consume that service; none maintains a second allowlist, model registry, or fallback heuristic.

**Tech stack:** Effect services and Location-scoped layers, `@opencode/schema` model/provider contracts, Bun tests, existing Core fixtures and `Model.Service` snapshots.

---

## 1. Scope and invariants

### Files in scope

- `packages/core/src/omni-orchestrator.ts`
- `packages/core/src/session/runner/model.ts`
- `packages/core/src/tool/plugin/subagent.ts`
- `packages/core/src/omni-config.ts` and tests
- New Core selection-policy/health module if extraction is useful
- Focused tests under `packages/core/test`

### Explicitly out of scope

- UI/TUI/desktop redesign or unrelated dirty files
- Generated SDK/client files
- New Protocol/Server HTTP APIs unless separately approved
- Choosing a specific commercial provider or model

### Non-negotiable invariants

1. Automatic candidates are a subset of the current `Model.Service.available()` snapshot for the current `Location`.
2. Explicit user/session/input model selection is never silently replaced. If unavailable, return the requested typed error.
3. Explicit agent configuration wins over automatic routing when connected and policy-allowed.
4. An allowlist is a hard boundary. Invalid, empty, or non-matching policy fails closed; it never expands to the full catalog.
5. No production selection depends on literal model IDs, provider IDs, model-name substrings, or speculative names.
6. Capabilities come from `Model.Info.capabilities`, type, status, limits, cost, and policy—not names such as `flash`, `pro`, `mini`, or `opus`.
7. Fixed catalog + fixed policy yields deterministic selection; stable reference order is the final tie-breaker.
8. Cooldown is a bounded health preference, not authorization. It cannot bypass an allowlist or choose an incapable model.
9. Cooldown and orchestration task state are scoped to the current Location/mission.
10. Automatic deviations and no-candidate failures are observable without credentials or raw prompts.

## 2. Current-state diagnosis

### High-risk behavior

- `omni-orchestrator.ts` contains `CATEGORY_MODEL_PREFERENCES` with speculative hardcoded IDs, model-name bucket regexes, and task-description regex routing.
- `session/runner/model.ts` silently replaces explicit models and special-cases `opencode/flint-40b-free`.
- `subagent.ts` and the session runner duplicate allowlist/cooldown logic and fail open when filtering produces no candidates.
- `providerID === "test"` bypasses policy/cooldown checks.
- Empty candidate pools choose an arbitrary model instead of returning a typed failure.

### State/config risks

- Cooldowns use synchronous process-global memory plus user-global `auto-model.json`; a failure in one workspace affects all workspaces.
- Cooldown duration is caller-controlled and unbounded; expired disk entries are not pruned.
- The shared mutable `tasks` array is reset by each plan, so concurrent plans overwrite each other. `executeTask` lacks mission ownership validation and throws generic `Error`.
- `OmniConfig` overlaps the canonical config system, reads hidden env flags, strips JSONC comments by regex, and accepts unvalidated project provider/MCP/model data.
- Fixed `DEFAULT_AGENTS` and pipeline IDs can mask a user-defined agent catalog.
- The current dirty branch also contains an unrelated-but-critical MCP discovery regression: auto-discovered `.claude`/`.agents` entries default enabled, expand environment secrets, permit symlink/cwd escape, and silently overwrite sanitized-name collisions. This must be treated as a pre-implementation blocker and repaired or explicitly excluded with a failing-test record; do not claim the branch is green.
- Existing command aliases `/orchestrate` and `/ultrawork` must remain during migration unless a separately approved breaking change removes them.

### Runtime authority

`Model.Service` and `Provider.Service` are Location-scoped and already account for plugin activation, integration/connection state, disabled entries, credentials, and free-model configuration. `Model.Service.available()` is the only legitimate live candidate source; `ModelResolver.Service` remains the catalog-to-runtime resolution boundary.

## 3. Target contracts

Prefer a new internal module, `packages/core/src/model-selection-policy.ts`, rather than turning `omni-orchestrator.ts` into a second global registry.

```ts
type ModelSelectionMode = "explicit" | "automatic"

interface ModelSelectionPolicy {
  readonly mode: ModelSelectionMode
  readonly allowedModels?: ReadonlyArray<Model.Ref>
  readonly requiredTypes?: ReadonlyArray<Model.Type>
  readonly requiredCapabilities?: {
    readonly tools?: boolean
    readonly input?: ReadonlyArray<string>
    readonly output?: ReadonlyArray<string>
  }
  readonly allowDeprecated?: boolean
  readonly allowCooldownCandidates?: boolean
}

interface ModelSelectionDecision {
  readonly requested?: Model.Ref
  readonly selected?: Model.Ref
  readonly fallback?: Model.Ref
  readonly reason: "explicit" | "agent-config" | "capability" | "cooldown-avoidance" | "none"
  readonly candidateCount: number
}
```

Decode policy once at the config boundary with existing Schema/`Model.Ref` parsing. Omitted policy means automatic selection from connected chat models, not a hidden preference table. An allowlist is intersected with the live catalog. An empty intersection is `NoModelCandidateError`.

Replace category-to-model-ID routing with `SelectionIntent` requirements: model type, text/tools/vision requirements, minimum context, and optional explicit user tier. Category may be a hint for requirements, never authority for a provider/model. Rank `Model.Info` metadata deterministically. If capability metadata is insufficient, require explicit policy rather than guessing.

Replace global cooldown helpers with a Location-scoped Effect service (or a narrowly scoped adapter) that caps TTL, prunes expired records, uses Effect `Clock`, and cannot clear unrelated Locations. Avoid synchronous disk I/O in resolution. Persistence, if still required, is a later project-scoped async adapter with schema validation and atomic replacement.

Replace the layer-global task array with `Map<missionID, ReadonlyArray<TaskItem>>` or a mission service. Every task carries a mission ID; completion requires mission and task IDs and rejects cross-mission updates with a typed error.

## 4. Implementation sequence

### Task 0 — Establish and repair the dirty-branch baseline

**Files:** `packages/core/src/config/plugin/mcp.ts`, `packages/core/src/config/variable.ts`, `packages/core/src/plugin/command.ts`, existing config tests, plus only the files already dirty in the workspace.

Before changing selection behavior, run the existing focused suites from `packages/core` and record the current failures. The last audit observed 48 passing, 1 skipped, and 6 failing config/orchestrator tests. Do not reset those changes. Repair the P0 MCP discovery boundary first: auto-discovered entries stay disabled until explicit opt-in; only trusted roots are scanned; environment expansion is disabled or allowlisted for untrusted files; symlink/cwd escapes are rejected; and sanitized-name collisions fail explicitly. Restore/retain `/orchestrate` and `/ultrawork` aliases with deprecation coverage. Re-run the focused baseline tests and keep the failures as a release blocker until fixed.

This task is not a license to broaden the redesign into all config/plugin work. It is a safety gate because the current dirty branch changes the exact config and command boundaries consumed by the later policy migration.

### Task 1 — Red tests and fixtures

**Files:** new `packages/core/test/omni-model-selection.test.ts` and `packages/core/test/session-runner-model.test.ts`; extend `packages/core/test/omni-orchestrator.test.ts`, `packages/core/test/omni-policy.test.ts`, `packages/core/test/omni-config.test.ts`, and `packages/core/test/tool-subagent.test.ts`; use existing Core fixtures.

Add tests for live-catalog-only candidates, explicit model precedence, agent/category/default precedence, unavailable explicit models, invalid/empty allowlists, empty pools, capability-based ranking, stable tie-breaking, chat-vs-image/decision filtering, cooldown expiry/isolation, no `test` provider bypass, legacy env migration conflicts, lightweight/title/free policy, and no hardcoded selection IDs. Add concurrent mission/task isolation tests.

Run from `packages/core`:

```text
bun test ./test/omni-model-selection.test.ts ./test/omni-orchestrator.test.ts ./test/omni-policy.test.ts ./test/omni-config.test.ts ./test/tool-subagent.test.ts ./test/session-runner-model.test.ts
```

Expected before implementation: new tests fail on current silent fallback/fail-open behavior.

### Task 2 — Implement shared selection policy

**Files:** new `packages/core/src/model-selection-policy.ts`; modify `omni-orchestrator.ts`, `omni-config.ts`, and focused tests.

1. Add typed policy/no-candidate errors and a pure candidate-ranking function.
2. Accept immutable `Model.Info` snapshots from the Location-scoped `Model.Service`.
3. Filter disabled/deprecated/type-incompatible/not-allowed entries before ranking.
4. Honor explicit agent/session policy before automatic selection.
5. Remove `CATEGORY_MODEL_PREFERENCES`, literal IDs, model-name buckets, and hidden `OMNICODE_OPTIMIZE_TIER` routing.
6. Keep task classification only as broad intent requirements; raw text must not choose a cost tier.

Run `bun typecheck`, `bun run typecheck:tsc`, and the focused tests from `packages/core`.

### Task 3 — Make cooldown bounded and scoped

**Files:** new/modified health module, `session/runner/step.ts`, `session/session.ts`, `tool/plugin/subagent.ts`, `omni-orchestrator.ts`.

Preserve failure-triggered cooldown intent but cap TTL, prune on read/write, scope by Location/mission, remove synchronous global-file hot-path I/O, and test expiry, cap, isolation, all-cooled behavior, and concurrent writes. Cooldown may reorder candidates only; it must never broaden policy.

### Task 4 — Fix session resolution

**Files:** `packages/core/src/session/runner/model.ts`, `packages/core/test/location-layer.test.ts`, `packages/core/test/session-runner.test.ts`.

- With `session.model`, resolve exactly that catalog entry; missing entry returns `ModelUnavailableError` and never falls back.
- Without `session.model`, use connected/allowed agent configuration, then shared automatic selection.
- Validate variants against the selected model; never carry a variant from a different model.
- Use the shared allowlist/cooldown implementation and emit structured automatic-deviation information.

### Task 5 — Fix subagent precedence

**Files:** `packages/core/src/tool/plugin/subagent.ts`, `packages/core/test/tool-subagent.test.ts`.

Precedence is explicit input model → existing child explicit model → agent model → allowed parent inheritance → shared automatic selector → typed failure. Remove duplicated env parsing, the `test` bypass, and the `allowedCandidates.length > 0 ? allowedCandidates : availableList` branch. Sample `models.available()` once and pass that immutable snapshot through selection.

### Task 6 — Unify and validate configuration

**Files:** `packages/core/src/omni-config.ts`, `packages/core/test/omni-config.test.ts`, canonical `packages/core/src/config.ts` integration point.

Make canonical config authoritative. Convert OmniConfig into a thin adapter for autonomy/policy fields or remove it after callers migrate. Represent default model as optional `Model.Ref` or an explicit `"auto"` mode, never as a hidden model ID. Decode project JSONC with the project’s schema/config decoder; do not strip comments with regex or cast arbitrary objects. Provider/MCP changes from project config require the existing explicit permission/opt-in path. Keep a temporary, explicitly documented migration shim for `OMNICODE_ALLOWED_MODELS`, `OMNICODE_OPTIMIZE_TIER`, and `OMNICODE_THINKING_ROUTING`: file policy wins, malformed/empty legacy values fail closed or emit diagnostics, and the shim cannot widen a file policy. Deprecate and then remove Core reads of the legacy env vars; migrate TUI/desktop/CLI through a typed policy store instead of env bridging.

Also replace `Model.small()` family lists and `PREFERRED_FREE` with configured lightweight/free policy or metadata ranking. Treat missing cost as unknown, not free. Preserve title-generation behavior through an explicit optional lightweight intent.

### Task 7 — Make agent orchestration catalog-driven

**Files:** `packages/core/src/omni-orchestrator.ts`, `packages/core/src/agent.ts` if required, orchestration tests.

Read the Location-scoped agent catalog and honor user-defined agent model/configuration. Keep role templates only as explicit fallback metadata, not as authority. Resolve pipeline roles by available capabilities/IDs; if a required role is absent, return a typed planning failure or an explicit pending task rather than fabricating it. Store tasks per mission and publish mission IDs in OmniBus events.

## 5. Verification matrix

Run focused tests from `packages/core` after each task, then:

```text
bun run check
```

Required regression coverage:

- connected provider/model churn and Location isolation;
- unavailable explicit model and invalid variant errors;
- allowlist valid, invalid, empty, and no-match cases;
- no silent fallback and no paid-model substitution;
- capability requirements with misleading model names;
- deterministic ordering independent of catalog insertion order;
- cooldown expiry, bounded TTL, all-cooldown, and cross-session isolation;
- no `providerID === "test"` production bypass;
- concurrent mission plans and cross-mission task completion rejection;
- config precedence, malformed JSONC, untrusted project provider/MCP config;
- MCP discovery fail-closed behavior: disabled-by-default auto-discovery, trusted roots, env/symlink/cwd restrictions, collision diagnostics, and no secret expansion;
- `/orchestrate` and `/ultrawork` compatibility/deprecation aliases;
- legacy env shim precedence and invalid-value diagnostics;
- `Model.small()`, free-only, unknown-cost, title/lightweight, and configured default policies;
- existing `Model.Service` snapshot identity/immutability guarantees;
- existing subagent, runner, model-resolver, and provider overlay suites.

Do not run tests from repository root. Do not edit generated client files. If a public Protocol/Server `HttpApi` changes, run `bun run generate` from `packages/client`.

## 6. Observability and rollout

Emit structured internal events/logs containing requested ref (if any), selected ref, policy mode, candidate count, rejection reasons, Location/mission scope, and whether cooldown affected ordering. Never include credentials or raw prompt text.

Rollout gates:

1. **Parity:** shared service wraps current behavior behind tests; no production switch yet.
2. **Shadow:** capability ranking runs beside current routing and logs divergence.
3. **Fail-closed:** explicit and policy boundaries are enforced; silent fallback is removed.
4. **Unify:** session runner and subagent use the same selector; hidden env and global cooldown paths are removed.
5. **Adapter migration:** TUI/desktop/CLI use the typed policy store; delete obsolete side channels.

Rollback must be a feature/config switch at the selector boundary, not restoration of hardcoded model IDs. Preserve old policy data as inert, versioned records and report stale refs rather than selecting them.

## 7. Acceptance criteria

- No automatic code path contains a provider/model literal or model-name capability regex.
- All automatic selections are members of the current connected `Model.Service` catalog.
- Explicit unavailable selections fail with a typed error and an actionable message.
- Allowlist and cooldown policy is implemented once and is fail-closed.
- Selection is Location-scoped, deterministic, observable, and covered by regression tests.
- Concurrent missions cannot overwrite task state or complete another mission’s task.
- Canonical config has schema validation and explicit precedence; project config cannot silently activate providers/MCP servers.
- MCP auto-discovery is fail-closed and cannot expand secrets or execute untrusted commands/URLs without opt-in.
- Existing command aliases remain compatible or their approved deprecation is documented and tested.
- `packages/core` focused tests and the repository `bun run check` pass, with unrelated dirty changes preserved.

## Approval gate

This is an analysis/plan only. No production implementation should begin until the user approves the target contracts, fail-closed behavior, config migration, and rollout sequence.
