/**
 * OnethyCode's built-in Antigravity Auth integration.
 *
 * Package code is supplied by CortexKit under MIT; OnethyCode does NOT copy or
 * own Google credentials, impersonate Google sign-in, or auto-enroll accounts.
 * A compatible major version range prevents unattended 3.x -> 4.x migration.
 */
export const ANTIGRAVITY_PACKAGE = "@cortexkit/opencode-antigravity-auth"
export const ANTIGRAVITY_BASELINE = "3.0.30"
export const ANTIGRAVITY_SPEC = ANTIGRAVITY_PACKAGE + "@^" + ANTIGRAVITY_BASELINE

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
  return target === ANTIGRAVITY_PACKAGE ||
    target.startsWith(ANTIGRAVITY_PACKAGE + "@")
}

/** Avoid installing duplicates, and respect explicit user removal/disable. */
export function withNativeAntigravity<T extends PluginOperation>(
  operations: readonly T[],
  env: NodeJS.ProcessEnv = process.env,
): readonly (T | { type: "add"; target: string; options: Record<string, never> })[] {
  if (!antigravityEnabled(env)) return operations
  if (operations.some((op) => op.type === "remove" &&
    (op.target === "*" || op.target === "opencode.antigravity-auth" ||
      op.target === "cortexkit.antigravity-auth" || isAntigravityTarget(op.target)))) return operations
  if (operations.some((op) => op.type === "add" && isAntigravityTarget(op.target))) return operations
  return [{ type: "add", target: ANTIGRAVITY_SPEC, options: {} }, ...operations]
}
