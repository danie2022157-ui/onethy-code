# OnethyCode: Real Auto-Failover Anti-429

## What was corrected

The old TUI implementation scanned entire event JSON for terms such as "429", "quota" or "rate limit". It could mark the *currently selected* model as failed even when the words appeared in unrelated text, then select another model in the UI without retrying the interrupted request.

The new implementation separates the **provider error**, **bounded runner retry**, and **UI confirmation**:

1. The actual session runner detects a typed \`RateLimit\` or \`QuotaExceeded\` failure, or HTTP status 429. Arbitrary text never triggers a cooldown.
2. Antigravity models have a fixed five-minute **OnethyCode routing cooldown** after a verified quota/429 failure. Other providers use five minutes by default or their valid `retryAfterMs` value (capped at fifteen minutes). This router cooldown does **not** override the Antigravity plugin's independent per-account/model quota hold.
3. If the failed attempt produced **no output and executed no tools**, and OnethyCode has automatic model mode enabled, it selects a healthy replacement from the current connected catalog. A different provider is preferred, then a compatible model on the same provider.
4. Candidate selection is limited to **allowed** models with matching input/output/tool capabilities, sufficient context capacity, active status and no cooldown.
5. The real runner replays the failed, pre-output step through the replacement, retaining durable retry bookkeeping. For a successful replacement, subsequent steps in that same execution use it. The persistent user-pinned session choice is not modified.
6. The number of model changes is bounded at **two per logical step**. If no eligible replacement exists, the execution reports the provider failure instead of hammering models in cooldown.
7. The TUI uses typed retry events and waits for a genuine \`session.step.started\` event on a **different model** before displaying a model-change notice. Starting a request does not prove it later completed successfully.
8. Automatic prompt submission stops with a clear message if every selected model is in cooldown. Manually chosen models keep their ordinary explicit-selection behavior.

## User control

- The runner only attempts cross-model recovery when OnethyCode is active (\`OMNICODE_ACTIVE=1\`) and the model is automatic. When the TUI's Omni Auto mode is on, it sets \`OMNICODE_AUTO_MODEL=1\` for the process so a model chosen by the auto selector can also be retried on another provider.
- To disable all automatic provider failover without turning off ordinary provider retries, set \`ONETHY_AUTO_FAILOVER=off\` before launching OnethyCode.
- If you select a model manually, Omni Auto turns off and that model remains pinned; the runner does not silently replace a manually chosen model.
- \`OMNICODE_ALLOWED_MODELS\` (when configured) limits the replacement pool; an invalid allowlist is treated as no candidates.
- The fallback is **per active session drain**. It does not overwrite user model preferences. For new prompts, Omni Auto chooses among currently healthy models.

## Reliability and cost

- No invisible retry after output or a tool call: replaying tool actions can duplicate external side effects.
- A failed provider attempt may still count toward a provider's usage or bill; failover is not free.
- A fixed five-minute timer cannot bypass actual provider quotas or reauthenticate an unavailable account.
- If Antigravity reports a long quota reset (for example, 132 hours), OnethyCode may reconsider that model after five minutes, but the plugin still enforces all applicable account/model quota restrictions. Prefer a healthy authorized alternative rather than repeatedly requesting an exhausted account.
- For long-lived quota blocks, manually check account limits or reduce request volume instead of repeating requests.
- The UI message confirms a **new attempt started**, not a successful task completion.
- Production validation should include actual API responses and account permissions, realistic cost and tool usage, cancellation, Windows/WSL installation, and provider-specific rate limits.

## Tests

~~~bash
bun --cwd packages/core test test/model-failover.test.ts
bun --cwd packages/core test test/session-runner.test.ts -t "Auto-Failover retries real pre-output 429"
bun --cwd packages/core run typecheck:tsc
bun --cwd packages/tui run typecheck:tsc
~~~

These checks are also included in the \`onethy-smoke\` Windows/Ubuntu GitHub Actions workflow.
