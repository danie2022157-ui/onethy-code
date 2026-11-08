/** Reject common secret and Onethy runtime files before an agent stages every changed file. */
export function isSensitiveCommitPath(input: string): boolean {
  const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase()
  const parts = normalized.split("/")
  const name = parts.at(-1) ?? ""
  if (parts.includes(".omnicode") || parts.includes(".onethy-code")) return true
  if (/^\.env(?:\.|$)/.test(name) && !/^\.env\.(?:example|sample|template)$/.test(name)) return true
  if (/^(?:id_rsa|id_ed25519|credentials?\.json|secrets?\.json|tokens?\.json|service-account(?:\.json)?)$/.test(name)) return true
  if (/\.(?:pem|p12|pfx|key|keystore)$/.test(name)) return true
  return false
}

/** Porcelain -z entries are unambiguous even when filenames contain newlines. */
export function parseChangedGitPaths(output: string): string[] {
  const rows = output.split("\0")
  const files: string[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length < 4) continue
    const status = row.slice(0, 2)
    files.push(row.slice(3))
    // In -z mode the renamed/copied pathname follows as a separate NUL field.
    if (status.includes("R") || status.includes("C")) {
      const original = rows[++i]
      if (original) files.push(original)
    }
  }
  return files
}
