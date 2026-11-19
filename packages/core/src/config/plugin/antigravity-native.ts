/**
 * OnethyCode's native Antigravity authentication source.
 *
 * Official CortexKit package (https://github.com/cortexkit/antigravity-auth)
 * provides the Google Antigravity OAuth integration for OpenCode and Pi.
 */
export const CORTEXKIT_PACKAGE = "@cortexkit/opencode-antigravity-auth"
export const CORTEXKIT_VERSION = "3.1.10"
export const CORTEXKIT_SPEC = "@cortexkit/opencode-antigravity-auth"
export const CORTEXKIT_REPO = "github:cortexkit/antigravity-auth"

export const ANTIGRAVITY_PACKAGE = CORTEXKIT_PACKAGE
export const ANTIGRAVITY_VERSION = CORTEXKIT_VERSION
export const ANTIGRAVITY_SPEC = CORTEXKIT_SPEC
export const ANTIGRAVITY_REVISION = "cortexkit-3.1.10"

// Backwards compatibility references
export const JOSHROB_ANTIGRAVITY_PACKAGE = "github:JoshRob297/opencode-antigravity-auth"
export const JOSHROB_ANTIGRAVITY_SPEC =
  "https://github.com/JoshRob297/opencode-antigravity-auth/releases/download/v2.9.3/opencode-antigravity-auth-2.9.3.tgz"
export const LEGACY_ANTIGRAVITY_SPEC =
  "https://codeload.github.com/JoshRob297/opencode-antigravity-auth/tar.gz/4e670a71080c16abeeac2aa5789b0e14f376c960"
export const LEGACY_ANTIGRAVITY_PACKAGE = "legacy:@cortexkit/opencode-antigravity-auth-v2"

export interface PluginOperation {
  readonly type: "add" | "remove"
  readonly target: string
  readonly options?: Readonly<Record<string, unknown>>
}

export function antigravityEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.ONETHY_ANTIGRAVITY_AUTH === "1"
}

export function isAntigravityTarget(target: string) {
  return (
    target === CORTEXKIT_PACKAGE ||
    target.startsWith(CORTEXKIT_PACKAGE + "@") ||
    target.startsWith(CORTEXKIT_PACKAGE + "#") ||
    target === CORTEXKIT_REPO ||
    target.startsWith(CORTEXKIT_REPO + "#") ||
    target.startsWith(CORTEXKIT_REPO + "@") ||
    target === "cortexkit/antigravity-auth" ||
    target === "cortexkit.antigravity-auth" ||
    target === "opencode-antigravity-auth" ||
    target === "opencode.antigravity-auth" ||
    target === ANTIGRAVITY_SPEC ||
    target === JOSHROB_ANTIGRAVITY_SPEC ||
    target === LEGACY_ANTIGRAVITY_SPEC ||
    target === JOSHROB_ANTIGRAVITY_PACKAGE ||
    target.startsWith(JOSHROB_ANTIGRAVITY_PACKAGE + "#")
  )
}

export function isLegacyAntigravityTarget(target: string) {
  return (
    target === LEGACY_ANTIGRAVITY_SPEC ||
    target === LEGACY_ANTIGRAVITY_PACKAGE ||
    target.startsWith(LEGACY_ANTIGRAVITY_PACKAGE + "@")
  )
}

/**
 * Configure Antigravity plugin registrations.
 * Preserves user-configured CortexKit/Antigravity plugins, or auto-injects
 * @cortexkit/opencode-antigravity-auth when ONETHY_ANTIGRAVITY_AUTH=1.
 */
export function withNativeAntigravity<T extends PluginOperation>(
  operations: readonly T[],
  env: NodeJS.ProcessEnv = process.env,
): readonly (T | { type: "add"; target: string; options: Record<string, never> })[] {
  // If user explicitly configured CortexKit/Antigravity in their plugin list, preserve it
  const userConfigured = operations.find(
    (op) => op.type === "add" && isAntigravityTarget(op.target) && !isLegacyAntigravityTarget(op.target),
  )
  if (userConfigured) {
    return operations.filter((op) => !isLegacyAntigravityTarget(op.target))
  }

  const active = operations.filter(
    (op) => op.type !== "add" || (!isLegacyAntigravityTarget(op.target) && !isAntigravityTarget(op.target)),
  )
  if (!antigravityEnabled(env)) return active
  if (
    active.some(
      (op) =>
        op.type === "remove" &&
        (op.target === "*" ||
          op.target === "opencode-antigravity-auth" ||
          op.target === "opencode.antigravity-auth" ||
          op.target === "cortexkit.antigravity-auth" ||
          op.target === "cortexkit/antigravity-auth" ||
          isAntigravityTarget(op.target)),
    )
  )
    return active
  return [{ type: "add", target: ANTIGRAVITY_SPEC, options: {} }, ...active]
}
