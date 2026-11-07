/**
 * The persisted Omni Auto allowlist can contain IDs from a replaced provider
 * plugin (e.g. antigravity/* -> google/antigravity-*). Keep the server's
 * per-prompt allowlist consistent with the TUI's currently usable catalog.
 * When every saved ID is stale, the TUI already falls back to the full
 * connected catalog; return undefined to express that same intent.
 */
export function effectiveAllowedModels(
  selected: readonly string[] | undefined,
  catalog: readonly { readonly providerID: string; readonly id: string }[],
): string[] | undefined {
  if (!selected?.length) return
  const available = new Set(catalog.map((model) => `${model.providerID}/${model.id}`))
  const active = [...new Set(selected.filter((id) => available.has(id)))]
  return active.length > 0 ? active : undefined
}
