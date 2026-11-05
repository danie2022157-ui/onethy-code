// OnethyCode hook scripts are imported as inert, declarative descriptors.
// Only a small, explicit set of guards has a first-party OnethyCode adapter.
// Never execute scripts or shell commands from the external OnethyCode catalog.
import { createHash } from "node:crypto"

export function safeCustomizationId(value) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item"
  return slug.length > 60 ? slug.slice(0, 49).replace(/-+$/g, "") + "-" + createHash("sha256").update(value).digest("hex").slice(0, 8) : slug
}
export function convertOnethyCodeHook(relativePath, source) {
  const id = safeCustomizationId(relativePath.replace(/\.[^.]+$/, ""))
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase()
  const name = normalized.split("/").at(-1)?.replace(/\.[^.]+$/, "") || "hook"
  const implementation =
    normalized === "git/prevent-direct-push.py" ? "protected-push" :
    normalized === "git/conventional-commits.py" ? "conventional-commits" : "reference-only"
  const report = { id, name, kind: "hook", implementation, source: "catalog/hooks/" + normalized, enabled: false,
    description: implementation === "reference-only"
      ? "OnethyCode hook reference; requires native review and adaptation before execution."
      : "Native OnethyCode permission guard. Disabled until explicitly enabled by the user.",
    sourceSha256: createHash("sha256").update(source).digest("hex") }
  return { file: JSON.stringify(report, null, 2) + "\n", supported: implementation !== "reference-only", id }
}
export function convertOnethyCodeMod(name, manifest, readme = "") {
  const id = safeCustomizationId(name)
  const implementation = name.replaceAll("\\", "/").toLowerCase() === "security/secret-redactor" ? "secret-redactor" : "reference-only"
  let description = "OnethyCode Claude mod; its runtime hooks cannot execute in OnethyCode without an adapter."
  if (manifest) {
    try {
      const raw = JSON.parse(manifest)
      if (typeof raw.description === "string") description = raw.description.slice(0, 500)
    } catch {}
  }
  return {
    id,
    supported: implementation !== "reference-only",
    file: JSON.stringify({
      id, name: name.split("/").at(-1), kind: "mod", implementation, enabled: false,
      source: "catalog/mods/" + name, description,
      readmeSha256: createHash("sha256").update(readme).digest("hex"),
    }, null, 2) + "\n",
  }
}
