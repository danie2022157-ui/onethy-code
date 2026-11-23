import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { useLocal, type ModelSelection } from "@/providers/models/selection"
import { useFusion } from "@/providers/models/fusion"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { showToast } from "@/shell/notifications/toast"
import { ProviderModelIcon } from "./provider-group"
import { BoltIcon } from "./fusion-icons"
import {
  classifyModelBucket,
  filterAllowedFusionModels,
  type FusionCandidate,
  type FusionTier,
  type ModelBucket,
} from "@opencode/client/fusion"

interface TierColumnMeta {
  readonly bucket: ModelBucket
  readonly title: string
  readonly shortLabel: string
  readonly badgeClass: string
  readonly description: string
}

function TierIcon(props: { tier: FusionTier; class?: string }) {
  if (props.tier === "default" || props.tier === "efficiency") {
    return <BoltIcon class={props.class ?? "size-3.5 shrink-0"} />
  }

  if (props.tier === "intelligence") {
    return <Icon name="outline-brain" size="small" class={props.class} />
  }

  return <Icon name="outline-sliders" size="small" class={props.class} />
}

export const DialogFusionModels: Component<{
  selection?: ModelSelection
  onClose: () => void
  onSelectModel?: (providerID: string, modelID: string) => void
}> = (props) => {
  const { tr } = useOnethyI18n()
  const local = useLocal()
  const fusion = useFusion()
  const modelState = () => props.selection ?? local.model
  const [viewMode, setViewMode] = createSignal<"tiers" | "providers">("tiers")

  const tiers = createMemo<readonly TierColumnMeta[]>(() => [
    {
      bucket: "efficiency",
      title: tr("Efficiency", "Eficiência"),
      shortLabel: "Fast",
      badgeClass: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
      description: tr(
        "Fast and economical models for searches, summaries, and simple edits (Flash, Mini, Haiku).",
        "Modelos rápidos e econômicos para buscas, resumos e edições simples (Flash, Mini, Haiku).",
      ),
    },
    {
      bucket: "balanced",
      title: tr("Balanced", "Balanceado"),
      shortLabel: "Bal",
      badgeClass: "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/25",
      description: tr(
        "Ideal balance between speed and general coding capability (Sonnet, GPT-4o, Pro).",
        "Equilíbrio ideal entre velocidade e capacidade geral de código (Sonnet, GPT-4o, Pro).",
      ),
    },
    {
      bucket: "intelligence",
      title: tr("High Intelligence", "Alta Inteligência"),
      shortLabel: "Smart",
      badgeClass: "text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/25",
      description: tr(
        "Flagship models for complex architecture, deep debugging, and reasoning (Opus, o3, R1).",
        "Modelos flagship para arquitetura complexa, depuração profunda e raciocínio (Opus, o3, R1).",
      ),
    },
  ])

  const tierButtons = createMemo<readonly { id: FusionTier; label: string }[]>(() => [
    { id: "default", label: "Auto" },
    { id: "efficiency", label: tr("Efficiency", "Eficiência") },
    { id: "balanced", label: tr("Balanced", "Balanceado") },
    { id: "intelligence", label: tr("Intelligence", "Inteligência") },
  ])

  const bucketMeta = createMemo<Record<ModelBucket, TierColumnMeta>>(() => {
    const list = tiers()

    return {
      efficiency: list[0]!,
      balanced: list[1]!,
      intelligence: list[2]!,
    }
  })

  const connectedList = createMemo(() => modelState().list())

  const candidates = createMemo<FusionCandidate[]>(() =>
    connectedList().map((item) => ({
      providerID: item.provider.id,
      id: item.id,
      name: item.name,
      providerName: item.provider.name,
      variants: Object.keys(item.variants ?? {}),
    })),
  )

  const activeModelKey = createMemo(() => {
    const active = modelState().current()

    return active ? `${active.provider.id}:${active.id}` : ""
  })

  const modelsByBucket = createMemo(() => {
    const map: Record<ModelBucket, ReturnType<ModelSelection["list"]>> = {
      efficiency: [],
      balanced: [],
      intelligence: [],
    }

    for (const item of connectedList()) {
      const bucket = classifyModelBucket(item.id, item.name)
      map[bucket].push(item)
    }

    return map
  })

  const modelsByProvider = createMemo(() => {
    const grouped = new Map<
      string,
      {
        id: string
        name: string
        provider: ReturnType<ModelSelection["list"]>[number]["provider"]
        items: ReturnType<ModelSelection["list"]>
      }
    >()

    for (const item of connectedList()) {
      const existing = grouped.get(item.provider.id)

      if (existing) {
        existing.items.push(item)
      } else {
        grouped.set(item.provider.id, {
          id: item.provider.id,
          name: item.provider.name,
          provider: item.provider,
          items: [item],
        })
      }
    }

    return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name))
  })

  const poolSummary = createMemo(() => {
    const list = candidates()

    if (fusion.isAllModelsAllowed(list)) {
      return tr("All models ({{count}})", "Todos os modelos ({{count}})", { count: list.length })
    }

    const allowed = filterAllowedFusionModels(list, fusion.selectedModels())

    return tr("{{selected}} of {{total}} selected", "{{selected}} de {{total}} selecionados", {
      selected: allowed.length,
      total: list.length,
    })
  })

  const handleUseNow = (providerID: string, modelID: string) => {
    fusion.disable()
    modelState().set({ providerID, modelID }, { recent: true })
    props.onSelectModel?.(providerID, modelID)
    props.onClose()
  }

  const handleToggleModel = (providerID: string, modelID: string) => {
    fusion.toggleModelAllowed(providerID, modelID, candidates())
  }

  const handleToggleProvider = (providerID: string, providerName: string) => {
    fusion.toggleProviderModels(providerID, candidates())
    showToast({
      title: tr("Provider {{name}} toggled in pool", "Provedor {{name}} alternado no pool", { name: providerName }),
      variant: "default",
    })
  }

  const handleRecommendedPreset = () => {
    fusion.applyRecommendedPreset(candidates())
    showToast({
      title: tr("Recommended Preset applied", "Preset Recomendado aplicado"),
      description: tr(
        "1 Fast + 1 Intelligence/Code + 1 Balanced selected in Omni Fusion.",
        "1 Rápido + 1 Inteligência/Código + 1 Balanceado selecionados no Omni Fusion.",
      ),
      variant: "success",
    })
  }

  const handleAllowAll = () => {
    fusion.setAllowAllModels()
    showToast({
      title: tr("All models enabled in Omni Fusion", "Todos os modelos liberados no Omni Fusion"),
      variant: "success",
    })
  }

  const handleToggleAuto = () => {
    const next = !fusion.enabled()

    if (next) {
      fusion.enable()
      const decision = fusion.routeForPrompt("", candidates())

      if (decision) {
        modelState().set({ providerID: decision.providerID, modelID: decision.modelID })
      }

      showToast({
        title: tr("{{mode}} enabled", "{{mode}} ativado", { mode: fusion.modeName(candidates()) }),
        description: tr(
          "Models will be chosen automatically based on prompt complexity.",
          "Os modelos serão escolhidos automaticamente conforme a complexidade do prompt.",
        ),
        variant: "success",
      })

      return
    }

    fusion.disable()
    showToast({
      title: tr("Auto Mode disabled", "Auto Mode desativado"),
      description: tr("Using manual model selection.", "Usando seleção manual de modelo."),
      variant: "default",
    })
  }

  return (
    <Dialog
      size="x-large"
      containerClass="!w-[min(calc(100vw_-_32px),1040px)] !h-[min(calc(100vh_-_48px),680px)] !rounded-[12px] !bg-v2-background-bg-base"
      class="[font-family:var(--v2-font-family-sans)]"
    >
      <DialogHeader closeLabel={tr("Close", "Fechar")}>
        <div class="flex items-start gap-2.5 min-w-0">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-v2-surface-surface-raised border border-v2-border-border-base text-v2-icon-icon-base mt-0.5">
            <BoltIcon class="size-4" />
          </div>
          <DialogTitleGroup
            title={tr(
              "Onethy Fusion Matrix — Auto Mode & Model Pool",
              "Onethy Fusion Matrix — Auto Mode & Pool de Modelos",
            )}
            description={tr(
              "Enable Auto Mode, choose the optimization tier, and select which models participate in automatic routing",
              "Ative o Auto Mode, escolha o nível de otimização e marque quais modelos participam do roteamento automático",
            )}
          />
        </div>
      </DialogHeader>

      <DialogBody class="px-5 py-2 flex flex-col flex-1 min-h-0 gap-3 overflow-hidden">
        {/* Top Interactive Control Strip */}
        <div class="flex flex-wrap items-center justify-between gap-2.5 p-3 rounded-lg bg-v2-surface-surface-raised border border-v2-border-border-base shrink-0">
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer"
              classList={{
                "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40": fusion.enabled(),
                "bg-v2-background-bg-base text-v2-text-text-muted border-v2-border-border-base hover:text-v2-text-text-base":
                  !fusion.enabled(),
              }}
              onClick={handleToggleAuto}
            >
              <span
                class="size-2 rounded-full shrink-0"
                classList={{
                  "bg-emerald-500": fusion.enabled(),
                  "bg-v2-icon-icon-muted opacity-50": !fusion.enabled(),
                }}
              />
              <BoltIcon class="size-3.5 shrink-0" />
              <span>Auto Mode: {fusion.enabled() ? tr("ON", "ATIVO") : "OFF"}</span>
            </button>

            <div class="flex items-center gap-1 p-0.5 rounded-md bg-v2-background-bg-base border border-v2-border-border-base">
              <For each={tierButtons()}>
                {(btn) => {
                  const selected = () => fusion.enabled() && fusion.tier() === btn.id

                  return (
                    <button
                      type="button"
                      class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
                      classList={{
                        "bg-v2-overlay-simple-overlay-hover text-v2-text-text-base shadow-sm": selected(),
                        "text-v2-text-text-muted hover:text-v2-text-text-base": !selected(),
                      }}
                      onClick={() => fusion.setTier(btn.id)}
                    >
                      <TierIcon tier={btn.id} class="size-3.5 shrink-0" />
                      <span>{btn.label}</span>
                    </button>
                  )
                }}
              </For>
            </div>

            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer"
              classList={{
                "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/35": fusion.thinkingRouting(),
                "bg-v2-background-bg-base text-v2-text-text-muted border-v2-border-border-base hover:text-v2-text-text-base":
                  !fusion.thinkingRouting(),
              }}
              onClick={() => fusion.toggleThinkingRouting()}
              title={tr(
                "Automatically allocates reasoning effort (low for quick queries, max for architecture)",
                "Aloca automaticamente esforço de raciocínio (low em consultas rápidas, max em arquitetura)",
              )}
            >
              <Icon name="outline-brain" size="small" />
              <span>Thinking Routing: {fusion.thinkingRouting() ? "ON" : "OFF"}</span>
            </button>
          </div>
        </div>

        {/* View Switcher & Pool Presets */}
        <div class="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div class="flex items-center gap-1 p-0.5 rounded-md bg-v2-surface-surface-raised border border-v2-border-border-base">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
              classList={{
                "bg-v2-overlay-simple-overlay-hover text-v2-text-text-base shadow-sm": viewMode() === "tiers",
                "text-v2-text-text-muted hover:text-v2-text-text-base": viewMode() !== "tiers",
              }}
              onClick={() => setViewMode("tiers")}
            >
              <Icon name="dot-grid" size="small" />
              <span>{tr("By Capability (3 Columns)", "Por Capacidade (3 Colunas)")}</span>
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
              classList={{
                "bg-v2-overlay-simple-overlay-hover text-v2-text-text-base shadow-sm": viewMode() === "providers",
                "text-v2-text-text-muted hover:text-v2-text-text-base": viewMode() !== "providers",
              }}
              onClick={() => setViewMode("providers")}
            >
              <Icon name="server" size="small" />
              <span>
                {tr("By Provider ({{count}})", "Por Provedor ({{count}})", { count: modelsByProvider().length })}
              </span>
            </button>
          </div>

          <div class="flex items-center gap-2">
            <Button size="small" variant="neutral" onClick={handleRecommendedPreset}>
              <span class="inline-flex items-center gap-1.5">
                <Icon name="models" size="small" />
                <span>{tr("Recommended Preset", "Preset Recomendado")}</span>
              </span>
            </Button>
            <Button size="small" variant="ghost" onClick={handleAllowAll}>
              <span class="inline-flex items-center gap-1.5">
                <Icon name="circle-check" size="small" />
                <span>{tr("Select All", "Selecionar Todos")}</span>
              </span>
            </Button>
          </div>
        </div>

        {/* View 1: 3-Column Capability Matrix */}
        <Show when={viewMode() === "tiers"}>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1 min-h-0 overflow-hidden">
            <For each={tiers()}>
              {(tier) => {
                const tierModels = () => modelsByBucket()[tier.bucket]

                return (
                  <div class="flex flex-col min-h-0 min-w-0 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised overflow-hidden">
                    <div class="p-3 border-b border-v2-border-border-base flex flex-col gap-1 bg-v2-background-bg-base/50 shrink-0">
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-1.5 min-w-0 text-v2-text-text-base">
                          <TierIcon tier={tier.bucket} class="size-4 shrink-0" />
                          <h4 class="font-semibold text-xs truncate">{tier.title}</h4>
                        </div>
                        <span class={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${tier.badgeClass}`}>
                          {tierModels().length}
                        </span>
                      </div>
                      <span class="text-[11px] leading-4 text-v2-text-text-faint">{tier.description}</span>
                    </div>

                    <div class="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1.5">
                      <Show
                        when={tierModels().length > 0}
                        fallback={
                          <div class="flex flex-col items-center justify-center p-6 text-center text-v2-text-text-faint text-xs">
                            <span>
                              {tr("No connected models in this category", "Nenhum modelo conectado nesta categoria")}
                            </span>
                          </div>
                        }
                      >
                        <For each={tierModels()}>
                          {(item) => {
                            const isCurrent = () => activeModelKey() === `${item.provider.id}:${item.id}`
                            const allowed = () => fusion.isModelAllowed(item.provider.id, item.id)

                            return (
                              <div
                                class="flex items-center gap-2 p-2 rounded-md border transition-colors min-w-0"
                                classList={{
                                  "bg-v2-overlay-simple-overlay-hover border-v2-border-border-strong": isCurrent(),
                                  "bg-v2-background-bg-base border-v2-border-border-faint hover:border-v2-border-border-base":
                                    !isCurrent(),
                                  "opacity-55": !allowed(),
                                }}
                              >
                                <button
                                  type="button"
                                  class="flex size-5 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer"
                                  classList={{
                                    "bg-emerald-500/20 border-emerald-500/50 text-emerald-600 dark:text-emerald-400":
                                      allowed(),
                                    "bg-transparent border-v2-border-border-base text-transparent": !allowed(),
                                  }}
                                  title={
                                    allowed()
                                      ? tr("Remove from Omni Fusion pool", "Remover do pool do Omni Fusion")
                                      : tr("Include in Omni Fusion pool", "Incluir no pool do Omni Fusion")
                                  }
                                  onClick={() => handleToggleModel(item.provider.id, item.id)}
                                >
                                  <Icon name="check" size="small" />
                                </button>

                                <div class="flex items-center gap-1.5 min-w-0 flex-1">
                                  <ProviderModelIcon
                                    provider={item.provider}
                                    class="shrink-0 size-4 text-v2-icon-icon-base"
                                  />
                                  <div class="flex flex-col min-w-0">
                                    <span class="text-xs font-medium text-v2-text-text-base truncate">{item.name}</span>
                                    <span class="text-[10px] text-v2-text-text-faint truncate font-mono">
                                      {item.provider.name}
                                    </span>
                                  </div>
                                </div>

                                <Show
                                  when={isCurrent() && !fusion.enabled()}
                                  fallback={
                                    <button
                                      type="button"
                                      class="px-2 py-0.5 rounded text-[11px] font-medium bg-v2-surface-surface-raised hover:bg-v2-overlay-simple-overlay-hover text-v2-text-text-muted hover:text-v2-text-text-base border border-v2-border-border-base shrink-0 cursor-pointer"
                                      onClick={() => handleUseNow(item.provider.id, item.id)}
                                    >
                                      {tr("Use", "Usar")}
                                    </button>
                                  }
                                >
                                  <Badge class="shrink-0 text-[10px]">{tr("Active", "Ativo")}</Badge>
                                </Show>
                              </div>
                            )
                          }}
                        </For>
                      </Show>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>

        {/* View 2: Provider Columns (TUI Parity Pool Selector) */}
        <Show when={viewMode() === "providers"}>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1 min-h-0 overflow-y-auto pr-0.5">
            <For each={modelsByProvider()}>
              {(group) => {
                const selectedInGroup = () =>
                  group.items.filter((item) => fusion.isModelAllowed(item.provider.id, item.id)).length

                return (
                  <div class="flex flex-col min-h-[240px] max-h-[380px] min-w-0 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised overflow-hidden">
                    <button
                      type="button"
                      class="p-2.5 border-b border-v2-border-border-base flex items-center justify-between gap-2 bg-v2-background-bg-base/60 hover:bg-v2-overlay-simple-overlay-hover transition-colors text-left cursor-pointer shrink-0"
                      title={tr(
                        "Click to select or deselect all models from this provider",
                        "Clique para marcar ou desmarcar todos os modelos deste provedor",
                      )}
                      onClick={() => handleToggleProvider(group.id, group.name)}
                    >
                      <div class="flex items-center gap-2 min-w-0">
                        <ProviderModelIcon provider={group.provider} class="size-4 shrink-0 text-v2-icon-icon-base" />
                        <span class="font-semibold text-xs text-v2-text-text-base truncate">{group.name}</span>
                      </div>
                      <Badge class="shrink-0 text-[10px]">
                        {selectedInGroup()}/{group.items.length}
                      </Badge>
                    </button>

                    <div class="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1">
                      <For each={group.items}>
                        {(item) => {
                          const allowed = () => fusion.isModelAllowed(item.provider.id, item.id)
                          const bucket = classifyModelBucket(item.id, item.name)
                          const meta = () => bucketMeta()[bucket]

                          return (
                            <div
                              class="flex items-center gap-2 px-2 py-1.5 rounded-md border border-v2-border-border-faint bg-v2-background-bg-base hover:border-v2-border-border-base transition-colors min-w-0"
                              classList={{ "opacity-55": !allowed() }}
                            >
                              <button
                                type="button"
                                class="flex size-4 shrink-0 items-center justify-center rounded border cursor-pointer"
                                classList={{
                                  "bg-emerald-500/20 border-emerald-500/50 text-emerald-600 dark:text-emerald-400":
                                    allowed(),
                                  "bg-transparent border-v2-border-border-base text-transparent": !allowed(),
                                }}
                                onClick={() => handleToggleModel(item.provider.id, item.id)}
                              >
                                <Icon name="check" size="small" />
                              </button>
                              <span
                                class="text-xs text-v2-text-text-base truncate flex-1 cursor-pointer"
                                onClick={() => handleToggleModel(item.provider.id, item.id)}
                              >
                                {item.name}
                              </span>
                              <span
                                class={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${meta().badgeClass}`}
                              >
                                <TierIcon tier={bucket} class="size-3 shrink-0" />
                                <span>{meta().shortLabel}</span>
                              </span>
                            </div>
                          )
                        }}
                      </For>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </DialogBody>

      <DialogFooter>
        <div class="flex items-center justify-between w-full gap-3">
          <span class="text-xs text-v2-text-text-muted truncate">
            {tr("Active pool:", "Pool ativo:")} <strong class="text-v2-text-text-base">{poolSummary()}</strong>
            <Show when={modelState().current()}>
              {(active) => (
                <span>
                  {" "}
                  · {tr("Current model:", "Modelo atual:")}{" "}
                  <code class="font-mono text-v2-text-text-base">{active().name}</code>
                </span>
              )}
            </Show>
          </span>
          <Button variant="submit" onClick={props.onClose}>
            {tr("Done", "Concluir")}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
