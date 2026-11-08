/**
 * Bounded, deterministic personalization recommendations for a single prompt.
 *
 * Selection is not permission or execution. The session prompt hook attaches
 * skill content only after checking the effective "skill" permission.
 * Untrusted hooks, mods and settings are never treated as executable skills.
 */
import { relevance, tokenize } from "./omni-intelligence.js"
import { chooseImportedSpecialist } from "./specialist-router.js"

export interface Candidate {
  readonly id: string
  readonly description?: string
}

export interface SkillCandidate extends Candidate {
  readonly autoinvoke?: boolean
  readonly path?: string
  readonly content?: string
}

export interface AgentCandidate extends Candidate {
  readonly mode: string
  readonly hidden?: boolean
}

export interface AutoPersonalizationCatalog {
  readonly skills: ReadonlyArray<SkillCandidate>
  readonly agents: ReadonlyArray<AgentCandidate>
  readonly commands: ReadonlyArray<Candidate>
  readonly mcpTools: ReadonlyArray<Candidate>
}

export interface AutoPersonalizationSelection {
  readonly skills: ReadonlyArray<string>
  readonly agents: ReadonlyArray<string>
  readonly commands: ReadonlyArray<string>
  readonly mcpTools: ReadonlyArray<string>
}

const STOP = new Set([
  "que", "quero", "para", "com", "uma", "uns", "dos", "das", "esse", "essa", "isso", "sobre",
  "faca", "fazer", "crie", "criar", "corrija", "corrigir", "meu", "minha", "mais", "como",
  "the", "and", "for", "with", "from", "please", "this", "that", "make", "create", "fix",
  "code", "coding", "agent", "agents", "tool", "tools", "app", "help", "project", "projeto",
  "sistema", "system", "file", "arquivo", "novo", "new", "use", "usar", "test", "teste",
])
export const MAX_AUTO_SKILLS = 2
export const MAX_SKILL_CHARS = 6_000
export const MAX_TOTAL_SKILL_CHARS = 10_000

export function isExecutableSkill(candidate: SkillCandidate): boolean {
  if (candidate.autoinvoke === false) return false
  const id = candidate.id.toLowerCase()
  if (/^(?:hook|mod|setting|plugin)-/.test(id)) return false
  const path = candidate.path?.replaceAll("\\", "/").toLowerCase() ?? ""
  return !/(?:^|\/)(?:hooks|mods|plugins|settings)(?:\/|$)/.test(path)
}

function ranked(query: string, candidates: ReadonlyArray<Candidate>, limit: number): string[] {
  if (!query || limit < 1) return []
  return candidates
    .map((candidate) => ({
      id: candidate.id,
      score: relevance(query, candidate.id, (candidate.description ?? "").slice(0, 400)),
    }))
    // A score of 7 requires at least an exact title token, or multiple
    // meaningful description matches; generic instructions cannot trigger one.
    .filter((candidate) => candidate.score >= 7)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((candidate) => candidate.id)
}

export function selectAutoPersonalizations(
  prompt: string,
  catalog: AutoPersonalizationCatalog,
): AutoPersonalizationSelection {
  const query = [...new Set(tokenize(prompt.slice(0, 1_800))
    .filter((word) => word.length >= 3 && !STOP.has(word)))].slice(0, 24).join(" ")
  if (!query) return { skills: [], agents: [], commands: [], mcpTools: [] }
  const skills = ranked(query, catalog.skills.filter(isExecutableSkill), 4)
  const specialist = chooseImportedSpecialist(prompt, catalog.agents)
  return {
    skills,
    agents: specialist === "general" ? [] : [specialist],
    commands: ranked(query, catalog.commands, 2),
    mcpTools: ranked(query, catalog.mcpTools, 3),
  }
}

/** Do not silently load content for permissions in the ask/deny state. */
export function selectAllowedSkillAttachments(
  ids: ReadonlyArray<string>,
  skills: ReadonlyArray<SkillCandidate>,
  isAllowed: (id: string) => boolean,
  existing: ReadonlyArray<string> = [],
): string[] {
  const present = new Set(existing)
  const byID = new Map(skills.map((skill) => [skill.id, skill]))
  let remaining = MAX_TOTAL_SKILL_CHARS
  const selected: string[] = []
  for (const id of ids) {
    if (present.has(id) || selected.length >= MAX_AUTO_SKILLS || !isAllowed(id)) continue
    const skill = byID.get(id)
    if (!skill || !isExecutableSkill(skill) || !skill.content?.trim()) continue
    if (skill.content.length > MAX_SKILL_CHARS || skill.content.length > remaining) continue
    selected.push(id)
    present.add(id)
    remaining -= skill.content.length
  }
  return selected
}

/**
 * Only IDs selected by the runtime are rendered. Neither skill body nor
 * arbitrary catalog descriptions can inject tool instructions through here.
 */
export function renderAutoPersonalizationHints(
  selection: AutoPersonalizationSelection,
  attached: ReadonlyArray<string>,
): string {
  const lines = [
    "OnethyCode contextual personalizations (registered resource IDs; advisory):",
    ...(attached.length ? ["Automatically loaded skill attachments: " + attached.join(", ")] : []),
    ...(selection.skills.filter((id) => !attached.includes(id)).length
      ? ["Relevant skills available through the normal skill tool and its permissions: " +
          selection.skills.filter((id) => !attached.includes(id)).join(", ")]
      : []),
    ...(selection.agents.length
      ? ["Relevant specialist for useful delegation via subagent agent=auto: " + selection.agents.join(", ")]
      : []),
    ...(selection.commands.length
      ? ["Registered slash command references (do not invoke automatically): " + selection.commands.join(", ")]
      : []),
    ...(selection.mcpTools.length
      ? ["Already-connected MCP tool names (use only if needed and permitted): " + selection.mcpTools.join(", ")]
      : []),
    "Follow existing permissions and user intent. Recommendations do not authorize tools, connections, scripts or delegation.",
  ]
  return lines.length <= 2 ? "" : lines.join("\n")
}
