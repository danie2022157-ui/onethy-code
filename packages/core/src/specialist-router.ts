/**
 * Deterministic, no-token selection of an imported expert when the caller
 * explicitly delegates to agent=auto. Ambiguous tasks fail safely to general.
 */
type Candidate = { id: string; mode: string; description?: string; hidden?: boolean }

const COMMON = new Set([
  "agent", "agents", "specialist", "expert", "programming", "languages",
  "development", "developer", "engineering", "engineer", "assistant",
  "specialized", "pro", "senior", "the", "and", "for", "with", "from",
  "para", "como", "uma", "que", "com", "crie", "corrija", "faca", "quero",
  "create", "build", "fix", "work", "code", "using", "use", "app",
])
const words = (text: string): string[] =>
  (text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .match(/[a-z0-9]+/g) ?? [])
    .map((token) => token.endsWith("s") && token.length >= 4 ? token.slice(0, -1) : token)
    .filter((token) => token.length >= 3 && !COMMON.has(token))

export function chooseImportedSpecialist(task: string, agents: ReadonlyArray<Candidate>): string {
  const query = new Set(words(task.slice(0, 1800)))
  if (!query.size) return "general"
  const matches = agents.filter((agent) =>
    !agent.hidden && agent.mode !== "primary" &&
    (agent.id.includes("-") || agent.description?.startsWith("AITmpl specialist"))).map((agent) => {
    const specific = new Set(words(agent.id))
    const matchedID = [...specific].filter((token) => query.has(token)).length
    // Only the short *registered* description contributes a small tie-breaker.
    // Never scan system prompts or arbitrary content for routing instructions.
    const extra = new Set(words(agent.description?.slice(0, 320) ?? "")
      .filter((term) => !specific.has(term)))
    const matchedDescription = [...extra].filter((token) => query.has(token)).length
    const score = matchedID * 5 + Math.min(3, matchedDescription) * 2
    return { id: agent.id, score }
  }).filter((item) => item.score >= 5)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  const first = matches[0]
  if (!first || (matches[1] && first.score - matches[1].score < 2)) return "general"
  return first.id
}
