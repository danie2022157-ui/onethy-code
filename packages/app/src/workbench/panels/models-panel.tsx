import { batch, createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { ModelInfo, ProviderInfo } from "@opencode/client/promise"
import {
  classifyModelBucket,
  filterAllowedFusionModels,
  type FusionCandidate,
  type FusionTier,
  type ModelBucket,
} from "@opencode/client/fusion"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Switch } from "@opencode/ui/switch"
import { Tooltip } from "@opencode/ui/tooltip"
import { syncWhileBooting } from "@/providers/catalog/providers"
import { useFusion } from "@/providers/models/fusion"
import { BoltIcon } from "@/providers/models/fusion-icons"
import { ModelsProvider } from "@/providers/models/models"
import { ProviderModelIcon } from "@/providers/models/provider-group"
import { LocalProvider } from "@/providers/models/selection"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { ServerProvider } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { LocationProvider } from "@/workspaces/location"
import { ModelsChipIcon, SearchCodeIcon } from "../icons"
import { useWorkbench } from "../state"

type TranslateFn = ReturnType<typeof useOnethyI18n>["tr"]

type BucketFilter = "all" | ModelBucket

type ConnectedModelRow = {
  key: string
  provider: ProviderInfo
  model: ModelInfo
  bucket: ModelBucket
}

const TIER_IDS: readonly Exclude<FusionTier, "default">[] = ["efficiency", "balanced", "intelligence"]

const BUCKET_FILTER_IDS: readonly BucketFilter[] = ["all", "efficiency", "balanced", "intelligence"]

export function ModelsPanel() {
  const workbench = useWorkbench()
  const dialog = useDialog()
  const fusion = useFusion()
  const { tr, locale } = useOnethyI18n()

  const tierOptionLabel = (id: Exclude<FusionTier, "default">) => {
    if (id === "efficiency") return tr("Efficiency", "Eficiência")

    if (id === "balanced") return tr("Balanced", "Balanceado")

    return tr("Intelligence", "Inteligência")
  }

  const tierOptionHint = (id: Exclude<FusionTier, "default">) => {
    if (id === "efficiency") {
      return tr(
        "Prioritizes fast, cost-effective models (Flash, Mini, Haiku)",
        "Prioriza modelos rápidos e econômicos (Flash, Mini, Haiku)",
      )
    }

    if (id === "balanced") {
      return tr(
        "Balance between speed and general coding capability",
        "Equilíbrio entre velocidade e capacidade geral de código",
      )
    }

    return tr(
      "Prioritizes flagship models for architecture and deep debugging",
      "Prioriza modelos flagship para arquitetura e depuração profunda",
    )
  }

  const bucketFilterLabel = (id: BucketFilter) => {
    if (id === "all") return tr("All", "Todos")

    if (id === "efficiency") return "Fast"

    if (id === "balanced") return "Bal"

    return "Smart"
  }

  const [query, setQuery] = createSignal("")
  const [bucketFilter, setBucketFilter] = createSignal<BucketFilter>("all")
  const [syncing, setSyncing] = createSignal(false)
  const [syncError, setSyncError] = createSignal<string | undefined>(undefined)
  const [switchingKey, setSwitchingKey] = createSignal<string | undefined>(undefined)

  let syncGeneration = 0

  const location = createMemo(() => {
    const ctx = workbench.activeServerCtx()

    if (!ctx) return undefined

    return workbench.activeLocation() ?? ctx.data.location.default()
  })

  const providers = createMemo<readonly ProviderInfo[]>(() => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc) return []

    return ctx.data.location.provider.list(loc) ?? []
  })

  const providerMap = createMemo(() => new Map(providers().map((provider) => [provider.id, provider])))

  const connectedModels = createMemo<readonly ConnectedModelRow[]>(() => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc) return []

    const knownProviders = providerMap()
    const rawModels = ctx.data.location.model.list(loc) ?? []

    return rawModels
      .flatMap((model): ConnectedModelRow[] => {
        if (!model.enabled || model.status === "deprecated") return []
        const provider = knownProviders.get(model.providerID)

        if (!provider) return []

        return [
          {
            key: `${provider.id}:${model.id}`,
            provider,
            model,
            bucket: classifyModelBucket(model.id, model.name),
          },
        ]
      })
      .sort((a, b) => {
        const providerCmp = a.provider.name.localeCompare(b.provider.name, undefined, { sensitivity: "base" })

        if (providerCmp !== 0) return providerCmp

        return a.model.name.localeCompare(b.model.name, undefined, { sensitivity: "base" })
      })
  })

  const candidates = createMemo<readonly FusionCandidate[]>(() =>
    connectedModels().map((row) => ({
      providerID: row.provider.id,
      id: row.model.id,
      name: row.model.name,
      providerName: row.provider.name,
      variants: row.model.variants.map((variant) => variant.id),
    })),
  )

  const bucketCounts = createMemo<Record<BucketFilter, number>>(() => {
    const list = connectedModels()

    return {
      all: list.length,
      efficiency: list.filter((item) => item.bucket === "efficiency").length,
      balanced: list.filter((item) => item.bucket === "balanced").length,
      intelligence: list.filter((item) => item.bucket === "intelligence").length,
    }
  })

  const allowedSummary = createMemo(() => {
    const list = candidates()

    if (fusion.isAllModelsAllowed(list)) {
      return tr("All models ({{count}})", "Todos os modelos ({{count}})", { count: list.length })
    }

    const allowed = filterAllowedFusionModels(list, fusion.selectedModels())

    return tr("{{allowed}} of {{total}} selected", "{{allowed}} de {{total}} selecionados", {
      allowed: allowed.length,
      total: list.length,
    })
  })

  const filteredModels = createMemo(() => {
    const activeBucket = bucketFilter()
    const term = query().trim().toLowerCase()

    return connectedModels().filter((row) => {
      if (activeBucket !== "all" && row.bucket !== activeBucket) return false

      if (!term) return true

      const bucketText = bucketMeta(row.bucket, tr).label.toLowerCase()
      const haystack = `${row.model.name} ${row.model.id} ${row.provider.name} ${row.provider.id} ${row.model.family ?? ""} ${bucketText}`.toLowerCase()

      return haystack.includes(term)
    })
  })

  const activeModelKey = createMemo(() => {
    const active = workbench.activeModel()

    if (!active) return ""

    return `${active.providerID}:${active.modelID}`
  })

  const lastFusionKey = createMemo(() => {
    const decision = fusion.lastDecision()

    if (!decision) return ""

    return `${decision.providerID}:${decision.modelID}`
  })

  const syncCatalog = async (opts?: { force?: boolean }) => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc) return

    const generation = ++syncGeneration
    setSyncing(true)
    setSyncError(undefined)

    if (opts?.force) {
      ctx.data.location.provider.invalidate(loc)
      ctx.data.location.model.invalidate(loc)
    }

    const outcome = await syncWhileBooting(() =>
      Promise.all([ctx.data.location.provider.sync(loc), ctx.data.location.model.sync(loc)]),
    )
      .then(() => ({ ok: true as const }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    if (generation !== syncGeneration) return

    batch(() => {
      setSyncing(false)
      setSyncError(outcome.ok ? undefined : outcome.message)
    })
  }

  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc) {
      syncGeneration += 1
      setSyncing(false)
      setSyncError(undefined)

      return
    }

    void syncCatalog()
  })

  const switchSessionModel = async (providerID: string, modelID: string, displayName?: string) => {
    const ctx = workbench.activeServerCtx()
    const sessionID = workbench.activeSessionID()
    const key = `${providerID}:${modelID}`

    fusion.disable()

    if (!ctx || !sessionID) {
      showToast({
        variant: "default",
        title: tr("Selected model: {{model}}", "Modelo selecionado: {{model}}", { model: displayName ?? modelID }),
        description: tr(
          "Open or start a session to apply this model directly in chat.",
          "Abra ou inicie uma sessão para aplicar este modelo diretamente no chat.",
        ),
      })

      return
    }

    setSwitchingKey(key)

    const outcome = await ctx.sdk.api.session
      .switchModel({
        sessionID,
        model: { providerID, id: modelID },
      })
      .then(() => ({ ok: true as const }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    setSwitchingKey(undefined)

    if (!outcome.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to switch session model", "Falha ao trocar modelo da sessão"),
        description: outcome.message,
      })

      return
    }

    showToast({
      variant: "success",
      title: tr("Active model: {{model}}", "Modelo ativo: {{model}}", { model: displayName ?? modelID }),
      description: tr("Provider: {{provider}}", "Provedor: {{provider}}", { provider: providerID }),
    })
  }

  const handleToggleAutoMode = (enabled: boolean) => {
    if (enabled) {
      fusion.enable()
      const decision = fusion.routeForPrompt("", candidates())
      showToast({
        variant: "success",
        title: tr("{{mode}} enabled", "{{mode}} ativado", { mode: fusion.modeName(candidates()) }),
        description: decision
          ? tr(
              "Active routing ({{tier}}). Next suggested model: {{model}}.",
              "Roteamento ativo ({{tier}}). Próximo modelo sugerido: {{model}}.",
              { tier: fusion.tierLabel(undefined, locale()), model: decision.modelName },
            )
          : tr(
              "Models will be chosen automatically based on prompt complexity.",
              "Modelos serão escolhidos automaticamente conforme a complexidade do prompt.",
            ),
      })

      return
    }

    fusion.disable()
    showToast({
      variant: "default",
      title: tr("Auto Mode disabled", "Auto Mode desativado"),
      description: tr("Manual model selection re-enabled.", "Seleção manual de modelo reativada."),
    })
  }

  const handleSelectTier = (tier: Exclude<FusionTier, "default">) => {
    if (fusion.enabled() && fusion.tier() === tier) {
      fusion.setTier("default")
      showToast({
        variant: "default",
        title: tr("Tier reset to dynamic Auto", "Tier retornado para Auto dinâmico"),
        description: tr(
          "Routing returns to switching across all tiers by complexity.",
          "O roteamento volta a alternar entre todos os tiers por complexidade.",
        ),
      })

      return
    }

    fusion.setTier(tier)
    const decision = fusion.routeForPrompt("", candidates())
    showToast({
      variant: "success",
      title: `Omni Fusion: ${fusion.tierLabel(tier, locale())}`,
      description: decision
        ? tr("Preferred model: {{model}}", "Modelo preferencial: {{model}}", { model: decision.modelName })
        : undefined,
    })
  }

  const openFusionDialog = async () => {
    const conn = workbench.activeServer()
    const ctx = workbench.activeServerCtx()

    if (!conn || !ctx) return

    const dir = workbench.activeDirectory() ?? ctx.data.location.default().directory
    const { DialogFusionModels } = await import("@/providers/models/fusion-dialog")

    void dialog.show(() => (
      <ServerProvider conn={conn}>
        <ModelsProvider directory={dir}>
          <LocationProvider directory={dir}>
            <LocalProvider>
              <DialogFusionModels
                onClose={() => dialog.close()}
                onSelectModel={(providerID, modelID) => void switchSessionModel(providerID, modelID)}
              />
            </LocalProvider>
          </LocationProvider>
        </ModelsProvider>
      </ServerProvider>
    ))
  }

  const openConnectProviderDialog = async () => {
    const conn = workbench.activeServer()

    if (!conn) return

    const dir = workbench.activeDirectory()
    const { DialogConnectProvider } = await import("@/providers/connect/dialog")

    void dialog.show(
      () => (
        <ServerProvider conn={conn}>
          <DialogConnectProvider
            directory={dir}
            onConnected={() => void syncCatalog({ force: true })}
          />
        </ServerProvider>
      ),
      () => void syncCatalog({ force: true }),
    )
  }

  const openAddCustomProviderDialog = async () => {
    const conn = workbench.activeServer()

    if (!conn) return

    const dir = workbench.activeDirectory()
    const { DialogAddCustomProvider } = await import("@/providers/connect/dialog-custom")

    void dialog.show(() => (
      <ServerProvider conn={conn}>
        <DialogAddCustomProvider
          directory={dir}
          onClose={() => dialog.close()}
          onSaved={() => void syncCatalog({ force: true })}
        />
      </ServerProvider>
    ))
  }

  return (
    <Show
      when={workbench.activeServerCtx()}
      fallback={
        <div class="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
          <div class="flex size-10 items-center justify-center rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
            <ModelsChipIcon size={18} />
          </div>
          <div class="text-[12.5px] font-medium text-v2-text-text-base">
            {tr("No active server", "Nenhum servidor ativo")}
          </div>
          <p class="max-w-[210px] text-[11.5px] leading-4 text-v2-text-text-faint">
            {tr(
              "Connect to a server to configure Omni Fusion and explore connected models.",
              "Conecte-se a um servidor para configurar o Omni Fusion e explorar modelos conectados.",
            )}
          </p>
        </div>
      }
    >
      <div class="flex min-h-0 flex-1 flex-col bg-v2-background-bg-base text-v2-text-text-base">
        {/* Top bar */}
        <div class="flex shrink-0 items-center justify-between gap-1.5 border-b border-v2-border-border-muted px-2.5 py-1.5">
          <div class="flex min-w-0 items-center gap-1.5">
            <ModelsChipIcon size={13} class="shrink-0 text-v2-text-text-accent" />
            <span class="truncate text-[11.5px] font-semibold text-v2-text-text-base">
              {tr("{{models}} models · {{providers}} providers", "{{models}} modelos · {{providers}} provedores", {
                models: connectedModels().length,
                providers: providers().length,
              })}
            </span>
          </div>

          <Tooltip
            placement="bottom"
            value={tr("Refresh providers and models catalog", "Atualizar catálogo de provedores e modelos")}
          >
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
              aria-label={tr("Refresh models catalog", "Atualizar catálogo de modelos")}
              disabled={syncing()}
              onClick={() => void syncCatalog({ force: true })}
            >
              <Show when={syncing()} fallback={<Icon name="refresh" size="small" class="size-3.5" />}>
                <Loader width={13} height={13} />
              </Show>
            </button>
          </Tooltip>
        </div>

        {/* Scrollable body (Fusion controls + quick actions + models list) */}
        <div data-slot="workbench-scroll" class="min-h-0 flex-1 overflow-y-auto">
          {/* Omni Fusion Control Card */}
          <div class="border-b border-v2-border-border-muted bg-v2-background-bg-layer-01/50 p-2.5 flex flex-col gap-2.5">
            {/* Master Auto Mode Switch */}
            <div class="flex items-center justify-between gap-2">
              <div class="flex min-w-0 items-center gap-2">
                <div
                  class="flex size-7 shrink-0 items-center justify-center rounded-[6px] border"
                  classList={{
                    "border-emerald-500/35 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400": fusion.enabled(),
                    "border-v2-border-border-base bg-v2-background-bg-base text-v2-icon-icon-muted": !fusion.enabled(),
                  }}
                >
                  <BoltIcon class="size-3.5" />
                </div>
                <div class="flex min-w-0 flex-col">
                  <div class="flex items-center gap-1.5">
                    <span class="truncate text-[12px] font-semibold text-v2-text-text-base">
                      {fusion.modeName(candidates())}
                    </span>
                    <span
                      class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none"
                      classList={{
                        "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400": fusion.enabled(),
                        "bg-v2-background-bg-layer-02 text-v2-text-text-faint": !fusion.enabled(),
                      }}
                    >
                      {fusion.enabled() ? tr("ACTIVE", "ATIVO") : "OFF"}
                    </span>
                  </div>
                  <span class="truncate text-[10.5px] text-v2-text-text-faint">
                    {allowedSummary()}
                  </span>
                </div>
              </div>

              <Switch
                checked={fusion.enabled()}
                hideLabel
                onChange={(checked) => handleToggleAutoMode(checked)}
              >
                {tr("Omni Fusion Auto Mode", "Auto Mode Omni Fusion")}
              </Switch>
            </div>

            {/* 3 Tier buttons: efficiency, balanced, intelligence */}
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between text-[10px] text-v2-text-text-faint">
                <span class="font-medium uppercase tracking-[0.04em]">
                  {tr("Routing Tier", "Tier de Roteamento")}
                </span>
                <Show when={fusion.enabled()}>
                  <span class="font-mono text-v2-text-text-accent">
                    {fusion.tier() === "default"
                      ? tr("Dynamic Auto", "Auto dinâmico")
                      : fusion.tierLabel(undefined, locale())}
                  </span>
                </Show>
              </div>

              <div class="grid grid-cols-3 gap-1">
                <For each={TIER_IDS}>
                  {(tierId) => {
                    const selected = () => fusion.enabled() && fusion.tier() === tierId

                    return (
                      <Tooltip placement="top" value={tierOptionHint(tierId)}>
                        <button
                          type="button"
                          aria-pressed={selected()}
                          class="flex flex-col items-center justify-center gap-1 rounded-[6px] border px-1.5 py-1.5 text-[10.5px] font-medium transition-colors"
                          classList={{
                            "border-v2-border-border-strong bg-v2-background-bg-accent text-v2-text-text-inverse":
                              selected(),
                            "border-v2-border-border-base bg-v2-background-bg-base text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                              !selected(),
                          }}
                          onClick={() => handleSelectTier(tierId)}
                        >
                          <TierGlyph tier={tierId} />
                          <span class="truncate">{tierOptionLabel(tierId)}</span>
                        </button>
                      </Tooltip>
                    )
                  }}
                </For>
              </div>
            </div>

            {/* Thinking Routing Toggle */}
            <div class="flex items-center justify-between gap-2 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 py-1.5">
              <div class="flex min-w-0 items-center gap-1.5">
                <Icon
                  name="outline-brain"
                  size="small"
                  class={`size-3.5 shrink-0 ${fusion.thinkingRouting() ? "text-purple-500" : "text-v2-icon-icon-muted"}`}
                />
                <div class="flex min-w-0 flex-col">
                  <span class="truncate text-[11px] font-medium text-v2-text-text-base">Thinking Routing</span>
                  <span class="truncate text-[10px] text-v2-text-text-faint">
                    {tr("Adaptive reasoning effort", "Esforço adaptativo de raciocínio")}
                  </span>
                </div>
              </div>

              <Switch
                checked={fusion.thinkingRouting()}
                hideLabel
                onChange={(checked) => fusion.setThinkingRouting(checked)}
              >
                Thinking Routing
              </Switch>
            </div>

            {/* Last routing decision summary */}
            <Show when={fusion.enabled() && fusion.lastDecision()}>
              {(decision) => (
                <div class="flex items-center justify-between gap-2 rounded-[5px] border border-v2-border-border-muted bg-v2-background-bg-deep px-2 py-1 text-[10px]">
                  <span class="truncate text-v2-text-text-muted">
                    {tr("Last:", "Último:")}{" "}
                    <strong class="font-mono text-v2-text-text-base">{decision().modelName}</strong>
                  </span>
                  <Show when={decision().thinking}>
                    {(effort) => (
                      <span class="shrink-0 rounded bg-purple-500/15 px-1 py-0.5 font-mono text-[9.5px] text-purple-600 dark:text-purple-400">
                        {effort()}
                      </span>
                    )}
                  </Show>
                </div>
              )}
            </Show>

            {/* Quick Dialog Buttons */}
            <div class="flex flex-col gap-1">
              <button
                type="button"
                class="flex h-7 w-full items-center justify-between gap-1.5 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-base px-2.5 text-[11px] font-medium text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                onClick={() => void openFusionDialog()}
              >
                <span class="inline-flex items-center gap-1.5 truncate">
                  <BoltIcon class="size-3.5 shrink-0 text-v2-text-text-accent" />
                  <span class="truncate">{tr("Configure Fusion Matrix", "Configurar Matriz Fusion")}</span>
                </span>
                <Icon name="chevron-right" size="small" class="size-3 shrink-0 text-v2-icon-icon-muted" />
              </button>

              <div class="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  class="flex h-7 items-center justify-center gap-1 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-base px-2 text-[10.5px] font-medium text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                  onClick={() => void openConnectProviderDialog()}
                >
                  <Icon name="plus" size="small" class="size-3 shrink-0" />
                  <span class="truncate">{tr("Connect", "Conectar")}</span>
                </button>

                <button
                  type="button"
                  class="flex h-7 items-center justify-center gap-1 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-base px-2 text-[10.5px] font-medium text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                  onClick={() => void openAddCustomProviderDialog()}
                >
                  <Icon name="outline-globe-plus" size="small" class="size-3 shrink-0" />
                  <span class="truncate">{tr("Custom", "Customizado")}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Search & bucket filters for connected models */}
          <div class="sticky top-0 z-10 border-b border-v2-border-border-muted bg-v2-background-bg-base px-2 py-1.5 flex flex-col gap-1.5">
            <div class="flex h-7 items-center gap-1.5 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 focus-within:border-v2-border-border-focus">
              <SearchCodeIcon size={13} class="shrink-0 text-v2-icon-icon-muted" />
              <input
                type="text"
                value={query()}
                placeholder={tr("Search connected models...", "Buscar modelos conectados...")}
                aria-label={tr("Search connected models", "Buscar modelos conectados")}
                class="min-w-0 flex-1 bg-transparent text-[12px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query()) {
                    e.stopPropagation()
                    setQuery("")
                  }
                }}
              />
              <Show when={query().length > 0}>
                <button
                  type="button"
                  class="flex size-4 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                  aria-label={tr("Clear model search", "Limpar busca de modelos")}
                  onClick={() => setQuery("")}
                >
                  <Icon name="outline-xmark" size="small" class="size-3" />
                </button>
              </Show>
            </div>

            <div class="flex flex-wrap gap-1" role="tablist" aria-label={tr("Filter by capability", "Filtrar por capacidade")}>
              <For each={BUCKET_FILTER_IDS}>
                {(pillId) => {
                  const active = () => bucketFilter() === pillId

                  return (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active()}
                      class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors"
                      classList={{
                        "border-v2-border-border-strong bg-v2-background-bg-accent text-v2-text-text-inverse": active(),
                        "border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-text-text-muted hover:text-v2-text-text-base":
                          !active(),
                      }}
                      onClick={() => setBucketFilter(pillId)}
                    >
                      <span>{bucketFilterLabel(pillId)}</span>
                      <span
                        class="font-mono text-[9.5px]"
                        classList={{ "opacity-85": active(), "text-v2-text-text-faint": !active() }}
                      >
                        {bucketCounts()[pillId]}
                      </span>
                    </button>
                  )
                }}
              </For>
            </div>
          </div>

          {/* Models list */}
          <div class="flex flex-col gap-1 p-2">
            <Show when={syncError()}>
              {(message) => (
                <div class="mb-1 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger px-2.5 py-1.5 text-[11px] text-v2-state-fg-danger">
                  {message()}
                </div>
              )}
            </Show>

            <Show
              when={!syncing() || connectedModels().length > 0}
              fallback={
                <div class="flex items-center justify-center gap-2 py-8 text-[12px] text-v2-text-text-faint">
                  <Loader width={14} height={14} />
                  <span>{tr("Loading connected models...", "Carregando modelos conectados...")}</span>
                </div>
              }
            >
              <Show
                when={filteredModels().length > 0}
                fallback={
                  <div class="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                    <div class="flex size-9 items-center justify-center rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
                      <ModelsChipIcon size={16} />
                    </div>
                    <div class="text-[12px] font-medium text-v2-text-text-base">
                      {connectedModels().length === 0
                        ? tr("No connected models", "Nenhum modelo conectado")
                        : tr("No models found", "Nenhum modelo encontrado")}
                    </div>
                    <p class="max-w-[215px] text-[11px] leading-4 text-v2-text-text-faint">
                      {connectedModels().length === 0
                        ? tr(
                            "Connect a provider or add an OpenAI-compatible endpoint.",
                            "Conecte um provedor ou adicione um endpoint compatível com OpenAI.",
                          )
                        : tr(
                            "Try adjusting your search term or bucket filter.",
                            "Tente ajustar o termo de busca ou o filtro de bucket.",
                          )}
                    </p>
                  </div>
                }
              >
                <For each={filteredModels()}>
                  {(row) => {
                    const meta = () => bucketMeta(row.bucket, tr)
                    const isActive = () => activeModelKey() === row.key
                    const isLastFusion = () => fusion.enabled() && lastFusionKey() === row.key
                    const allowedInPool = () => fusion.isModelAllowed(row.provider.id, row.model.id)
                    const isSwitching = () => switchingKey() === row.key

                    return (
                      <div
                        class="flex items-center gap-1.5 rounded-[7px] border px-2 py-1.5 transition-colors"
                        classList={{
                          "border-v2-border-border-strong bg-v2-overlay-simple-overlay-pressed":
                            isActive() || isLastFusion(),
                          "border-v2-border-border-muted bg-v2-background-bg-layer-01/60 hover:border-v2-border-border-base":
                            !isActive() && !isLastFusion(),
                          "opacity-55": fusion.enabled() && !allowedInPool(),
                        }}
                      >
                        <Tooltip
                          placement="top"
                          value={
                            allowedInPool()
                              ? tr(
                                  "Included in Omni Fusion pool (click to remove)",
                                  "Incluído no pool do Omni Fusion (clique para remover)",
                                )
                              : tr(
                                  "Excluded from Omni Fusion pool (click to include)",
                                  "Fora do pool do Omni Fusion (clique para incluir)",
                                )
                          }
                        >
                          <button
                            type="button"
                            aria-pressed={allowedInPool()}
                            aria-label={tr(
                              "Toggle {{model}} in Omni Fusion pool",
                              "Alternar {{model}} no pool Omni Fusion",
                              { model: row.model.name },
                            )}
                            class="flex size-4 shrink-0 items-center justify-center rounded border transition-colors"
                            classList={{
                              "border-emerald-500/50 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400":
                                allowedInPool(),
                              "border-v2-border-border-base bg-transparent text-transparent hover:border-v2-border-border-strong":
                                !allowedInPool(),
                            }}
                            onClick={() => fusion.toggleModelAllowed(row.provider.id, row.model.id, candidates())}
                          >
                            <Icon name="check" size="small" class="size-3" />
                          </button>
                        </Tooltip>

                        <button
                          type="button"
                          disabled={Boolean(switchingKey())}
                          class="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:opacity-60"
                          title={tr("Use {{model}} ({{provider}})", "Usar {{model}} ({{provider}})", {
                            model: row.model.name,
                            provider: row.provider.name,
                          })}
                          onClick={() => void switchSessionModel(row.provider.id, row.model.id, row.model.name)}
                        >
                          <ProviderModelIcon
                            provider={row.provider}
                            class="size-3.5 shrink-0 text-v2-icon-icon-base"
                          />
                          <div class="flex min-w-0 flex-1 flex-col">
                            <div class="flex items-center gap-1 min-w-0">
                              <span class="truncate text-[11.5px] font-medium text-v2-text-text-base">
                                {row.model.name}
                              </span>
                              <Show when={isActive()}>
                                <span
                                  class="size-1.5 shrink-0 rounded-full bg-v2-state-fg-success"
                                  title={tr("Active session model", "Modelo ativo na sessão")}
                                />
                              </Show>
                            </div>
                            <span class="truncate font-mono text-[9.5px] text-v2-text-text-faint">
                              {row.provider.name}
                            </span>
                          </div>
                        </button>

                        <div class="flex shrink-0 items-center gap-1">
                          <Show when={isSwitching()}>
                            <Loader width={11} height={11} class="text-v2-icon-icon-muted" />
                          </Show>

                          <Show when={isActive() && !fusion.enabled()}>
                            <span class="rounded bg-v2-state-bg-success px-1.5 py-0.5 text-[9px] font-semibold text-v2-state-fg-success">
                              {tr("Active", "Ativo")}
                            </span>
                          </Show>

                          <Show when={isLastFusion()}>
                            <span class="rounded bg-v2-background-bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-v2-text-text-accent">
                              Fusion
                            </span>
                          </Show>

                          <span
                            class={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9.5px] font-medium leading-none ${meta().badgeClass}`}
                            title={meta().label}
                          >
                            {meta().shortLabel}
                          </span>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}

function TierGlyph(props: { tier: Exclude<FusionTier, "default"> }) {
  if (props.tier === "efficiency") return <BoltIcon class="size-3.5 shrink-0" />

  if (props.tier === "intelligence") return <Icon name="outline-brain" size="small" class="size-3.5 shrink-0" />

  return <Icon name="outline-sliders" size="small" class="size-3.5 shrink-0" />
}

function bucketMeta(bucket: ModelBucket, tr: TranslateFn) {
  if (bucket === "efficiency") {
    return {
      label: tr("Efficiency", "Eficiência"),
      shortLabel: "Fast",
      badgeClass: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    }
  }

  if (bucket === "intelligence") {
    return {
      label: tr("Intelligence", "Inteligência"),
      shortLabel: "Smart",
      badgeClass: "border-purple-500/25 bg-purple-500/10 text-purple-600 dark:text-purple-400",
    }
  }

  return {
    label: tr("Balanced", "Balanceado"),
    shortLabel: "Bal",
    badgeClass: "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  }
}
