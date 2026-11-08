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
- [ ] Install verified portable toolchain and dependencies locally; record upstream baseline.
- [ ] Test then implement Omni entry point and private storage/service namespace.
- [ ] Integrate default approval and hard policy enforcement at actual upstream dispatch boundaries.
- [ ] Add global onboarding/resources, model routing and collaboration against upstream contracts.
- [ ] Integrate scoped durable memory using upstream persistence.
- [ ] Run CLI integration, regression, security and type/build checks; document limitations per platform.

## Evidence

- `git ls-remote --tags ... refs/tags/v2.2.2`: `098aa7fd6e02b03d6fc410f0b052038c7d4c5e81`.
- Clone checked out that exact commit. Branch created: `omni-foundation`.
- Local Node: v24.18.0; Git: 2.55.0.windows.3; Bun was absent before setup.
- RED: `bun test test/omnicode.test.ts` from `packages/util` failed because the production module was missing.
- GREEN: `bun test test/omnicode.test.ts --coverage` from `packages/util`: 6 passed, 0 failed, 24 assertions; 100% lines/functions for `src/omnicode.ts` only.
- Portable Bun asset verified against `cd2c0fccc78f3ede1f50ca827a15f063eda13d4d150a3d0674f4f6e323d864a5`; executing it reported `1.4.4`.
- Dependency installation is in progress with `--frozen-lockfile --ignore-scripts`. Upstream baseline and end-to-end isolation are not claimed yet.
