import { createStore } from "solid-js/store"
import { dedupeWith } from "effect/Array"
import { createSimpleContext } from "./helper"
import { batch, createMemo, onCleanup } from "solid-js"
import { useEvent } from "./event"
import path from "path"
import { useTuiPaths } from "./runtime"
import { useArgs } from "./args"
import { RGBA } from "@opentui/core"
import { readJson, writeJsonAtomic } from "../util/persistence"
import {
  createModelPreferenceRepository,
  cycleModelVariant,
  favoriteModels,
  modelPreferenceKey,
  normalizeModelVariant,
  recentModels,
  type ModelPreference,
  type ModelPreferenceModel,
} from "../model-preference"
import { useTheme } from "./theme"
import { useNewDesigns } from "../config"
import { useToast } from "../ui/toast"
import { useRoute } from "./route"
import { useData } from "./data"
import { usePermission } from "./permission"
import { useLocation } from "./location"
import { parse } from "../util/model"

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const data = useData()
    const toast = useToast()
    const theme = useTheme()
    const newDesigns = useNewDesigns()
    const route = useRoute()
    const paths = useTuiPaths()
    const args = useArgs()
    const event = useEvent()
    const permission = usePermission()
    const location = useLocation()

    const models = () => data.location.model.list(location.ref)
    const providers = () => data.location.provider.list(location.ref)

    function isModelValid(model: ModelPreferenceModel) {
      return !!models()?.some((item) => item.providerID === model.providerID && item.id === model.modelID)
    }

    function getFirstValidModel(...modelFns: (() => ModelPreferenceModel | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (model && isModelValid(model)) return model
      }
    }

    function createAgent() {
      const agents = createMemo(() =>
        (data.location.agent.list(location.ref) ?? []).filter((agent) => agent.mode !== "subagent" && !agent.hidden),
      )
      const visibleAgents = createMemo(() =>
        (data.location.agent.list(location.ref) ?? []).filter((agent) => !agent.hidden),
      )
      const [agentStore, setAgentStore] = createStore({
        current: undefined as string | undefined,
        draftBySession: {} as Record<string, { agent?: string } | undefined>,
      })
      onCleanup(event.on("session.deleted", (evt) => setAgentStore("draftBySession", evt.data.sessionID, undefined)))
      onCleanup(
        event.on("session.agent.selected", (evt) => {
          // Keep an entry after acknowledgment: CLI defaults must not override a user's later choice.
          if (agentStore.draftBySession[evt.data.sessionID]?.agent === evt.data.agent)
            setAgentStore("draftBySession", evt.data.sessionID, { agent: undefined })
        }),
      )
      const colors = createMemo(() => {
        // The new designs palette keeps its vivid accent at 400; 200 there is a muted tint.
        const step = newDesigns() ? 400 : 200
        return dedupeWith(
          theme.categorical.map((scale) => scale[step]),
          (first, second) => first.equals(second),
        )
      })
      return {
        list() {
          return agents()
        },
        all() {
          return visibleAgents()
        },
        current() {
          const draft = route.data.type === "session" ? agentStore.draftBySession[route.data.sessionID] : undefined
          const selected =
            route.data.type === "session"
              ? (draft?.agent ??
                (draft ? undefined : args.agent) ??
                data.session.get(route.data.sessionID)?.agent ??
                agentStore.current)
              : agentStore.current
          const defaultOmni = process.env.OMNICODE_ACTIVE === "1" ? "omni" : undefined
          return visibleAgents().find((agent) => agent.id === (selected ?? defaultOmni)) ?? agents().find((agent) => agent.id === defaultOmni) ?? agents().at(0)
        },
        set(id: string) {
          if (!visibleAgents().some((agent) => agent.id === id))
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${id}`,
              duration: 3000,
            })
          batch(() => {
            const changed = this.current()?.id !== id
            if (changed) model.remember()
            setAgentStore("current", id)
            if (route.data.type === "session") setAgentStore("draftBySession", route.data.sessionID, { agent: id })
            // Retain both selections while agent and model commits arrive separately.
            const selected = changed && route.data.type === "session" ? model.current() : undefined
            if (selected) model.set(selected)
          })
        },
        move(direction: 1 | -1) {
          batch(() => {
            const current = this.current()
            if (!current) return
            let next = agents().findIndex((agent) => agent.id === current.id) + direction
            if (next < 0) next = agents().length - 1
            if (next >= agents().length) next = 0
            const value = agents()[next]
            this.set(value.id)
          })
        },
        color(id: string) {
          const index = visibleAgents().findIndex((agent) => agent.id === id)
          if (index === -1) return colors()[0]
          const agent = visibleAgents()[index]

          if (agent?.color) return RGBA.fromHex(agent.color)
          return colors()[index % colors().length]
        },
      }
    }

    const agent = createAgent()

    function createModel() {
      type ModelSelection = ModelPreferenceModel & { variant?: string }
      const [preferences, setPreferences] = createStore<ModelPreference & { ready: boolean }>({
        ready: false,
        recent: [],
        favorite: [],
        variant: {},
      })
      const [selectionState, setSelectionState] = createStore<{
        newSessionModelByLocationAgent: Record<string, ModelPreferenceModel | undefined>
        selectionBySessionAgent: Record<string, Record<string, ModelSelection | undefined> | undefined>
      }>({
        newSessionModelByLocationAgent: {},
        selectionBySessionAgent: {},
      })

      const repository = createModelPreferenceRepository(path.join(paths.state, "model.json"))
      const autoFilePath = path.join(paths.state, "auto-model.json")
      const [autoStore, setAutoStore] = createStore<{
        enabled: boolean
        explicitTier: "efficiency" | "balanced" | "intelligence" | undefined
        managedDefaultTier: "efficiency" | "balanced" | "intelligence"
        selectedModels: string[] | undefined
        thinkingRouting: boolean
        cooldowns: Record<string, number>
        autoCustomizations: {
          enabled: boolean
          useSkills: boolean
          useAgents: boolean
          useMcps: boolean
          useHooks: boolean
          useMods: boolean
          useCommands: boolean
          useSettings: boolean
        }
        lastDecision:
          | {
              complexity: "low" | "medium" | "high"
              tier: "efficiency" | "balanced" | "intelligence"
              providerID: string
              modelID: string
              modelName: string
              thinking?: string
              fusion: boolean
            }
          | undefined
      }>({
        enabled: true,
        explicitTier: "balanced",
        managedDefaultTier: "balanced",
        selectedModels: undefined,
        thinkingRouting: true,
        cooldowns: {},
        autoCustomizations: {
          enabled: true,
          useSkills: true,
          useAgents: true,
          useMcps: true,
          useHooks: true,
          useMods: true,
          useCommands: true,
          useSettings: true,
        },
        lastDecision: undefined,
      })

      function syncAllowedModelsEnv() {
        if (autoStore.selectedModels && autoStore.selectedModels.length > 0) {
          process.env.OMNICODE_ALLOWED_MODELS = JSON.stringify(autoStore.selectedModels)
        } else {
          delete process.env.OMNICODE_ALLOWED_MODELS
        }
        process.env.OMNICODE_THINKING_ROUTING = autoStore.thinkingRouting ? "1" : "0"
        process.env.OMNICODE_OPTIMIZE_TIER = autoStore.explicitTier ?? autoStore.managedDefaultTier
        process.env.OMNICODE_AUTO_CUSTOMIZATIONS = JSON.stringify(autoStore.autoCustomizations)
      }

      function saveAutoStore() {
        void writeJsonAtomic(autoFilePath, {
          enabled: autoStore.enabled,
          explicitTier: autoStore.explicitTier,
          selectedModels: autoStore.selectedModels,
          thinkingRouting: autoStore.thinkingRouting,
          cooldowns: autoStore.cooldowns,
          autoCustomizations: autoStore.autoCustomizations,
        }).catch(() => undefined)
        syncAllowedModelsEnv()
      }

      readJson<Record<string, unknown>>(autoFilePath)
        .then((saved) => {
          if (!saved || typeof saved !== "object") {
            syncAllowedModelsEnv()
            return
          }
          batch(() => {
            if (typeof saved.enabled === "boolean") setAutoStore("enabled", saved.enabled)
            if (
              saved.explicitTier === "efficiency" ||
              saved.explicitTier === "balanced" ||
              saved.explicitTier === "intelligence"
            ) {
              setAutoStore("explicitTier", saved.explicitTier)
              process.env.OMNICODE_OPTIMIZE_TIER = saved.explicitTier
            }
            if (Array.isArray(saved.selectedModels) && saved.selectedModels.every((x) => typeof x === "string")) {
              setAutoStore("selectedModels", saved.selectedModels as string[])
            }
            if (typeof saved.thinkingRouting === "boolean") {
              setAutoStore("thinkingRouting", saved.thinkingRouting)
            }
            if (saved.cooldowns && typeof saved.cooldowns === "object") {
              const now = Date.now()
              const active: Record<string, number> = {}
              for (const [k, v] of Object.entries(saved.cooldowns as Record<string, unknown>)) {
                if (typeof v === "number" && v > now) active[k] = v
              }
              setAutoStore("cooldowns", active)
            }
            if (saved.autoCustomizations && typeof saved.autoCustomizations === "object") {
              const c = saved.autoCustomizations as Record<string, unknown>
              setAutoStore("autoCustomizations", {
                enabled: typeof c.enabled === "boolean" ? c.enabled : true,
                useSkills: typeof c.useSkills === "boolean" ? c.useSkills : true,
                useAgents: typeof c.useAgents === "boolean" ? c.useAgents : true,
                useMcps: typeof c.useMcps === "boolean" ? c.useMcps : true,
                useHooks: typeof c.useHooks === "boolean" ? c.useHooks : true,
                useMods: typeof c.useMods === "boolean" ? c.useMods : true,
                useCommands: typeof c.useCommands === "boolean" ? c.useCommands : true,
                useSettings: typeof c.useSettings === "boolean" ? c.useSettings : true,
              })
            }
          })
          syncAllowedModelsEnv()
        })
        .catch(() => undefined)

      function classifyModelBucket(id: string, name: string): "efficiency" | "balanced" | "intelligence" {
        const combined = `${id} ${name}`.toLowerCase()
        if (/(flash|mini|haiku|nano|lite|small|instant|fast|8b)/.test(combined)) return "efficiency"
        if (
          /(opus|gpt-6|gpt-5|luna|argon|zen-coder|o3|o1|pro|sonnet-4|claude-4|r1|reasoning|max|large)/.test(combined)
        )
          return "intelligence"
        return "balanced"
      }

      function evaluatePromptComplexity(text: string): "low" | "medium" | "high" {
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

      function tierLabelText(tier: "default" | "efficiency" | "balanced" | "intelligence"): string {
        const base =
          tier === "efficiency" ? "Eficiência" : tier === "intelligence" ? "Inteligente" : tier === "balanced" ? "Balanceado" : "Modo Auto"
        return autoStore.thinkingRouting ? `${base} · 🧠 Thinking` : base
      }

      function autoVariantValue(tier: "default" | "efficiency" | "balanced" | "intelligence"): string {
        if (tier === "efficiency") return "eficiência"
        if (tier === "balanced") return "balanceado"
        if (tier === "intelligence") return "inteligente"
        return "modo auto"
      }
      const pendingSelectionCommits = new Map<string, { agentID: string; selection: string }>()
      const selectionKey = (value: ModelSelection) =>
        `${modelPreferenceKey(value)}:${normalizeModelVariant(value.variant) ?? "default"}`

      function applyPreferences(value: ModelPreference) {
        batch(() => {
          setPreferences("recent", value.recent)
          setPreferences("favorite", value.favorite)
          setPreferences("variant", value.variant)
          setPreferences("ready", true)
        })
      }

      onCleanup(repository.subscribe(applyPreferences))

      const configuredModel = createMemo(() => {
        const entry = data.location.config
          .list(location.ref)
          ?.findLast((entry) => entry.type === "document" && entry.info.model !== undefined)
        const configured = entry?.type === "document" ? entry.info.model : undefined
        if (!configured) return
        return typeof configured === "string"
          ? { ...parse(configured), variant: undefined }
          : { providerID: configured.providerID, modelID: configured.model, variant: configured.variant }
      })

      const fallbackModel = createMemo(() => {
        if (args.model) {
          const { providerID, modelID } = parse(args.model)
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        const configured = configuredModel()
        if (configured && isModelValid(configured)) return configured

        for (const item of preferences.recent) {
          if (isModelValid(item)) {
            return item
          }
        }

        const model = models()?.[0]
        if (!model) return undefined
        return {
          providerID: model.providerID,
          modelID: model.id,
        }
      })

      const newSessionModel = createMemo(() => {
        const a = agent.current()
        return getFirstValidModel(
          () => a && selectionState.newSessionModelByLocationAgent[locationAgentKey(a.id)],
          () => a?.model && { providerID: a.model.providerID, modelID: a.model.id },
          fallbackModel,
        )
      })

      const currentSelection = createMemo<ModelSelection | undefined>(() => {
        if (route.data.type === "session") return sessionSelection(route.data.sessionID)
        const model = newSessionModel()
        if (!model) return
        return preferredSelection(model)
      })

      const currentModel = createMemo(() => {
        const selection = currentSelection()
        if (!selection) return
        return { providerID: selection.providerID, modelID: selection.modelID }
      })

      function locationAgentKey(agentID: string) {
        const ref = location.ref ?? data.location.default()
        return `${JSON.stringify([ref.directory, ref.workspaceID])}:${agentID}`
      }

      function resolveMatchingVariant(variants: string[] | undefined, targetLevel: string): string | undefined {
        if (!variants || variants.length === 0) return undefined
        if (targetLevel === "low") {
          return variants.find((v) => /(low|none|off|1k|fast)/i.test(v)) ?? variants[0]
        }
        if (targetLevel === "max" || targetLevel === "high") {
          return variants.find((v) => /(max|xhigh|32k|high)/i.test(v)) ?? variants[variants.length - 1]
        }
        return variants.find((v) => /(medium|mid|8k|high)/i.test(v)) ?? variants[Math.floor(variants.length / 2)]
      }

      function preferredSelection(model: ModelPreferenceModel, explicitVariant?: string): ModelSelection {
        const configured = agent.current()?.model
        const fallback = configuredModel()
        const preferred = preferences.variant[modelPreferenceKey(model)]
        const info = models()?.find((item) => item.providerID === model.providerID && item.id === model.modelID)
        const matched = explicitVariant
          ? resolveMatchingVariant(info?.variants.map((v) => v.id), explicitVariant)
          : undefined
        const variant = normalizeModelVariant(
          matched ??
          preferred ??
            (configured?.providerID === model.providerID && configured.id === model.modelID
              ? configured.variant
              : undefined) ??
            (fallback?.providerID === model.providerID && fallback.modelID === model.modelID
              ? fallback.variant
              : undefined),
        )
        return { ...model, variant: info?.variants.some((item) => item.id === variant) ? variant : undefined }
      }

      function durableSelection(sessionID: string): ModelSelection | undefined {
        const model = data.session.get(sessionID)?.model
        if (!model) return
        return {
          providerID: model.providerID,
          modelID: model.id,
          variant: normalizeModelVariant(model.variant),
        }
      }

      function sessionSelection(sessionID: string) {
        const current = agent.current()
        if (!current) return
        const session = data.session.get(sessionID)
        const selected =
          selectionState.selectionBySessionAgent[sessionID]?.[current.id] ??
          (!session?.agent || session.agent === current.id ? durableSelection(sessionID) : undefined)
        if (selected) {
          const info = models()?.find((item) => item.providerID === selected.providerID && item.id === selected.modelID)
          return {
            ...selected,
            variant:
              !info || info.variants.some((variant) => variant.id === selected.variant) ? selected.variant : undefined,
          }
        }
        const model = newSessionModel()
        return model && preferredSelection(model)
      }

      function setSessionSelection(sessionID: string, agentID: string, selection: ModelSelection | undefined) {
        setSelectionState("selectionBySessionAgent", sessionID, {
          ...selectionState.selectionBySessionAgent[sessionID],
          [agentID]: selection,
        })
      }

      function setSessionDraft(sessionID: string, selection: ModelSelection) {
        const current = agent.current()
        if (!current) return
        const durable = durableSelection(sessionID)
        const session = data.session.get(sessionID)
        setSessionSelection(
          sessionID,
          current.id,
          (!session?.agent || session.agent === current.id) &&
            durable &&
            selectionKey(durable) === selectionKey(selection)
            ? undefined
            : selection,
        )
      }

      function selectModel(model: ModelPreferenceModel, explicitVariant?: string) {
        if (route.data.type === "session") {
          const sessionID = route.data.sessionID
          const current = sessionSelection(sessionID)
          setSessionDraft(
            sessionID,
            current?.providerID === model.providerID && current.modelID === model.modelID && !explicitVariant
              ? current
              : preferredSelection(model, explicitVariant),
          )
          return true
        }
        const current = agent.current()
        if (!current) return false
        setSelectionState("newSessionModelByLocationAgent", locationAgentKey(current.id), model)
        return true
      }

      function reconcileSessionSelection(sessionID: string) {
        const expected = pendingSelectionCommits.get(sessionID)
        const durable = durableSelection(sessionID)
        if (!expected || !durable || data.session.get(sessionID)?.agent !== expected.agentID) return
        if (selectionKey(durable) !== expected.selection) return
        pendingSelectionCommits.delete(sessionID)
        // Inactive agents keep their remembered choices after another agent commits.
        if (
          route.data.type !== "session" ||
          route.data.sessionID !== sessionID ||
          agent.current()?.id !== expected.agentID
        )
          return
        const draft = selectionState.selectionBySessionAgent[sessionID]?.[expected.agentID]
        if (draft && selectionKey(draft) === expected.selection)
          setSessionSelection(sessionID, expected.agentID, undefined)
      }

      onCleanup(event.on("session.model.selected", (evt) => reconcileSessionSelection(evt.data.sessionID)))
      onCleanup(event.on("session.agent.selected", (evt) => reconcileSessionSelection(evt.data.sessionID)))

      onCleanup(
        event.on("session.deleted", (evt) => {
          pendingSelectionCommits.delete(evt.data.sessionID)
          setSelectionState("selectionBySessionAgent", evt.data.sessionID, undefined)
        }),
      )

      return {
        current: currentModel,
        selection: currentSelection,
        remember() {
          const current = agent.current()
          const selection = currentSelection()
          if (route.data.type !== "session" || !current || !selection) return
          setSessionSelection(route.data.sessionID, current.id, { ...selection })
        },
        available(model = currentModel()) {
          return model ? isModelValid(model) : false
        },
        trackSessionCommit(
          sessionID: string,
          value: {
            providerID: string
            id: string
            variant?: string
          },
          agentID: string,
        ) {
          const committed = {
            agentID,
            selection: selectionKey({ providerID: value.providerID, modelID: value.id, variant: value.variant }),
          }
          pendingSelectionCommits.set(sessionID, committed)
          // An unchanged model emits no event; the agent may be the only durable change.
          reconcileSessionSelection(sessionID)
          return () => {
            if (pendingSelectionCommits.get(sessionID) === committed) pendingSelectionCommits.delete(sessionID)
          }
        },
        get ready() {
          return preferences.ready
        },
        get catalogReady() {
          return models() !== undefined
        },
        recent() {
          return preferences.recent
        },
        favorite() {
          return preferences.favorite
        },
        parsed: createMemo(() => {
          const value = currentSelection()
          if (!value) {
            return {
              provider: "Connect a provider",
              model: "No provider selected",
              reasoning: false,
            }
          }
          const provider = providers()?.find((item) => item.id === value.providerID)
          const info = models()?.find((item) => item.providerID === value.providerID && item.id === value.modelID)
          const baseModelName = info?.name ?? `${value.modelID} (unavailable)`
          const availableCount = (models() ?? []).filter((m) => m.status !== "deprecated").length
          const modeTitle = availableCount >= 2 ? "Omni Fusion" : "Auto"
          return {
            provider: provider?.name ?? value.providerID,
            model: autoStore.enabled ? `⚡ ${modeTitle} → ${baseModelName}` : baseModelName,
            reasoning: autoStore.enabled ? true : (info?.variants?.length ?? 0) !== 0,
          }
        }),
        cycle(direction: 1 | -1) {
          const current = currentSelection()
          if (!current) return
          const recent = preferences.recent.filter(isModelValid)
          const index = recent.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          let next = index === -1 ? (direction === 1 ? 0 : recent.length - 1) : index + direction
          if (next < 0) next = recent.length - 1
          if (next >= recent.length) next = 0
          const val = recent[next]
          if (!val) return
          selectModel({ ...val })
        },
        cycleFavorite(direction: 1 | -1) {
          const favorites = preferences.favorite.filter((item) => isModelValid(item))
          if (!favorites.length) {
            toast.show({
              variant: "info",
              message: "Add a favorite model to use this shortcut",
              duration: 3000,
            })
            return
          }
          const current = currentSelection()
          let index = -1
          if (current) {
            index = favorites.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          }
          if (index === -1) {
            index = direction === 1 ? 0 : favorites.length - 1
          } else {
            index += direction
            if (index < 0) index = favorites.length - 1
            if (index >= favorites.length) index = 0
          }
          const next = favorites[index]
          if (!next) return
          if (!selectModel({ ...next })) return
          setPreferences("recent", recentModels(next, preferences.recent))
          void repository.addRecent(next).catch(() => undefined)
        },
        set(model: { providerID: string; modelID: string }, options?: { recent?: boolean; fromAuto?: boolean }) {
          batch(() => {
            if (!isModelValid(model)) return
            if (!options?.fromAuto && autoStore.enabled) {
              setAutoStore("enabled", false)
              saveAutoStore()
            }
            if (!selectModel(model)) return
            if (options?.recent) {
              setPreferences("recent", recentModels(model, preferences.recent))
              void repository.addRecent(model).catch(() => undefined)
            }
          })
        },
        auto: {
          enabled() {
            return autoStore.enabled
          },
          connectedProviders() {
            const integrations = data.location.integration.list(location.ref) ?? []
            const connectedIntegrationIDs = new Set(
              integrations.filter((item) => item.connections.length > 0).map((item) => item.id),
            )
            const provList = providers() ?? []
            const activeModels = (models() ?? []).filter((m) => m.status !== "deprecated")
            const provWithModels = new Set(activeModels.map((m) => m.providerID))
            const connected = provList.filter(
              (p) =>
                provWithModels.has(p.id) &&
                (connectedIntegrationIDs.has(p.integrationID ?? p.id) || p.id === "opencode"),
            )
            if (connected.length > 0) return connected
            return provList.filter((p) => provWithModels.has(p.id))
          },
          rawConnectedModels() {
            const activeModels = (models() ?? []).filter((m) => m.status !== "deprecated")
            const connProvs = new Set(this.connectedProviders().map((p) => p.id))
            const filtered = activeModels.filter((m) => connProvs.has(m.providerID))
            return filtered.length > 0 ? filtered : activeModels
          },
          connectedModels() {
            const raw = this.rawConnectedModels()
            const allowed =
              !autoStore.selectedModels || autoStore.selectedModels.length === 0
                ? raw
                : (() => {
                    const set = new Set(autoStore.selectedModels)
                    const f = raw.filter((m) => set.has(`${m.providerID}/${m.id}`))
                    return f.length > 0 ? f : raw
                  })()
            const now = Date.now()
            const healthy = allowed.filter((m) => {
              const until = autoStore.cooldowns[`${m.providerID}/${m.id}`]
              return !until || until <= now
            })
            return healthy.length > 0 ? healthy : allowed
          },
          isModelInCooldown(providerID: string, modelID: string): boolean {
            const until = autoStore.cooldowns[`${providerID}/${modelID}`]
            return typeof until === "number" && until > Date.now()
          },
          markCooldown(providerID: string, modelID: string, durationMs = 5 * 60_000) {
            batch(() => {
              setAutoStore("cooldowns", `${providerID}/${modelID}`, Date.now() + durationMs)
              saveAutoStore()
            })
          },
          clearCooldowns() {
            batch(() => {
              setAutoStore("cooldowns", {})
              saveAutoStore()
            })
          },
          selectedModels(): string[] | undefined {
            return autoStore.selectedModels
          },
          isModelAllowed(providerID: string, modelID: string): boolean {
            if (!autoStore.selectedModels || autoStore.selectedModels.length === 0) return true
            return autoStore.selectedModels.includes(`${providerID}/${modelID}`)
          },
          isAllModelsAllowed(): boolean {
            const raw = this.rawConnectedModels()
            if (!autoStore.selectedModels || autoStore.selectedModels.length === 0) return true
            return autoStore.selectedModels.length >= raw.length
          },
          toggleModelAllowed(providerID: string, modelID: string) {
            const raw = this.rawConnectedModels()
            const key = `${providerID}/${modelID}`
            batch(() => {
              if (!autoStore.selectedModels || autoStore.selectedModels.length === 0) {
                const next = raw.map((m) => `${m.providerID}/${m.id}`).filter((k) => k !== key)
                setAutoStore("selectedModels", next.length > 0 ? next : undefined)
              } else {
                const current = autoStore.selectedModels
                if (current.includes(key)) {
                  const next = current.filter((k) => k !== key)
                  setAutoStore("selectedModels", next.length > 0 ? next : undefined)
                } else {
                  const next = [...current, key]
                  if (next.length >= raw.length) {
                    setAutoStore("selectedModels", undefined)
                  } else {
                    setAutoStore("selectedModels", next)
                  }
                }
              }
              saveAutoStore()
            })
          },
          setAllowAllModels() {
            batch(() => {
              setAutoStore("selectedModels", undefined)
              saveAutoStore()
            })
          },
          toggleProviderModels(providerID: string) {
            const raw = this.rawConnectedModels()
            const provKeys = raw.filter((m) => m.providerID === providerID).map((m) => `${m.providerID}/${m.id}`)
            if (provKeys.length === 0) return
            const provSet = new Set(provKeys)
            batch(() => {
              const current =
                !autoStore.selectedModels || autoStore.selectedModels.length === 0
                  ? raw.map((m) => `${m.providerID}/${m.id}`)
                  : [...autoStore.selectedModels]
              const allProvSelected = provKeys.every((k) => current.includes(k))
              if (allProvSelected) {
                const next = current.filter((k) => !provSet.has(k))
                // If unchecking this provider leaves at least 1 model, apply it; otherwise select ONLY this provider
                if (next.length > 0) {
                  setAutoStore("selectedModels", next)
                } else {
                  setAutoStore("selectedModels", provKeys.length >= raw.length ? undefined : provKeys)
                }
              } else {
                const merged = Array.from(new Set([...current, ...provKeys]))
                setAutoStore("selectedModels", merged.length >= raw.length ? undefined : merged)
              }
              saveAutoStore()
            })
          },
          applyRecommendedPreset() {
            const raw = this.rawConnectedModels()
            if (raw.length === 0) return
            const picked = new Set<string>()
            const findPreferred = (patterns: RegExp[], fallbackBucket: "efficiency" | "balanced" | "intelligence") => {
              for (const pat of patterns) {
                const match = raw.find((m) => pat.test(`${m.providerID}/${m.id} ${m.name}`.toLowerCase()))
                if (match) return `${match.providerID}/${match.id}`
              }
              const byBucket = raw.find(
                (m) => classifyModelBucket(m.id, m.name) === fallbackBucket && !picked.has(`${m.providerID}/${m.id}`),
              )
              return byBucket ? `${byBucket.providerID}/${byBucket.id}` : undefined
            }
            const fastKey = findPreferred([/gemini-3\.8-flash/, /sol-fast/, /flash/, /fast/, /mini/], "efficiency")
            if (fastKey) picked.add(fastKey)
            const smartKey = findPreferred(
              [/gpt-6-luna/, /gpt-5\.6-luna/, /gemini-4-argon/, /sonnet/, /zen-coder/, /luna/, /argon/],
              "intelligence",
            )
            if (smartKey) picked.add(smartKey)
            const backupKey = findPreferred([/nemotron/, /codex/, /sol/, /free/], "balanced")
            if (backupKey) picked.add(backupKey)
            const list = Array.from(picked)
            batch(() => {
              setAutoStore("selectedModels", list.length > 0 && list.length < raw.length ? list : undefined)
              saveAutoStore()
            })
          },
          allowedModelsSummary(): string {
            const raw = this.rawConnectedModels()
            if (this.isAllModelsAllowed()) {
              return `Todos os modelos (${raw.length})`
            }
            const count = autoStore.selectedModels?.length ?? 0
            return `${count} de ${raw.length} selecionados`
          },
          classify(id: string, name: string): "efficiency" | "balanced" | "intelligence" {
            return classifyModelBucket(id, name)
          },
          fusionAvailable() {
            return this.connectedModels().length >= 2
          },
          modeName() {
            return this.fusionAvailable() ? "Omni Fusion" : "Auto"
          },
          tier(): "default" | "efficiency" | "balanced" | "intelligence" {
            return autoStore.explicitTier ?? "default"
          },
          effectiveTier(): "efficiency" | "balanced" | "intelligence" {
            return autoStore.explicitTier ?? autoStore.managedDefaultTier
          },
          tierLabel(tier?: "default" | "efficiency" | "balanced" | "intelligence") {
            return tierLabelText(tier ?? this.tier())
          },
          lastDecision() {
            return autoStore.lastDecision
          },
          pickForBucket(targetBucket: "efficiency" | "balanced" | "intelligence") {
            const available = this.connectedModels()
            if (available.length === 0) return undefined
            const fallbackOrder: ("efficiency" | "balanced" | "intelligence")[] =
              targetBucket === "efficiency"
                ? ["efficiency", "balanced", "intelligence"]
                : targetBucket === "intelligence"
                  ? ["intelligence", "balanced", "efficiency"]
                  : ["balanced", "intelligence", "efficiency"]

            const activeProv = currentSelection()?.providerID
            const favSet = new Set(preferences.favorite.map((f) => `${f.providerID}/${f.modelID}`))
            const recSet = new Set(preferences.recent.map((r) => `${r.providerID}/${r.modelID}`))

            for (const bucket of fallbackOrder) {
              const inBucket = available.filter((m) => classifyModelBucket(m.id, m.name) === bucket)
              if (inBucket.length > 0) {
                const favMatch = inBucket.find((m) => favSet.has(`${m.providerID}/${m.id}`))
                if (favMatch) return favMatch
                const sameProv = activeProv ? inBucket.find((m) => m.providerID === activeProv) : undefined
                if (sameProv) return sameProv
                const recMatch = inBucket.find((m) => recSet.has(`${m.providerID}/${m.id}`))
                if (recMatch) return recMatch
                return inBucket[0]!
              }
            }
            return available[0]
          },
          tierPool() {
            const provMap = new Map((providers() ?? []).map((p) => [p.id, p.name]))
            const formatModel = (m: ReturnType<typeof this.pickForBucket>) =>
              m ? `${m.name} (${provMap.get(m.providerID) ?? m.providerID})` : "Nenhum modelo conectado"
            const eff = this.pickForBucket("efficiency")
            const bal = this.pickForBucket("balanced")
            const int = this.pickForBucket("intelligence")
            return {
              efficiency: { model: eff, label: formatModel(eff) },
              balanced: { model: bal, label: formatModel(bal) },
              intelligence: { model: int, label: formatModel(int) },
            }
          },
          enable(tier?: "default" | "efficiency" | "balanced" | "intelligence") {
            batch(() => {
              setAutoStore("enabled", true)
              if (tier !== undefined) {
                setAutoStore("explicitTier", tier === "default" ? undefined : tier)
              }
              process.env.OMNICODE_OPTIMIZE_TIER = autoStore.explicitTier ?? autoStore.managedDefaultTier
              saveAutoStore()
            })
            this.routeForPrompt("")
          },
          disable() {
            setAutoStore("enabled", false)
            saveAutoStore()
          },
          setTier(tier: "default" | "efficiency" | "balanced" | "intelligence") {
            this.enable(tier)
          },
          cycleTier() {
            const order: ("default" | "efficiency" | "balanced" | "intelligence")[] = [
              "default",
              "efficiency",
              "balanced",
              "intelligence",
            ]
            const next = order[(order.indexOf(this.tier()) + 1) % order.length]!
            this.enable(next)
            return next
          },
          routeForPrompt(promptText: string) {
            const available = this.connectedModels()
            if (available.length === 0) return undefined
            const complexity = promptText.trim() ? evaluatePromptComplexity(promptText) : "medium"
            const explicit = autoStore.explicitTier
            const effective = explicit ?? autoStore.managedDefaultTier
            const targetBucket: "efficiency" | "balanced" | "intelligence" =
              explicit === "efficiency"
                ? "efficiency"
                : explicit === "intelligence"
                  ? "intelligence"
                  : explicit === "balanced"
                    ? "balanced"
                    : complexity === "low"
                      ? "efficiency"
                      : complexity === "high"
                        ? "intelligence"
                        : "balanced"
            const picked = this.pickForBucket(targetBucket) ?? available[0]!
            const thinkingVariant = autoStore.thinkingRouting
              ? complexity === "low"
                ? "low"
                : complexity === "high"
                  ? "max"
                  : "medium"
              : undefined
            selectModel({ providerID: picked.providerID, modelID: picked.id }, thinkingVariant)
            const decision = {
              complexity,
              tier: effective,
              providerID: picked.providerID,
              modelID: picked.id,
              modelName: picked.name,
              thinking: thinkingVariant,
              fusion: available.length >= 2,
            }
            setAutoStore("lastDecision", decision)
            return decision
          },
          thinkingRouting(): boolean {
            return autoStore.thinkingRouting
          },
          setThinkingRouting(enabled: boolean) {
            batch(() => {
              setAutoStore("thinkingRouting", enabled)
              saveAutoStore()
              toast.show({
                variant: enabled ? "success" : "info",
                message: enabled
                  ? "🧠 Roteamento Inteligente de Thinking ATIVADO (low em buscas, max em arquitetura)"
                  : "Roteamento de Thinking DESATIVADO",
                duration: 3500,
              })
            })
          },
          toggleThinkingRouting() {
            this.setThinkingRouting(!autoStore.thinkingRouting)
          },
        },
        toggleFavorite(model: { providerID: string; modelID: string }) {
          batch(() => {
            if (!isModelValid(model)) return
            const exists = preferences.favorite.some(
              (x) => x.providerID === model.providerID && x.modelID === model.modelID,
            )
            setPreferences("favorite", favoriteModels(model, preferences.favorite, !exists))
            void repository.setFavorite(model, !exists).catch(() => undefined)
          })
        },
        variant: {
          selected() {
            if (autoStore.enabled) {
              return autoVariantValue(autoStore.explicitTier ?? "default")
            }
            return currentSelection()?.variant
          },
          current() {
            return this.selected()
          },
          list() {
            if (autoStore.enabled) {
              return ["modo auto", "eficiência", "balanceado", "inteligente"]
            }
            const m = currentSelection()
            if (!m) return []
            const info = models()?.find((item) => item.providerID === m.providerID && item.id === m.modelID)
            return info?.variants?.map((variant) => variant.id) ?? []
          },
          set(value: string | undefined) {
            if (autoStore.enabled) {
              const norm = (value ?? "").toLowerCase().trim()
              if (norm === "eficiência" || norm === "eficiencia" || norm === "efficiency") {
                this.autoSetTier("efficiency")
              } else if (norm === "balanceado" || norm === "balanced") {
                this.autoSetTier("balanced")
              } else if (norm === "inteligente" || norm === "inteligência" || norm === "intelligence") {
                this.autoSetTier("intelligence")
              } else {
                this.autoSetTier("default")
              }
              return
            }
            const m = currentSelection()
            if (!m) return
            if (route.data.type === "session") {
              setSessionDraft(route.data.sessionID, { ...m, variant: normalizeModelVariant(value) })
            }
            setPreferences("variant", modelPreferenceKey(m), value ?? "default")
            void repository.saveVariant(m, value).catch(() => undefined)
          },
          autoSetTier(tier: "default" | "efficiency" | "balanced" | "intelligence") {
            batch(() => {
              setAutoStore("enabled", true)
              setAutoStore("explicitTier", tier === "default" ? undefined : tier)
              process.env.OMNICODE_OPTIMIZE_TIER = autoStore.explicitTier ?? autoStore.managedDefaultTier
              saveAutoStore()
            })
            const targetBucket: "efficiency" | "balanced" | "intelligence" =
              tier === "efficiency" ? "efficiency" : tier === "intelligence" ? "intelligence" : "balanced"
            const available = (models() ?? []).filter((m) => m.status !== "deprecated")
            if (available.length > 0) {
              const inBucket = available.filter((m) => classifyModelBucket(m.id, m.name) === targetBucket)
              const picked = inBucket[0] ?? available[0]!
              selectModel({ providerID: picked.providerID, modelID: picked.id })
            }
          },
          cycle() {
            if (autoStore.enabled) {
              const order: ("default" | "efficiency" | "balanced" | "intelligence")[] = [
                "default",
                "efficiency",
                "balanced",
                "intelligence",
              ]
              const cur = autoStore.explicitTier ?? "default"
              const next = order[(order.indexOf(cur) + 1) % order.length]!
              this.autoSetTier(next)
              return
            }
            const variants = this.list()
            if (variants.length === 0) return
            this.set(cycleModelVariant(this.current(), variants))
          },
        },
        customizations: {
          config() {
            return autoStore.autoCustomizations
          },
          enabled() {
            return autoStore.autoCustomizations.enabled
          },
          toggleEnabled() {
            batch(() => {
              setAutoStore("autoCustomizations", "enabled", !autoStore.autoCustomizations.enabled)
              saveAutoStore()
            })
          },
          toggle(key: "useSkills" | "useAgents" | "useMcps" | "useHooks" | "useMods" | "useCommands" | "useSettings") {
            batch(() => {
              setAutoStore("autoCustomizations", key, !autoStore.autoCustomizations[key])
              saveAutoStore()
            })
          },
          setAll(value: boolean) {
            batch(() => {
              setAutoStore("autoCustomizations", {
                enabled: value,
                useSkills: value,
                useAgents: value,
                useMcps: value,
                useHooks: value,
                useMods: value,
                useCommands: value,
                useSettings: value,
              })
              saveAutoStore()
            })
          },
          summary() {
            if (!autoStore.autoCustomizations.enabled) return "Desativado"
            const count = [
              autoStore.autoCustomizations.useSkills,
              autoStore.autoCustomizations.useAgents,
              autoStore.autoCustomizations.useMcps,
              autoStore.autoCustomizations.useHooks,
              autoStore.autoCustomizations.useMods,
              autoStore.autoCustomizations.useCommands,
              autoStore.autoCustomizations.useSettings,
            ].filter(Boolean).length
            return `Ativo (${count}/7 recursos)`
          },
        },
      }
    }

    const model = createModel()

    onCleanup(
      event.subscribe((evt) => {
        try {
          if (!model.auto.enabled()) return
          const raw = JSON.stringify(evt)
          if (!/(429|FreeUsageLimitError|free-limit|rate[_\s-]?limit|quota|Too Many Requests)/i.test(raw)) return
          const cur = model.current()
          if (!cur) return
          if (model.auto.isModelInCooldown(cur.providerID, cur.modelID)) return
          model.auto.markCooldown(cur.providerID, cur.modelID, 5 * 60_000)
          const next = model.auto.routeForPrompt("")
          if (next && (next.providerID !== cur.providerID || next.modelID !== cur.modelID)) {
            toast.show({
              variant: "warning",
              message: `⚡ Auto-Failover Anti-429: ${cur.providerID}/${cur.modelID} em cooldown (5m) → Redirecionado para ${next.modelName}`,
              duration: 5000,
            })
          }
        } catch {
          // ignore
        }
      }),
    )

    function createSession() {
      const [sessionStore, setSessionStore] = createStore<{
        ready: boolean
        pinned: string[]
      }>({
        ready: false,
        pinned: [],
      })

      const filePath = path.join(paths.state, "session.json")
      const state = {
        pending: false,
      }

      function save() {
        if (!sessionStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        void writeJsonAtomic(filePath, {
          pinned: sessionStore.pinned,
        })
      }

      readJson<unknown>(filePath)
        .then((x) => {
          if (!x || typeof x !== "object") return
          const pinned = (x as Record<string, unknown>).pinned
          if (Array.isArray(pinned))
            setSessionStore(
              "pinned",
              pinned.filter((item): item is string => typeof item === "string"),
            )
        })
        .catch(() => {})
        .finally(() => {
          setSessionStore("ready", true)
          if (state.pending) save()
        })

      const slots = createMemo(() => {
        const existing = new Set(
          data.session
            .list()
            .filter((x) => x.parentID === undefined)
            .map((x) => x.id),
        )
        return sessionStore.pinned.filter((id) => existing.has(id)).slice(0, 9)
      })

      function prune(sessionID: string) {
        batch(() => {
          if (sessionStore.pinned.includes(sessionID)) {
            setSessionStore(
              "pinned",
              sessionStore.pinned.filter((x) => x !== sessionID),
            )
          }
          save()
        })
      }

      onCleanup(
        event.on("session.deleted", (evt) => {
          prune(evt.data.sessionID)
        }),
      )

      return {
        get ready() {
          return sessionStore.ready
        },
        pinned() {
          return sessionStore.pinned
        },
        slots,
        isPinned(sessionID: string) {
          return sessionStore.pinned.includes(sessionID)
        },
        togglePin(sessionID: string) {
          batch(() => {
            const exists = sessionStore.pinned.includes(sessionID)
            const next = exists
              ? sessionStore.pinned.filter((x) => x !== sessionID)
              : [...sessionStore.pinned, sessionID]
            setSessionStore("pinned", next)
            save()
          })
        },
        quickSwitch(slot: number) {
          const target = slots()[slot - 1]
          if (!target) return
          if (route.data.type === "session" && route.data.sessionID === target) return
          route.navigate({ type: "session", sessionID: target })
        },
      }
    }

    const session = createSession()

    const result = {
      model,
      agent,
      session,
      permission,
      customizations: model.customizations,
    }
    return result
  },
})
