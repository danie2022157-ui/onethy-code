# Automation Reliability Implementation Plan

## Goal
Implement the user's remaining automation improvements, now including bounded autonomous code repair: dynamic and verifiable mission plans, actual agent task execution with lifecycle status, safer Git/checkpoint operations, same-process OmniBus concurrency, canonical researcher/explore routing, stable TUI model selection when changing agents, compatible TUI glyphs, and a bounded `omni-heal` repair loop.

## Constraints
- Preserve existing uncommitted work; no commit or push.
- Keep TUI agent changes from changing the selected model.
- Replace only unsupported terminal glyphs, retaining supported icons.
- OmniBus reliability is for concurrent work in one process; no distributed queue or new persistence infrastructure.
- `omni-heal` may invoke a coder subagent to repair failures automatically, with a hard maximum of 3 validation attempts per parent session and normalized command; stop and report if unresolved. Never hide unverified edits.
- Use TDD and project package-level verification.

## Phases
- [ ] 1. Inspect production/test contracts and active work; isolate file ownership.
- [ ] 2. Add RED tests and implement mission task schema/decomposition with dependencies and acceptance checks.
- [ ] 3. Add RED tests and connect task execution/status to subagent lifecycle, respecting dependency readiness.
- [ ] 4. Harden Git staging and checkpoint restore: target intended paths, check exit codes and resulting state, fail closed on unsafe restore.
- [ ] 5. Make same-process OmniBus publication/listing safe under concurrent effects; test ordering and no lost messages.
- [ ] 6. Normalize `researcher`/`explore` to an actually routable registered agent.
- [ ] 7. Fix TUI agent switching to retain current model and audit terminal glyph usage, replacing only unsupported glyphs with compatible labels/fallbacks.
- [ ] 8. Run focused tests, Core and TUI typechecks/checks, inspect diff and obtain review.

## Verification
- RED then GREEN for each behavioral change.
- Run affected tests from their package directories.
- Run Core `bun run typecheck` and `bun run typecheck:tsc`; run TUI package checks/tests and root `bun run check` if feasible.
- `git diff --check`; no success claim without current evidence.
