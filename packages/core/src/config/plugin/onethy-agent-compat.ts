/**
 * Runtime-only compatibility for historical AITmpl agents.
 * Their old importer stored everyone as primary, with one generic description.
 * Only that exact generated signature is adapted; explicit user agents are untouched.
 */
export type LegacyAITmpl = {
  readonly description?: string
  readonly mode?: string
  readonly system?: string
}

function clean(value: string): string {
  return value.replace(/\\n/g, " ").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim()
}

export function legacyAITmplAgent(id: string, info: LegacyAITmpl) {
  if (info.description !== "Imported AITmpl agents component" ||
    info.mode !== "primary" || !info.system?.trim()) return undefined

  const raw = info.system.trim()
  const firstLine = raw.split(/\r?\n/, 1)[0]
  if (firstLine !== "---") return undefined
  const end = raw.slice(4).search(/(?:\r?\n)---(?:\r?\n|$)/)
  if (end < 0 || end > 12000) return undefined
  const head = raw.slice(4, end + 4)
  const match = head.match(/^description:\s*(.+)$/m)
  let description = match ? clean(match[1]!) : ""
  if (description.startsWith('"') && description.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(description)
      if (typeof parsed === "string") description = clean(parsed)
    } catch {
      description = description.slice(1, -1)
    }
  } else if (description.startsWith("'") && description.endsWith("'")) {
    description = description.slice(1, -1)
  }
  if (!description || description === "|" || description === ">") {
    // Some YAML block scalars are multiline; be conservative and use the stable ID.
    description = "Specialist for " + id.replace(/[-_]/g, " ")
  }
  return {
    mode: "subagent" as const,
    description: ("AITmpl specialist (" + id.replace(/[-_]/g, " ") + "): " + description).slice(0, 380),
  }
}
