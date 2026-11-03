# Core Context, Retry and Usage Controls Implementation Plan

> **For Claude:** Use the project's TDD skill and complete this plan task-by-task.

**Goal:** Reduce redundant subagent context, enforce a bounded `omni_heal` validation budget, and expose available usage metrics with subagent results.

**Architecture:** Reuse the current Location-scoped Tool and Session services, persisted child-session messages, and Job lifecycle. Preserve full child-session history while bounding only content returned into the parent context. Keep healing as one validation per tool call; track a three-validation budget by parent session and project command, with `diagnose` excluded. Do not add public HTTP/SDK contracts, a monetary/token spend ceiling, distributed state, or automatic code repair.

**Tech Stack:** TypeScript, Effect v4, Bun tests, existing SQLite-backed SessionStore/Job data.

---

## Decisions and counting rules

- `omni_heal.maxAttempts` defaults to **3** and means the maximum number of `run_and_heal` validation executions for the same parent session and normalized command during the current process lifetime. The first failing run consumes one attempt; a passing run also consumes one. `diagnose` consumes none. The budget resets on process restart; it is a bounded loop guard, not a durable billing or workflow budget.
- Each `omni_heal` call runs the validation command at most once. The tool does not claim to edit or repair source code; it instructs the agent to make changes between validation calls.
- Subagent histories remain complete and persistent. Bound the text returned to the parent/result and completion notification, preserving session ID and a truncation marker. Keep the requested task intact; avoid arbitrary truncation of user instructions.
- Usage is measured per child session from persisted assistant records and tool parts. Report known input/output/reasoning/cache tokens, tool calls, retries when reliably attributable, and elapsed time from job/session timestamps. Omit unavailable figures rather than inventing them. No cost is promised unless the existing source supplies it reliably.
- Retry count means additional validation attempts after the first for `omni_heal`; provider request retries are not mixed into this count.

## Task 1: Define and test bounded subagent result text

**Files:**
- Modify: `packages/core/src/session/subagent-completion.ts`
- Test: `packages/core/test/tool-subagent.test.ts`

**Steps:**
1. Add a failing test proving long foreground and background child output is shortened with an explicit marker and keeps the child session ID.
2. Run `bun test test/tool-subagent.test.ts` from `packages/core` and confirm the new assertion fails for the current unbounded result.
3. Add one shared truncation boundary in `SubagentCompletion`; apply it to returned child text and synthetic completion text, without changing stored child messages.
4. Re-run the focused test and verify existing short-result assertions remain unchanged.

**Acceptance:** Parent-facing subagent output is bounded, clearly marked when truncated, and child-session history remains full.

## Task 2: Enforce `omni_heal` validation attempt budget

**Files:**
- Modify: `packages/core/src/tool/plugin/omni-heal.ts`
- Create: `packages/core/test/tool-omni-heal.test.ts` (follow local Effect/tool fixture conventions)

**Steps:**
1. Write failing tests for default limit 3, explicit limits, over-limit calls, successful validations consuming budget, and diagnose not consuming budget.
2. Run the focused test and confirm failure because `maxAttempts` is ignored today.
3. Add a small process-local attempt counter scoped by parent session ID and normalized command. Validate `maxAttempts` as a positive finite integer, cap it to a safe maximum (3), and reject further validation once spent.
4. Change failure messaging to say one validation failed and that the agent may repair then re-run within the remaining attempts; remove the misleading claim that the tool itself starts a self-healing loop.
5. Re-run the focused test, including two distinct parent sessions and commands to verify budget isolation.

**Acceptance:** No session/command can execute more validations than its configured (maximum 3) allowance in one process; `diagnose` remains unlimited and non-consuming.

## Task 3: Derive per-subagent task usage from current records

**Files:**
- Modify: `packages/core/src/session/subagent-completion.ts`
- Modify: `packages/core/src/session/subagent-job.ts` only if the completion observer needs Job start/completion timestamps or child-session access.
- Modify: `packages/core/src/tool/plugin/subagent.ts`
- Test: `packages/core/test/tool-subagent.test.ts`

**Steps:**
1. Add failing tests for known token totals, tool-call count, elapsed duration and absent/partial usage. Establish fixture records through existing Session events rather than duplicating production aggregation.
2. Run `bun test test/tool-subagent.test.ts` and confirm the metrics assertions fail because no task metrics are returned.
3. Aggregate only the child session's persisted assistant token records and tool parts. Count retry attempts only where the durable session events identify them unambiguously; otherwise return no retry figure and document that limitation.
4. Include a concise metrics block in the foreground tool result and background synthetic completion metadata/text using a single calculation path. Keep metrics out of public HTTP/SDK schemas.
5. Re-run foreground, background, and restart/replay completion tests; ensure delivery remains idempotent.

**Acceptance:** Foreground/background completion reports the same known task metrics; full logs stay in the child session; missing metrics are omitted/marked unavailable; no retry or usage data is guessed.

## Task 4: Verification and review

**Commands (run from `packages/core`):**
- `bun test test/tool-subagent.test.ts`
- `bun test test/tool-omni-heal.test.ts`
- `bun test test/session-runner-retry.test.ts`
- `bun run typecheck`
- `bun run typecheck:tsc`
- `git diff --check`

**Review:** Check API compatibility of tool metadata/content, Location/session isolation, bounded text marker behavior, and that unrelated workspace edits remain untouched. Do not commit or publish unless explicitly requested.

**Acceptance:** Focused tests and both Core typechecks pass; no generated SDK changes are expected because no public Protocol or Server HttpApi contract changes.
