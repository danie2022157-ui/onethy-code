/**
 * Context-aware, deterministic and permission-limited personalization discovery.
 *
 * Recommendations are advisory, never permissions. The prompt hook can attach
 * skills already approved for this agent/session, without running third-party
 * scripts or enabling other extensions.
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

// No fixed number of skills per prompt. These limits bound context and the
// metadata/search cost; how many fit depends on their actual content.
export const AUTO_SKILL_MAX_CHARS = 16_000
export const AUTO_SKILL_MAX_BUDGET_CHARS = 60_000
export const AUTO_SKILL_FALLBACK_CONTEXT_TOKENS = 32_000
export const AUTO_SKILL_MAX_CANDIDATES = 96
const SKILL_OVERHEAD_CHARS = 400
const CHARS_PER_TOKEN = 4

export interface AutoSkillBudgetOptions {
  readonly prompt?: string
  readonly contextTokens?: number
  /** Other context explicitly attached by the user (in approximate chars). */
  readonly reservedChars?: number
}

export function isExecutableSkill(candidate: SkillCandidate): boolean {
  if (candidate.autoinvoke === false) return false
  const id = candidate.id.toLowerCase()
  if (/^(?:hook|mod|setting|plugin)-/.test(id)) return false
  const file = candidate.path?.replaceAll("\\", "/").toLowerCase() ?? ""
  return !/(?:^|\/)(?:hooks|mods|plugins|settings)(?:\/|$)/.test(file)
}

const meaningfulWords = (text: string) =>
  [...new Set(tokenize(text.slice(0, 3_000))
    .filter((word) => word.length >= 3 && !STOP.has(word)))]

/**
 * Reserve a small adaptive fraction of the known model context for new skills.
 * This is a conservative estimate, not a claim of the model's exact free tokens:
 * chat history and other instructions are not fully measurable at prompt time.
 */
export function autoSkillContextBudget(
  options: AutoSkillBudgetOptions = {},
  matches = 0,
): number {
  const known = options.contextTokens
  const context = typeof known === "number" && Number.isFinite(known) && known > 0
    ? known : AUTO_SKILL_FALLBACK_CONTEXT_TOKENS
  const breadth = meaningfulWords(options.prompt ?? "").length
  const complexity = Math.min(1, breadth / 18 + Math.min(matches, 12) / 20)
  const fraction = 0.35 + complexity * 0.65
  const tentative = Math.floor(context * CHARS_PER_TOKEN * 0.10 * fraction)
  const budget = Math.max(0, Math.min(AUTO_SKILL_MAX_BUDGET_CHARS, tentative))
  return Math.max(0, budget - Math.max(0, options.reservedChars ?? 0))
}

function ranked(query: string, candidates: ReadonlyArray<Candidate>, limit: number): string[] {
  if (!query || limit < 1) return []
  const scored = candidates
    .map((candidate) => ({
      id: candidate.id,
      score: relevance(query, candidate.id, (candidate.description ?? "").slice(0, 400)),
    }))
    .filter((candidate) => candidate.score >= 7)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  const best = scored[0]?.score ?? 0
  // A weak single-token overlap should not flood the prompt when better
  // matches exist. The threshold varies with the quality of the best match.
  const cutoff = Math.max(7, best * 0.45)
  return scored.filter((entry) => entry.score >= cutoff)
    .slice(0, limit).map((entry) => entry.id)
}

export function selectAutoPersonalizations(
  prompt: string,
  catalog: AutoPersonalizationCatalog,
): AutoPersonalizationSelection {
  const query = meaningfulWords(prompt.slice(0, 1_800)).slice(0, 24).join(" ")
  if (!query) return { skills: [], agents: [], commands: [], mcpTools: [] }
  const skills = ranked(query, catalog.skills.filter(isExecutableSkill), AUTO_SKILL_MAX_CANDIDATES)
  const specialist = chooseImportedSpecialist(prompt, catalog.agents)
  return {
    skills,
    agents: specialist === "general" ? [] : [specialist],
    commands: ranked(query, catalog.commands, 2),
    mcpTools: ranked(query, catalog.mcpTools, 3),
  }
}

function traits(candidate: SkillCandidate): Set<string> {
  // Only stable registry metadata is considered; never read instructions to
  // decide whether a skill may be loaded or to select future tools.
  return new Set(meaningfulWords(candidate.id + " " + (candidate.description ?? "").slice(0, 180)))
}

function nearDuplicate(first: SkillCandidate, second: SkillCandidate): boolean {
  const a = traits(first)
  const b = traits(second)
  if (a.size < 3 || b.size < 3) return false
  const common = [...a].filter((word) => b.has(word)).length
  const union = a.size + b.size - common
  return union > 0 && common / union >= 0.85
}

/**
 * Greedily pack distinct, relevant and explicitly allowed skills into the
 * available context budget. No fixed skill count. A large skill that does not
 * fit is skipped so smaller useful ones can still load.
 */
export function selectAllowedSkillAttachments(
  ids: ReadonlyArray<string>,
  skills: ReadonlyArray<SkillCandidate>,
  isAllowed: (id: string) => boolean,
  existing: ReadonlyArray<string> = [],
  options: AutoSkillBudgetOptions = {},
): string[] {
  const present = new Set(existing)
  const byID = new Map(skills.map((skill) => [skill.id, skill]))
  const budget = autoSkillContextBudget(options, ids.length)
  const explicitUsed = existing.reduce((total, id) => {
    const content = byID.get(id)?.content
    return total + (content ? content.length + SKILL_OVERHEAD_CHARS : 0)
  }, 0)
  let remaining = Math.max(0, budget - explicitUsed)
  const selected: string[] = []
  const selectedSkills: SkillCandidate[] = existing.flatMap((id) => byID.get(id) ?? [])
  for (const id of ids) {
    if (present.has(id) || !isAllowed(id)) continue
    const skill = byID.get(id)
    if (!skill || !isExecutableSkill(skill) || !skill.content?.trim()) continue
    const size = skill.content.length + SKILL_OVERHEAD_CHARS
    if (size > AUTO_SKILL_MAX_CHARS || size > remaining) continue
    if (selectedSkills.some((other) => nearDuplicate(skill, other))) continue
    selected.push(id)
    selectedSkills.push(skill)
    present.add(id)
    remaining -= size
  }
  return selected
}

/** Only known registry IDs are rendered, never untrusted skill body content. */
export function renderAutoPersonalizationHints(
  selection: AutoPersonalizationSelection,
  attached: ReadonlyArray<string>,
): string {
  const notAttached = selection.skills.filter((id) => !attached.includes(id))
  const lines = [
    "OnethyCode contextual personalizations (registered resource IDs; advisory):",
    ...(attached.length ? ["Automatically loaded skill attachments: " + attached.join(", ")] : []),
    ...(notAttached.length
      ? ["Relevant skills available through the normal skill tool and its permissions: " + notAttached.slice(0, 12).join(", ") +
          (notAttached.length > 12 ? " (and additional registered skills)" : "")]
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
