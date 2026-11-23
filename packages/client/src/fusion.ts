export type ModelBucket = "efficiency" | "balanced" | "intelligence"

export type FusionTier = "default" | "efficiency" | "balanced" | "intelligence"

export type PromptComplexity = "low" | "medium" | "high"

export interface FusionCandidate {
  readonly providerID: string
  readonly id: string
  readonly name: string
  readonly providerName?: string
  readonly variants?: readonly string[]
}

export interface FusionDecision {
  readonly complexity: PromptComplexity
  readonly tier: FusionTier
  readonly bucket: ModelBucket
  readonly providerID: string
  readonly modelID: string
  readonly modelName: string
  readonly thinking?: string
  readonly fusion: boolean
}

export function fusionModelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
}

export function classifyModelBucket(id: string, name: string): ModelBucket {
  const combined = `${id} ${name}`.toLowerCase()

  if (/(flash|mini|haiku|nano|lite|small|instant|fast|8b)/.test(combined)) return "efficiency"

  if (/(opus|gpt-6|gpt-5|luna|argon|zen-coder|o3|o1|pro|sonnet-4|claude-4|r1|reasoning|max|large)/.test(combined)) {
    return "intelligence"
  }

  return "balanced"
}

export function evaluatePromptComplexity(text: string): PromptComplexity {
  const trimmed = text.trim()

  if (
    trimmed.length > 450 ||
    /\b(arquitetura|architecture|security|seguran[cç]a|vulnerab|refator|refactor|ulw|ultrawork|arena|concorr[eê]ncia|race condition|performance|otimiz|migra[cç][aã]o|complex|deep|design)\b/i.test(
      trimmed,
    ) ||
    (trimmed.match(/@[a-zA-Z0-9_-]+/g)?.length ?? 0) >= 2
  ) {
    return "high"
  }

  if (
    trimmed.length < 120 &&
    !trimmed.includes("```") &&
    !/\b(bug|erro|error|fix|corrig|implement|test|crie|create|build)\b/i.test(trimmed)
  ) {
    return "low"
  }

  return "medium"
}

export function filterAllowedFusionModels<T extends FusionCandidate>(
  candidates: readonly T[],
  selectedKeys: readonly string[] | undefined,
): T[] {
  if (!selectedKeys || selectedKeys.length === 0) return [...candidates]
  const allowed = new Set(selectedKeys)
  const filtered = candidates.filter((item) => allowed.has(fusionModelKey(item.providerID, item.id)))

  return filtered.length > 0 ? filtered : [...candidates]
}

export function pickFusionModel<T extends FusionCandidate>(
  candidates: readonly T[],
  targetBucket: ModelBucket,
  prefs?: {
    readonly activeProviderID?: string
    readonly favorites?: ReadonlySet<string>
    readonly recents?: ReadonlySet<string>
  },
): T | undefined {
  if (candidates.length === 0) return undefined

  const fallbackOrder: readonly ModelBucket[] =
    targetBucket === "efficiency"
      ? ["efficiency", "balanced", "intelligence"]
      : targetBucket === "intelligence"
        ? ["intelligence", "balanced", "efficiency"]
        : ["balanced", "intelligence", "efficiency"]

  for (const bucket of fallbackOrder) {
    const inBucket = candidates.filter((item) => classifyModelBucket(item.id, item.name) === bucket)

    if (inBucket.length === 0) continue

    const favMatch = prefs?.favorites
      ? inBucket.find((item) => prefs.favorites?.has(fusionModelKey(item.providerID, item.id)))
      : undefined

    if (favMatch) return favMatch

    const sameProv = prefs?.activeProviderID
      ? inBucket.find((item) => item.providerID === prefs.activeProviderID)
      : undefined

    if (sameProv) return sameProv

    const recMatch = prefs?.recents
      ? inBucket.find((item) => prefs.recents?.has(fusionModelKey(item.providerID, item.id)))
      : undefined

    if (recMatch) return recMatch

    return inBucket[0]
  }

  return candidates[0]
}

export function computeRecommendedFusionPreset(candidates: readonly FusionCandidate[]): string[] {
  if (candidates.length === 0) return []
  const picked = new Set<string>()

  const findPreferred = (patterns: readonly RegExp[], fallbackBucket: ModelBucket) => {
    for (const pattern of patterns) {
      const match = candidates.find((item) =>
        pattern.test(`${item.providerID}/${item.id} ${item.name}`.toLowerCase()),
      )

      if (match) return fusionModelKey(match.providerID, match.id)
    }

    const byBucket = candidates.find(
      (item) => classifyModelBucket(item.id, item.name) === fallbackBucket && !picked.has(fusionModelKey(item.providerID, item.id)),
    )

    return byBucket ? fusionModelKey(byBucket.providerID, byBucket.id) : undefined
  }

  const fastKey = findPreferred([/gemini-3\.8-flash/, /sol-fast/, /flash/, /fast/, /mini/, /haiku/], "efficiency")

  if (fastKey) picked.add(fastKey)

  const smartKey = findPreferred(
    [/gpt-6-luna/, /gpt-5\.6-luna/, /gemini-4-argon/, /opus/, /sonnet/, /zen-coder/, /luna/, /argon/],
    "intelligence",
  )

  if (smartKey) picked.add(smartKey)

  const backupKey = findPreferred([/nemotron/, /codex/, /sol/, /free/], "balanced")

  if (backupKey) picked.add(backupKey)

  return Array.from(picked)
}

export function resolveThinkingVariant(
  complexity: PromptComplexity,
  availableVariants?: readonly string[],
): string | undefined {
  const desired = complexity === "low" ? "low" : complexity === "high" ? "max" : "medium"

  if (!availableVariants || availableVariants.length === 0) return undefined

  if (availableVariants.includes(desired)) return desired

  if (desired === "max") {
    const high = availableVariants.find((v) => v === "high" || v === "xhigh" || v === "max")

    if (high) return high
  }

  if (desired === "low") {
    const low = availableVariants.find((v) => v === "low" || v === "minimal" || v === "medium")

    if (low) return low
  }

  return availableVariants.includes("medium") ? "medium" : availableVariants[0]
}

export function routeFusionPrompt<T extends FusionCandidate>(input: {
  readonly promptText: string
  readonly candidates: readonly T[]
  readonly selectedKeys?: readonly string[]
  readonly tier: FusionTier
  readonly thinkingRouting: boolean
  readonly activeProviderID?: string
  readonly favorites?: ReadonlySet<string>
  readonly recents?: ReadonlySet<string>
}): FusionDecision | undefined {
  const available = filterAllowedFusionModels(input.candidates, input.selectedKeys)

  if (available.length === 0) return undefined

  const complexity: PromptComplexity = input.promptText.trim() ? evaluatePromptComplexity(input.promptText) : "medium"
  const targetBucket: ModelBucket =
    input.tier === "efficiency"
      ? "efficiency"
      : input.tier === "intelligence"
        ? "intelligence"
        : input.tier === "balanced"
          ? "balanced"
          : complexity === "low"
            ? "efficiency"
            : complexity === "high"
              ? "intelligence"
              : "balanced"

  const picked =
    pickFusionModel(available, targetBucket, {
      activeProviderID: input.activeProviderID,
      favorites: input.favorites,
      recents: input.recents,
    }) ?? available[0]

  if (!picked) return undefined

  const thinking = input.thinkingRouting ? resolveThinkingVariant(complexity, picked.variants) : undefined

  return {
    complexity,
    tier: input.tier,
    bucket: targetBucket,
    providerID: picked.providerID,
    modelID: picked.id,
    modelName: picked.name,
    thinking,
    fusion: available.length >= 2,
  }
}

export function fusionTierLabel(tier: FusionTier, thinkingRouting: boolean, locale = "en"): string {
  const pt = locale === "br" || locale.toLowerCase().startsWith("pt")
  const base =
    tier === "efficiency"
      ? pt
        ? "Eficiência"
        : "Efficiency"
      : tier === "intelligence"
        ? pt
          ? "Inteligência"
          : "Intelligence"
        : tier === "balanced"
          ? pt
            ? "Balanceado"
            : "Balanced"
          : "Auto"

  return thinkingRouting ? `${base} · Thinking` : base
}
