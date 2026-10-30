# Execution ledger — OmniCode

Plan: `../omni-orchestrator/docs/superpowers/plans/2026-10-29-omnicode-implementation-plan.md` (sibling project).

## Authorization and boundaries

- User authorized execution with “faz tudo ok”. No commits, publication, global installation or modification of the installed OpenCode service is authorized.
- Original prototype stays in its existing directory; concurrent changes to its CLI are not ours and are not overwritten.
- Work is on branch `omni-foundation` in a separate clone of the pinned upstream. No worktree was necessary because the new clone already provides isolation.
- Preservation: 57 files copied and SHA-256 checked without concurrent changes; full local Git history bundled in the private backup `C:/Users/Daniel/AppData/Local/Temp/opencode/omnicode-preservation-1793324815015`. No secrets were copied.

## Rulings

- Use a separate clone instead of moving the prototype. Preserves uncommitted/concurrent work and unrelated Git history; cost: two directories until an explicitly approved migration.
- Use portable Bun 1.4.4 in the approved temporary directory, verified against the release asset SHA-256. Do not install Bun globally or edit PATH permanently.
- Keep upstream behavior for the existing OpenCode entry point. Omni-specific safety and storage isolation must activate before importing the OmniCode entry point's dependencies.
- Full parity is a test target for the pinned base, not a completion claim from cloning or renaming a package.

## Work items

- [x] Confirm pinned remote tag and commit; clone separately; preserve prototype.
- [x] Install verified portable toolchain and dependencies locally; record upstream baseline.
- [x] Baseline: permission tests (108 pass), config policy + normalization tests (56 pass).
- [x] Type check: 961 files, zero errors.
- [x] Implement Omni hard-deny policy service (`packages/core/src/omni-policy.ts`) — fail-closed, cannot be elevated by project/child/plugin.
- [x] Implement Omni canonical path resolver (`packages/core/src/omni-path.ts`) — no directory creation at validation, link/junction safe.
- [x] Implement Omni shell guard (`packages/core/src/omni-shell.ts`) — argument validation, no prefix-only trust.
- [x] Integrate hard-deny into `Permission.evaluateInput` (`packages/core/src/permission.ts`) — evaluated before agent/session/saved approval/plugin hooks.
- [ ] Add regression tests for path traversal, symlink, shell escapes, PLAN enforcement, approval failure.
- [ ] Integrate Omni entry point and private storage/service namespace.
- [ ] Add global onboarding/resources, model routing and collaboration against upstream contracts.
- [ ] Integrate scoped durable memory using upstream persistence.
- [ ] Run CLI integration, regression, security and type/build checks; document limitations per platform.

## Evidence

- `git ls-remote --tags ... refs/tags/v2.2.2`: `098aa7fd6e02b03d6fc410f0b052038c7d4c5e81`.
- Clone checked out that exact commit. Branch created: `omni-foundation`.
- Local Node: v24.18.0; Git: 2.55.0.windows.3; Bun: 1.4.4 portable.
- Baseline: 108 permission tests pass, 56 config policy/normalization tests pass.
- Type check: 961 files, zero errors.
- New modules: `src/core/omni-policy.ts`, `src/core/omni-path.ts`, `src/core/omni-shell.ts`.
- Modified: `src/core/permission.ts` (hard-deny integration in `evaluateInput`).
