# Task Plan: Core Auto-Selection and Auto-Orchestration

## Goal
Audit and redesign `packages/core` so agent/model selection and orchestration are fully data-driven from connected providers and explicit user configuration, with no hardcoded model IDs or hidden provider assumptions.

## Phases
- [x] Phase 1: Parallel discovery by 10 specialists
- [x] Phase 2: Synthesize architecture, requirements, and migration boundaries
- [x] Phase 3: Produce implementation plan with files, contracts, tests, and rollout gates
- [x] Phase 4: User approval before code changes

## Implementation checklist
- [ ] Repair and verify MCP/config baseline (dedicated coder)
- [ ] Implement shared model policy, explicit precedence, and scoped cooldown
- [ ] Isolate mission tasks and preserve command compatibility
- [ ] Run focused tests and Core typechecks
- [ ] Independent reviewer audit and root `bun run check`

## Key Questions
1. Where are model IDs, provider assumptions, and agent defaults hardcoded?
2. What is the authoritative source for connected providers/models at runtime?
3. How should user-defined policy override automatic selection without introducing fallback defaults?
4. How can orchestration remain deterministic, observable, and safe when the available model set changes?
5. What compatibility constraints exist across Schema, Core, Protocol, Server, TUI, App, and Desktop?

## Decisions Made
- This pass is analysis and planning only; no production code changes until the plan is approved.
- Connected runtime models are the only automatic candidate pool.
- User policy must be explicit and take precedence; absent policy means capability-based selection, not a predefined model list.
- Existing dirty changes must be preserved.
- The final implementation must follow Planner → Architect → Coder → Reviewer gates.

## Errors Encountered
- None yet.

## Status
**Implementation authorized** — user approved with “ok corrija”. Checkpoint `cp-2026-11-02T05-50-09-474Z` preserves the baseline. Two coders have disjoint ownership for MCP/config and model selection/orchestration. Cooldown is consultative: all-cooled candidates retain deterministic ranking within the allowed pool. Explicit session/input/agent choices never silently change. Completion remains gated on tests, typechecks, and independent review.
