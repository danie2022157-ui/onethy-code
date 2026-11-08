/**
 * /connect only offers OAuth methods actually registered by the active plugin.
 * Showing a missing-plugin diagnostic (rather than a fake login method) makes
 * a failed or disabled native Antigravity package visible to the operator.
 */
export function nativeAntigravityMissing(
  integration: { readonly id: string; readonly methods: readonly { readonly type: string; readonly id?: string }[] },
  env: Pick<NodeJS.ProcessEnv, "OMNICODE_ACTIVE" | "ONETHY_ACTIVE" | "ONETHY_ANTIGRAVITY_AUTH"> = process.env,
): boolean {
  if (integration.id !== "google") return false
  if (env.ONETHY_ACTIVE !== "1" && env.OMNICODE_ACTIVE !== "1") return false
  if (env.ONETHY_ANTIGRAVITY_AUTH === "0") return false
  return !integration.methods.some((method) => method.type === "oauth" && method.id === "antigravity-oauth")
}
