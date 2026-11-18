/**
 * OnethyCode's native Antigravity authentication source.
 *
 * The old CortexKit package is replaced with JoshRob297's OpenCode v2 plugin.
 * Pin the upstream Git commit / release tarball so production does not silently execute changed
 * third-party OAuth code. Bumping the revision requires explicit review.
 * Authentication and stored account migration remain user-controlled.
 */
export const ANTIGRAVITY_PACKAGE = "github:JoshRob297/opencode-antigravity-auth"
export const ANTIGRAVITY_VERSION = "2.9.3"
export const ANTIGRAVITY_REVISION = "05f6f41d37b6a928622ad8530ec30c943837b460" // upstream v2.9.3
export const ANTIGRAVITY_SPEC =
  "https://github.com/JoshRob297/opencode-antigravity-auth/releases/download/v2.9.3/opencode-antigravity-auth-2.9.3.tgz"
export const LEGACY_ANTIGRAVITY_SPEC =
  "https://codeload.github.com/JoshRob297/opencode-antigravity-auth/tar.gz/4e670a71080c16abeeac2aa5789b0e14f376c960"
export const LEGACY_ANTIGRAVITY_PACKAGE = "@cortexkit/opencode-antigravity-auth"

export interface PluginOperation {
  readonly type: "add" | "remove"
  readonly target: string
  readonly options?: Readonly<Record<string, unknown>>
}

export function antigravityEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (env.OMNICODE_ACTIVE === "1" || env.ONETHY_ACTIVE === "1") &&
    env.ONETHY_ANTIGRAVITY_AUTH !== "0"
}

export function isAntigravityTarget(target: string) {
  return target === ANTIGRAVITY_SPEC || target === LEGACY_ANTIGRAVITY_SPEC || target === ANTIGRAVITY_PACKAGE ||
    target.startsWith(ANTIGRAVITY_PACKAGE + "#")
}

export function isLegacyAntigravityTarget(target: string) {
  return target === LEGACY_ANTIGRAVITY_PACKAGE ||
    target.startsWith(LEGACY_ANTIGRAVITY_PACKAGE + "@")
}

/**
 * Strip obsolete CortexKit plugin registrations, including legacy user config,
 * before adding the chosen GitHub source. Never load the two OAuth plugins
 * together (they may register overlapping provider integrations).
 * Respect explicit opt-out and removals; never migrate credentials implicitly.
 */
export function withNativeAntigravity<T extends PluginOperation>(
  operations: readonly T[],
  env: NodeJS.ProcessEnv = process.env,
): readonly (T | { type: "add"; target: string; options: Record<string, never> })[] {
  const active = operations.filter((op) => op.type !== "add" || !isLegacyAntigravityTarget(op.target))
  if (!antigravityEnabled(env)) return active
  if (active.some((op) => op.type === "remove" &&
    (op.target === "*" || op.target === "opencode-antigravity-auth" ||
      op.target === "opencode.antigravity-auth" || op.target === "cortexkit.antigravity-auth" ||
      isAntigravityTarget(op.target)))) return active
  // Older OnethyCode builds persisted the legacy spec or older pinned git source.
  // Replace only those exact sources, preserving unrelated plugin registrations.
  // Other explicitly selected Git revisions stay under the user's control.
  const legacyPinned = ANTIGRAVITY_PACKAGE + "#4e670a71080c16abeeac2aa5789b0e14f376c960"
  const normalized = active.filter(
    (op) => op.type !== "add" || (op.target !== legacyPinned && op.target !== LEGACY_ANTIGRAVITY_SPEC),
  )
  if (normalized.some((op) => op.type === "add" && isAntigravityTarget(op.target))) return normalized
  return [{ type: "add", target: ANTIGRAVITY_SPEC, options: {} }, ...normalized]
}
