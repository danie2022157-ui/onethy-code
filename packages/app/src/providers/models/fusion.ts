import { batch } from "solid-js"
import { createStore } from "solid-js/store"
import {
  computeRecommendedFusionPreset,
  filterAllowedFusionModels,
  fusionModelKey,
  fusionTierLabel,
  pickFusionModel,
  routeFusionPrompt,
  type FusionCandidate,
  type FusionDecision,
  type FusionTier,
} from "@opencode/client/fusion"

const STORAGE_KEY = "onethy.fusion.v1"

interface PersistedFusionState {
  enabled: boolean
  tier: FusionTier
  thinkingRouting: boolean
  selectedModels?: string[]
}

interface FusionStoreState extends PersistedFusionState {
  lastDecision?: FusionDecision
}

function loadInitialState(): PersistedFusionState {
  const fallback: PersistedFusionState = {
    enabled: false,
    tier: "default",
    thinkingRouting: true,
    selectedModels: undefined,
  }

  if (typeof localStorage === "undefined") return fallback

  try {
    const raw = localStorage.getItem(STORAGE_KEY)

    if (!raw) return fallback

    const parsed = JSON.parse(raw) as Partial<PersistedFusionState>
    const tier: FusionTier =
      parsed.tier === "efficiency" || parsed.tier === "balanced" || parsed.tier === "intelligence"
        ? parsed.tier
        : "default"

    const selectedModels =
      Array.isArray(parsed.selectedModels) && parsed.selectedModels.every((item) => typeof item === "string")
        ? parsed.selectedModels.length > 0
          ? parsed.selectedModels
          : undefined
        : undefined

    return {
      enabled: parsed.enabled === true,
      tier,
      thinkingRouting: parsed.thinkingRouting !== false,
      selectedModels,
    }
  } catch {
    return fallback
  }
}

const [fusionStore, setFusionStore] = createStore<FusionStoreState>({
  ...loadInitialState(),
  lastDecision: undefined,
})

function persistState() {
  if (typeof localStorage === "undefined") return

  try {
    const payload: PersistedFusionState = {
      enabled: fusionStore.enabled,
      tier: fusionStore.tier,
      thinkingRouting: fusionStore.thinkingRouting,
      selectedModels: fusionStore.selectedModels,
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore storage quota or private browsing errors.
  }
}

export function useFusion() {
  return {
    enabled: () => fusionStore.enabled,
    tier: () => fusionStore.tier,
    thinkingRouting: () => fusionStore.thinkingRouting,
    selectedModels: () => fusionStore.selectedModels,
    lastDecision: () => fusionStore.lastDecision,

    tierLabel(tier?: FusionTier, locale?: string) {
      return fusionTierLabel(tier ?? fusionStore.tier, fusionStore.thinkingRouting, locale)
    },

    modeName(candidates: readonly FusionCandidate[]) {
      const allowed = filterAllowedFusionModels(candidates, fusionStore.selectedModels)

      return allowed.length >= 2 ? "Omni Fusion" : "Auto"
    },

    enable(tier?: FusionTier) {
      batch(() => {
        setFusionStore("enabled", true)

        if (tier !== undefined) setFusionStore("tier", tier)

        persistState()
      })
    },

    disable() {
      batch(() => {
        setFusionStore("enabled", false)
        persistState()
      })
    },

    toggleEnabled() {
      batch(() => {
        setFusionStore("enabled", !fusionStore.enabled)
        persistState()
      })
    },

    setTier(tier: FusionTier) {
      batch(() => {
        setFusionStore("enabled", true)
        setFusionStore("tier", tier)
        persistState()
      })
    },

    cycleTier() {
      const order: readonly FusionTier[] = ["default", "efficiency", "balanced", "intelligence"]
      const next = order[(order.indexOf(fusionStore.tier) + 1) % order.length] ?? "default"
      this.setTier(next)

      return next
    },

    setThinkingRouting(enabled: boolean) {
      batch(() => {
        setFusionStore("thinkingRouting", enabled)
        persistState()
      })
    },

    toggleThinkingRouting() {
      this.setThinkingRouting(!fusionStore.thinkingRouting)
    },

    isAllModelsAllowed(candidates: readonly FusionCandidate[]) {
      const selected = fusionStore.selectedModels

      if (!selected || selected.length === 0) return true

      return selected.length >= candidates.length
    },

    isModelAllowed(providerID: string, modelID: string) {
      const selected = fusionStore.selectedModels

      if (!selected || selected.length === 0) return true

      return selected.includes(fusionModelKey(providerID, modelID))
    },

    toggleModelAllowed(providerID: string, modelID: string, candidates: readonly FusionCandidate[]) {
      const key = fusionModelKey(providerID, modelID)

      batch(() => {
        const current = fusionStore.selectedModels

        if (!current || current.length === 0) {
          const next = candidates.map((m) => fusionModelKey(m.providerID, m.id)).filter((k) => k !== key)
          setFusionStore("selectedModels", next.length > 0 ? next : undefined)
          persistState()

          return
        }

        if (current.includes(key)) {
          const next = current.filter((k) => k !== key)
          setFusionStore("selectedModels", next.length > 0 ? next : undefined)
          persistState()

          return
        }

        const next = [...current, key]
        setFusionStore("selectedModels", next.length >= candidates.length ? undefined : next)
        persistState()
      })
    },

    toggleProviderModels(providerID: string, candidates: readonly FusionCandidate[]) {
      const provKeys = candidates
        .filter((m) => m.providerID === providerID)
        .map((m) => fusionModelKey(m.providerID, m.id))

      if (provKeys.length === 0) return

      const provSet = new Set(provKeys)

      batch(() => {
        const current =
          !fusionStore.selectedModels || fusionStore.selectedModels.length === 0
            ? candidates.map((m) => fusionModelKey(m.providerID, m.id))
            : [...fusionStore.selectedModels]

        const allProvSelected = provKeys.every((k) => current.includes(k))

        if (allProvSelected) {
          const next = current.filter((k) => !provSet.has(k))
          setFusionStore(
            "selectedModels",
            next.length > 0 ? next : provKeys.length >= candidates.length ? undefined : provKeys,
          )
        } else {
          const merged = Array.from(new Set([...current, ...provKeys]))
          setFusionStore("selectedModels", merged.length >= candidates.length ? undefined : merged)
        }

        persistState()
      })
    },

    setAllowAllModels() {
      batch(() => {
        setFusionStore("selectedModels", undefined)
        persistState()
      })
    },

    applyRecommendedPreset(candidates: readonly FusionCandidate[]) {
      const list = computeRecommendedFusionPreset(candidates)

      batch(() => {
        setFusionStore("selectedModels", list.length > 0 && list.length < candidates.length ? list : undefined)
        persistState()
      })

      return list
    },

    allowedSummary(candidates: readonly FusionCandidate[], locale = "en") {
      const pt = locale === "br" || locale.toLowerCase().startsWith("pt")

      if (this.isAllModelsAllowed(candidates)) {
        return pt ? `Todos os modelos (${candidates.length})` : `All models (${candidates.length})`
      }

      const allowed = filterAllowedFusionModels(candidates, fusionStore.selectedModels)

      return pt
        ? `${allowed.length} de ${candidates.length} selecionados`
        : `${allowed.length} of ${candidates.length} selected`
    },

    tierPool<T extends FusionCandidate>(
      candidates: readonly T[],
      prefs?: {
        readonly activeProviderID?: string
        readonly favorites?: ReadonlySet<string>
        readonly recents?: ReadonlySet<string>
      },
    ) {
      const allowed = filterAllowedFusionModels(candidates, fusionStore.selectedModels)

      return {
        efficiency: pickFusionModel(allowed, "efficiency", prefs),
        balanced: pickFusionModel(allowed, "balanced", prefs),
        intelligence: pickFusionModel(allowed, "intelligence", prefs),
      }
    },

    routeForPrompt<T extends FusionCandidate>(
      promptText: string,
      candidates: readonly T[],
      prefs?: {
        readonly activeProviderID?: string
        readonly favorites?: ReadonlySet<string>
        readonly recents?: ReadonlySet<string>
      },
    ) {
      const decision = routeFusionPrompt({
        promptText,
        candidates,
        selectedKeys: fusionStore.selectedModels,
        tier: fusionStore.tier,
        thinkingRouting: fusionStore.thinkingRouting,
        activeProviderID: prefs?.activeProviderID,
        favorites: prefs?.favorites,
        recents: prefs?.recents,
      })

      if (decision) setFusionStore("lastDecision", decision)

      return decision
    },
  }
}
