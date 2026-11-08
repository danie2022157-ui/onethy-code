# OnethyCode — Omni Model Router

## Scope

This implementation changes **OnethyCode model routing only**. It does not inspect the Antigravity plugin's account quotas, availability, OAuth state, or internal cooldowns.

The router chooses only from the **currently connected/enabled catalog**. The catalog is not proof that a provider still has quota. Provider HTTP errors are handled by the existing bounded session failover.

## Automatic primary selection

- A manually pinned session model and an explicitly configured agent model are never replaced by the ordinary automatic selection policy.
- The automatic route requires a connected, enabled, nondeprecated chat model with tool support.
- `OMNICODE_ALLOWED_MODELS` restricts candidates (an invalid or unmatched list fails closed).
- With `OMNICODE_ACTIVE=1`, the local orchestrator's model cooldown state removes temporarily blocked models. When all eligible candidates are cooled down, automatic routing fails closed rather than sending another speculative request.
- The selected ranking follows `agentModelRanking(session.agent, efficiencyProfile().mode)`:
  - `ONETHY_EFFICIENCY_PROFILE=economy`: lower estimated cost, with context prioritized for architect/reviewer.
  - `ONETHY_EFFICIENCY_PROFILE=balanced`: cost for exploration/research, context for architect/reviewer, recency for coding/other agents.
  - `ONETHY_EFFICIENCY_PROFILE=quality`: context for architect/reviewer and recency for others.
- Deterministic sorting uses catalog metadata only. Recency is a heuristic, not a guaranteed quality score.

## Runtime failover

When the *actual session runner* receives a typed quota/rate-limit error (including a validated Antigravity Google 429), it marks the affected model in local cooldown and may select an alternative if Omni Auto is authorized. It does not scan the transcript for error phrases.

- Antigravity **router cooldown** is fixed at five minutes; this does not reset the provider's quota.
- A different eligible provider is preferred; all candidates must satisfy allowlist, model type, capabilities, and context length requirements.
- Alternatives are ordered by the workload's `agentModelRanking`, not globally by price.
- Automatic model switching is limited to **two** failovers per logical step.
- Cross-model replay is only safe before model output and tool execution have begun. After output or side effects, the runner does not transparently repeat the step.
- If no safe candidate exists, return an explicit failure rather than cycling exhausted models.

## Automatic subagents

The subagent path and Omni Orchestrator both exclude locally cooled-down models. They report no route when no healthy, allowed candidate remains. Model overrides and explicitly configured agent models retain their existing precedence.

## Observability

The session runner logs failover decisions with session ID, original and replacement model IDs, cooldown duration, workload ranking, and failover count. These are **attempt** records, not proofs that the replacement completed.

## Regression verification

Run in the repository:

```bash
bun install --frozen-lockfile
bun --cwd packages/core test test/omni-model-selection.test.ts test/model-failover.test.ts test/omni-orchestrator.test.ts
bun --cwd packages/core test test/tool-subagent.test.ts
bun --cwd packages/core test test/session-runner.test.ts -t "Auto-Failover retries real pre-output 429"
bun --cwd packages/core run typecheck:tsc
```

The `.github/workflows/onethy-smoke.yml` workflow runs the relevant tests on Ubuntu and Windows and performs TypeScript checks on Linux.

**Production caveat:** a local five-minute cooldown is not a provider quota bypass. If the Antigravity plugin reports exhausted quota again, another 429 may occur. Runtime performance, provider connection and API quota must be verified using authorized credentials and representative real requests.
