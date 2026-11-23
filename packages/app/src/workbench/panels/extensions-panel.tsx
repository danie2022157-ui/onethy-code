import { batch, createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { PluginFeatures, PluginInfo } from "@opencode/client/promise"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { pluginLabel } from "@/providers/catalog/plugin"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { usePlatform } from "@/runtime/platform/platform"
import { useSettingsDialog } from "@/settings/command"
import { showToast } from "@/shell/notifications/toast"
import { ExtensionsBlocksIcon, SearchCodeIcon, SettingsGearIcon } from "../icons"
import { useWorkbench } from "../state"

type TranslateFn = ReturnType<typeof useOnethyI18n>["tr"]

type PluginFilter = "all" | "external" | "builtin" | "failed"

export function ExtensionsPanel() {
  const workbench = useWorkbench()
  const platform = usePlatform()
  const openExtensionsSettings = useSettingsDialog("extensions")
  const { tr } = useOnethyI18n()

  const [plugins, setPlugins] = createSignal<readonly PluginInfo[]>([])
  const [loading, setLoading] = createSignal(false)
  const [checking, setChecking] = createSignal(false)
  const [updatingAll, setUpdatingAll] = createSignal(false)
  const [loadError, setLoadError] = createSignal<string | undefined>(undefined)
  const [filter, setFilter] = createSignal<PluginFilter>("all")
  const [query, setQuery] = createSignal("")
  const [busyTargets, setBusyTargets] = createStore<Record<string, "check" | "update" | undefined>>({})
  const [expandedErrors, setExpandedErrors] = createStore<Record<string, boolean>>({})

  let loadGeneration = 0

  const location = createMemo(() => {
    const ctx = workbench.activeServerCtx()

    if (!ctx) return undefined

    return workbench.activeLocation() ?? ctx.data.location.default()
  })

  const packagePlugins = createMemo(() =>
    plugins().flatMap((plugin) => (plugin.source.type === "package" ? [{ plugin, source: plugin.source }] : [])),
  )

  const outdatedTargets = createMemo(() =>
    packagePlugins()
      .filter((entry) => entry.source.outdated === true)
      .map((entry) => entry.source.target),
  )

  const allPackageTargets = createMemo(() => packagePlugins().map((entry) => entry.source.target))

  const counts = createMemo(() => {
    const list = plugins()
    const active = list.filter((item) => item.state.status === "active").length
    const failed = list.filter((item) => item.state.status === "failed").length
    const external = list.filter((item) => item.source.type !== "builtin").length
    const builtin = list.filter((item) => item.source.type === "builtin").length

    return {
      all: list.length,
      active,
      failed,
      external,
      builtin,
      outdated: outdatedTargets().length,
    }
  })

  const filteredPlugins = createMemo(() => {
    const activeFilter = filter()
    const term = query().trim().toLowerCase()

    return [...plugins()]
      .filter((plugin) => {
        if (activeFilter === "external" && plugin.source.type === "builtin") return false

        if (activeFilter === "builtin" && plugin.source.type !== "builtin") return false

        if (activeFilter === "failed" && plugin.state.status !== "failed") return false

        if (!term) return true

        const sourceDetail = sourceText(plugin, tr)
        const errorText = plugin.state.status === "failed" ? plugin.state.error : ""
        const haystack = `${pluginLabel(plugin)} ${plugin.id ?? ""} ${plugin.source.type} ${sourceDetail} ${plugin.state.status} ${errorText}`.toLowerCase()

        return haystack.includes(term)
      })
      .sort((a, b) => {
        if (a.state.status !== b.state.status) return a.state.status === "failed" ? -1 : 1
        const aBuiltin = a.source.type === "builtin" ? 1 : 0
        const bBuiltin = b.source.type === "builtin" ? 1 : 0

        if (aBuiltin !== bBuiltin) return aBuiltin - bBuiltin

        return pluginLabel(a).localeCompare(pluginLabel(b), undefined, { sensitivity: "base" })
      })
  })

  const loadPlugins = async () => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc) return

    const generation = ++loadGeneration
    setLoading(true)
    setLoadError(undefined)

    const outcome = await ctx.sdk.api.plugin
      .list({ location: loc })
      .then((res) => ({ ok: true as const, data: res.data }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    if (generation !== loadGeneration) return

    batch(() => {
      setLoading(false)

      if (!outcome.ok) {
        setLoadError(outcome.message)

        return
      }

      setPlugins(outcome.data)
      setLoadError(undefined)
    })
  }

  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc) {
      loadGeneration += 1
      batch(() => {
        setPlugins([])
        setLoading(false)
        setLoadError(undefined)
      })

      return
    }

    void loadPlugins()
  })

  const handleCheckAll = async () => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc || checking()) return

    setChecking(true)

    const outcome = await ctx.sdk.api.plugin
      .check({ location: loc })
      .then((res) => ({ ok: true as const, data: res.data }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    setChecking(false)

    if (!outcome.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to check for updates", "Falha ao verificar atualizações"),
        description: outcome.message,
      })

      return
    }

    setPlugins(outcome.data)

    const outdated = outcome.data.filter(
      (item) => item.source.type === "package" && item.source.outdated === true,
    ).length

    showToast({
      variant: outdated > 0 ? "default" : "success",
      title:
        outdated > 0
          ? outdated === 1
            ? tr("1 outdated extension", "1 extensão desatualizada")
            : tr("{{count}} outdated extensions", "{{count}} extensões desatualizadas", { count: outdated })
          : tr("All extensions are up to date", "Todas as extensões estão atualizadas"),
    })
  }

  const handleCheckTarget = async (target: string) => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc || busyTargets[target]) return

    setBusyTargets(target, "check")

    const outcome = await ctx.sdk.api.plugin
      .check({ location: loc, target })
      .then((res) => ({ ok: true as const, data: res.data }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    setBusyTargets(target, undefined)

    if (!outcome.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to check {{target}}", "Falha ao verificar {{target}}", { target }),
        description: outcome.message,
      })

      return
    }

    setPlugins(outcome.data)
    const entry = outcome.data.find((item) => item.source.type === "package" && item.source.target === target)
    const isOutdated = entry?.source.type === "package" && entry.source.outdated === true

    showToast({
      variant: isOutdated ? "default" : "success",
      title: isOutdated
        ? tr("Update available for {{target}}", "Atualização disponível para {{target}}", { target })
        : tr("{{target}} is already up to date", "{{target}} já está na última versão", { target }),
    })
  }

  const handleUpdateTargets = async (targets: readonly string[], label: string, singleTarget?: string) => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc || targets.length === 0) return

    if (singleTarget) {
      if (busyTargets[singleTarget]) return
      setBusyTargets(singleTarget, "update")
    } else {
      if (updatingAll()) return
      setUpdatingAll(true)
    }

    const outcome = await ctx.sdk.api.plugin
      .update({ location: loc, targets })
      .then(() => ({ ok: true as const }))
      .catch((err) => ({
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      }))

    if (singleTarget) {
      setBusyTargets(singleTarget, undefined)
    } else {
      setUpdatingAll(false)
    }

    if (!outcome.ok) {
      showToast({
        variant: "error",
        title: tr("Failed to update {{label}}", "Falha ao atualizar {{label}}", { label }),
        description: outcome.message,
      })

      return
    }

    await loadPlugins()
    showToast({
      variant: "success",
      title: tr("{{label}} updated", "{{label}} atualizado", { label }),
      description: tr("Plugin list reloaded from server.", "Lista de plugins recarregada do servidor."),
    })
  }

  const handleUpdateHeader = () => {
    const targets = outdatedTargets().length > 0 ? outdatedTargets() : allPackageTargets()

    if (targets.length === 0) return
    const label =
      targets.length === 1
        ? targets[0]
        : tr("{{count}} extensions", "{{count}} extensões", { count: targets.length })
    void handleUpdateTargets(targets, label)
  }

  const copyError = async (text: string) => {
    const writer = platform.writeClipboardText
      ? platform.writeClipboardText(text)
      : navigator.clipboard.writeText(text)

    const ok = await writer.then(() => true).catch(() => false)

    if (!ok) {
      showToast({ variant: "error", title: tr("Could not copy error", "Não foi possível copiar o erro") })

      return
    }

    showToast({ variant: "success", title: tr("Error details copied", "Detalhes do erro copiados") })
  }

  const filterPills: readonly { id: PluginFilter; label: () => string; count: () => number }[] = [
    { id: "all", label: () => tr("All", "Todos"), count: () => counts().all },
    { id: "external", label: () => tr("Installed", "Instalados"), count: () => counts().external },
    { id: "builtin", label: () => tr("Built-in", "Nativos"), count: () => counts().builtin },
    { id: "failed", label: () => tr("Failed", "Falhas"), count: () => counts().failed },
  ]

  return (
    <Show
      when={workbench.activeServerCtx()}
      fallback={
        <div class="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
          <div class="flex size-10 items-center justify-center rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
            <ExtensionsBlocksIcon size={18} />
          </div>
          <div class="text-[12.5px] font-medium text-v2-text-text-base">
            {tr("No active server", "Nenhum servidor ativo")}
          </div>
          <p class="max-w-[210px] text-[11.5px] leading-4 text-v2-text-text-faint">
            {tr(
              "Connect to a server to manage workspace plugins and extensions.",
              "Conecte-se a um servidor para gerenciar plugins e extensões do workspace.",
            )}
          </p>
        </div>
      }
    >
      <div class="flex min-h-0 flex-1 flex-col bg-v2-background-bg-base text-v2-text-text-base">
        {/* Top summary & settings button */}
        <div class="flex shrink-0 items-center justify-between gap-1.5 border-b border-v2-border-border-muted px-2.5 py-1.5">
          <div class="flex min-w-0 items-center gap-1.5">
            <span
              class={`size-2 shrink-0 rounded-full ${
                counts().failed > 0
                  ? "bg-v2-state-fg-danger"
                  : counts().active > 0
                    ? "bg-v2-state-fg-success"
                    : "bg-v2-icon-icon-muted opacity-50"
              }`}
              aria-hidden="true"
            />
            <span class="truncate text-[11.5px] font-semibold text-v2-text-text-base">
              {tr("{{active}}/{{all}} active", "{{active}}/{{all}} ativos", {
                active: counts().active,
                all: counts().all,
              })}
            </span>
            <Show when={counts().outdated > 0}>
              <span class="shrink-0 rounded-full bg-v2-state-bg-warning px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-v2-state-fg-warning">
                {counts().outdated === 1
                  ? tr("1 update", "1 atualização")
                  : tr("{{count}} updates", "{{count}} atualizações", { count: counts().outdated })}
              </span>
            </Show>
          </div>

          <div class="flex shrink-0 items-center gap-0.5">
            <Tooltip placement="bottom" value={tr("Open Extensions Settings", "Abrir Configurações de Extensões")}>
              <button
                type="button"
                class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                aria-label={tr("Open Extensions Settings", "Abrir Configurações de Extensões")}
                onClick={() => openExtensionsSettings()}
              >
                <SettingsGearIcon size={13.5} />
              </button>
            </Tooltip>

            <Tooltip placement="bottom" value={tr("Reload plugins", "Recarregar plugins")}>
              <button
                type="button"
                class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
                aria-label={tr("Reload plugins", "Recarregar plugins")}
                disabled={loading()}
                onClick={() => void loadPlugins()}
              >
                <Show when={loading()} fallback={<Icon name="refresh" size="small" class="size-3.5" />}>
                  <Loader width={13} height={13} />
                </Show>
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Action bar: Check, Update */}
        <div class="flex shrink-0 items-center gap-1.5 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01/50 px-2 py-1.5">
          <button
            type="button"
            disabled={checking() || loading()}
            class="inline-flex h-6 flex-1 items-center justify-center gap-1 rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-base px-2 text-[11px] font-medium text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-50"
            onClick={() => void handleCheckAll()}
          >
            <Show when={checking()} fallback={<Icon name="refresh" size="small" class="size-3" />}>
              <Loader width={11} height={11} />
            </Show>
            <span>{tr("Check", "Verificar")}</span>
          </button>

          <Tooltip
            placement="bottom"
            value={
              allPackageTargets().length === 0
                ? tr("No package plugins installed to update", "Nenhum plugin de pacote instalado para atualizar")
                : outdatedTargets().length > 0
                  ? tr("Update {{count}} outdated package(s)", "Atualizar {{count}} pacote(s) desatualizado(s)", {
                      count: outdatedTargets().length,
                    })
                  : tr("Update {{count}} installed package(s)", "Atualizar {{count}} pacote(s) instalado(s)", {
                      count: allPackageTargets().length,
                    })
            }
          >
            <button
              type="button"
              disabled={updatingAll() || allPackageTargets().length === 0}
              class="inline-flex h-6 flex-1 items-center justify-center gap-1 rounded-[5px] border px-2 text-[11px] font-medium transition-colors disabled:opacity-45"
              classList={{
                "border-transparent bg-v2-background-bg-accent text-v2-text-text-inverse hover:opacity-90":
                  outdatedTargets().length > 0,
                "border-v2-border-border-base bg-v2-background-bg-base text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover":
                  outdatedTargets().length === 0,
              }}
              onClick={handleUpdateHeader}
            >
              <Show when={updatingAll()} fallback={<Icon name="download" size="small" class="size-3" />}>
                <Loader width={11} height={11} />
              </Show>
              <span>
                {outdatedTargets().length > 0
                  ? tr("Update ({{count}})", "Atualizar ({{count}})", { count: outdatedTargets().length })
                  : tr("Update", "Atualizar")}
              </span>
            </button>
          </Tooltip>
        </div>

        {/* Search input */}
        <div class="shrink-0 border-b border-v2-border-border-muted px-2 py-1.5">
          <div class="flex h-7 items-center gap-1.5 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 focus-within:border-v2-border-border-focus">
            <SearchCodeIcon size={13} class="shrink-0 text-v2-icon-icon-muted" />
            <input
              type="text"
              value={query()}
              placeholder={tr("Filter plugins and extensions...", "Filtrar plugins e extensões...")}
              aria-label={tr("Filter plugins and extensions", "Filtrar plugins e extensões")}
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
                aria-label={tr("Clear filter", "Limpar filtro")}
                onClick={() => setQuery("")}
              >
                <Icon name="outline-xmark" size="small" class="size-3" />
              </button>
            </Show>
          </div>
        </div>

        {/* Filter pills */}
        <div
          role="tablist"
          aria-label={tr("Extensions filter", "Filtro de extensões")}
          class="flex shrink-0 flex-wrap gap-1 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01/40 px-2 py-1.5"
        >
          <For each={filterPills}>
            {(pill) => {
              const active = () => filter() === pill.id

              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={active()}
                  class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors"
                  classList={{
                    "border-v2-border-border-strong bg-v2-background-bg-accent text-v2-text-text-inverse": active(),
                    "border-v2-border-border-muted bg-v2-background-bg-base text-v2-text-text-muted hover:border-v2-border-border-base hover:text-v2-text-text-base":
                      !active(),
                  }}
                  onClick={() => setFilter(pill.id)}
                >
                  <span>{pill.label()}</span>
                  <span
                    class="font-mono text-[9.5px]"
                    classList={{
                      "opacity-85": active(),
                      "text-v2-text-text-faint": !active(),
                    }}
                  >
                    {pill.count()}
                  </span>
                </button>
              )
            }}
          </For>
        </div>

        {/* Plugin list */}
        <div data-slot="workbench-scroll" class="min-h-0 flex-1 overflow-y-auto p-2">
          <Show when={loadError()}>
            {(message) => (
              <div class="mb-2 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger px-2.5 py-1.5 text-[11px] text-v2-state-fg-danger">
                {message()}
              </div>
            )}
          </Show>

          <Show
            when={!loading() || plugins().length > 0}
            fallback={
              <div class="flex items-center justify-center gap-2 py-8 text-[12px] text-v2-text-text-faint">
                <Loader width={14} height={14} />
                <span>{tr("Loading extensions...", "Carregando extensões...")}</span>
              </div>
            }
          >
            <Show
              when={filteredPlugins().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                  <div class="flex size-9 items-center justify-center rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
                    <ExtensionsBlocksIcon size={16} />
                  </div>
                  <div class="text-[12px] font-medium text-v2-text-text-base">
                    {query().trim()
                      ? tr("No extensions found", "Nenhuma extensão encontrada")
                      : tr("No extensions in this category", "Nenhuma extensão nesta categoria")}
                  </div>
                  <p class="max-w-[215px] text-[11px] leading-4 text-v2-text-text-faint">
                    {tr(
                      "Manage server plugins and installed extensions in Settings.",
                      "Gerencie plugins do servidor e extensões instaladas nas Configurações.",
                    )}
                  </p>
                </div>
              }
            >
              <div class="flex flex-col gap-1.5">
                <For each={filteredPlugins()}>
                  {(plugin) => {
                    const key = () => pluginRowKey(plugin)
                    const label = () => pluginLabel(plugin)
                    const failed = () => plugin.state.status === "failed"

                    const errorInfo = () =>
                      plugin.state.status === "failed"
                        ? { error: plugin.state.error, ref: plugin.state.ref }
                        : undefined

                    const errorOpen = () => Boolean(expandedErrors[key()])
                    const pkg = () => (plugin.source.type === "package" ? plugin.source : undefined)

                    const targetBusy = () => {
                      const source = pkg()

                      return source ? busyTargets[source.target] : undefined
                    }

                    const features = () => featureLabels(plugin.features)

                    return (
                      <div class="rounded-[7px] border border-v2-border-border-muted bg-v2-background-bg-layer-01/60 transition-colors hover:border-v2-border-border-base">
                        <div class="flex flex-col gap-1.5 px-2.5 py-2">
                          <div class="flex items-start justify-between gap-1.5">
                            <div class="flex min-w-0 flex-1 items-start gap-1.5">
                              <Icon name="cube" size="small" class="mt-0.5 size-3.5 shrink-0 text-v2-icon-icon-muted" />
                              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span
                                  class="truncate text-[12px] font-medium text-v2-text-text-base"
                                  title={label()}
                                >
                                  {label()}
                                </span>
                                <span
                                  class="truncate font-mono text-[10px] text-v2-text-text-faint"
                                  title={sourceText(plugin, tr)}
                                >
                                  {sourceText(plugin, tr)}
                                </span>
                              </div>
                            </div>

                            <span
                              class="shrink-0 rounded-full border px-1.5 py-0.5 text-[9.5px] font-semibold leading-none"
                              classList={{
                                "border-v2-state-border-success bg-v2-state-bg-success text-v2-state-fg-success":
                                  !failed(),
                                "border-v2-state-border-danger bg-v2-state-bg-danger text-v2-state-fg-danger":
                                  failed(),
                              }}
                            >
                              {failed() ? tr("Failed", "Falhou") : tr("Active", "Ativo")}
                            </span>
                          </div>

                          {/* Tags: source kind, version, outdated, features */}
                          <div class="flex flex-wrap items-center gap-1">
                            <span class="rounded bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-[9.5px] text-v2-text-text-muted">
                              {sourceKindLabel(plugin.source.type, tr)}
                            </span>

                            <Show when={pkg()?.version}>
                              {(ver) => (
                                <span class="rounded bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[9.5px] text-v2-text-text-muted">
                                  v{ver()}
                                </span>
                              )}
                            </Show>

                            <Show when={pkg()?.outdated}>
                              <span class="rounded border border-v2-state-border-warning bg-v2-state-bg-warning px-1.5 py-0.5 text-[9.5px] font-medium text-v2-state-fg-warning">
                                {tr("Outdated", "Desatualizado")}
                              </span>
                            </Show>

                            <Show when={pkg()?.updating}>
                              <span class="rounded border border-v2-border-border-base bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-[9.5px] text-v2-text-text-accent">
                                {tr("Updating...", "Atualizando...")}
                              </span>
                            </Show>

                            <For each={features()}>
                              {(feat) => (
                                <span class="rounded border border-v2-border-border-muted px-1 py-0.5 font-mono text-[9px] text-v2-text-text-faint">
                                  {feat}
                                </span>
                              )}
                            </For>
                          </div>

                          {/* Package actions */}
                          <Show when={pkg()}>
                            {(source) => (
                              <div class="flex items-center gap-1 pt-0.5">
                                <button
                                  type="button"
                                  disabled={Boolean(targetBusy())}
                                  class="inline-flex h-6 items-center gap-1 rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-base px-2 text-[10.5px] font-medium text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
                                  onClick={() => void handleCheckTarget(source().target)}
                                >
                                  <Show when={targetBusy() === "check"}>
                                    <Loader width={10} height={10} />
                                  </Show>
                                  <span>{tr("Check", "Verificar")}</span>
                                </button>

                                <button
                                  type="button"
                                  disabled={Boolean(targetBusy()) || Boolean(source().updating)}
                                  class="inline-flex h-6 items-center gap-1 rounded-[5px] border px-2 text-[10.5px] font-medium transition-colors disabled:opacity-50"
                                  classList={{
                                    "border-transparent bg-v2-background-bg-accent text-v2-text-text-inverse hover:opacity-90":
                                      source().outdated === true,
                                    "border-v2-border-border-base bg-v2-background-bg-base text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover":
                                      source().outdated !== true,
                                  }}
                                  onClick={() =>
                                    void handleUpdateTargets([source().target], label(), source().target)
                                  }
                                >
                                  <Show when={targetBusy() === "update" || source().updating}>
                                    <Loader width={10} height={10} />
                                  </Show>
                                  <span>{tr("Update", "Atualizar")}</span>
                                </button>
                              </div>
                            )}
                          </Show>
                        </div>

                        {/* Expandable error details */}
                        <Show when={errorInfo()}>
                          {(info) => (
                            <div class="border-t border-v2-border-border-muted/80 px-2.5 py-1.5">
                              <button
                                type="button"
                                class="flex w-full items-center justify-between gap-1 text-left text-[10.5px] font-medium text-v2-state-fg-danger hover:opacity-85"
                                aria-expanded={errorOpen()}
                                onClick={() => setExpandedErrors(key(), !errorOpen())}
                              >
                                <span class="inline-flex items-center gap-1">
                                  <Icon
                                    name="outline-chevron-right"
                                    size="small"
                                    class="size-3 transition-transform duration-150"
                                    classList={{ "rotate-90": errorOpen() }}
                                  />
                                  <span>
                                    {errorOpen()
                                      ? tr("Hide error", "Ocultar erro")
                                      : tr("View error details", "Ver detalhes do erro")}
                                  </span>
                                </span>
                                <Icon name="circle-xmark" size="small" class="size-3" />
                              </button>

                              <Show when={errorOpen()}>
                                <div class="mt-1.5 flex flex-col gap-1.5">
                                  <pre class="max-h-36 overflow-y-auto rounded-[5px] border border-v2-border-border-muted bg-v2-background-bg-deep p-2 font-mono text-[10.5px] leading-4 whitespace-pre-wrap break-words text-v2-state-fg-danger">
                                    {info().error}
                                  </pre>
                                  <div class="flex items-center justify-between gap-2">
                                    <Show when={info().ref} fallback={<span />}>
                                      {(ref) => (
                                        <span class="truncate font-mono text-[9.5px] text-v2-text-text-faint">
                                          ref: {ref()}
                                        </span>
                                      )}
                                    </Show>
                                    <button
                                      type="button"
                                      class="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                                      onClick={() => void copyError(info().error)}
                                    >
                                      <Icon name="outline-copy" size="small" class="size-3" />
                                      <span>{tr("Copy error", "Copiar erro")}</span>
                                    </button>
                                  </div>
                                </div>
                              </Show>
                            </div>
                          )}
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </div>

        {/* Footer button: Settings -> Extensions */}
        <div class="shrink-0 border-t border-v2-border-border-muted bg-v2-background-bg-layer-01/40 p-2">
          <button
            type="button"
            class="flex h-7 w-full items-center justify-center gap-1.5 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-base px-2.5 text-[11.5px] font-medium text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover"
            onClick={() => openExtensionsSettings()}
          >
            <SettingsGearIcon size={13} class="text-v2-icon-icon-muted" />
            <span>{tr("Extensions Settings", "Configurações de Extensões")}</span>
          </button>
        </div>
      </div>
    </Show>
  )
}

function pluginRowKey(plugin: PluginInfo) {
  if (plugin.id) return `${plugin.source.type}:${plugin.id}`

  if (plugin.source.type === "package") return `package:${plugin.source.target}`

  if (plugin.source.type === "local") return `local:${plugin.source.path}`

  return plugin.source.type
}

function sourceKindLabel(type: PluginInfo["source"]["type"], tr: TranslateFn) {
  if (type === "builtin") return tr("Built-in", "Nativo")

  if (type === "package") return tr("Package", "Pacote")

  if (type === "local") return tr("Local", "Local")

  return "SDK"
}

function sourceText(plugin: PluginInfo, tr: TranslateFn) {
  if (plugin.source.type === "package") return plugin.source.target

  if (plugin.source.type === "local") return plugin.source.path

  if (plugin.source.type === "builtin") return tr("Built into the server", "Integrado ao servidor")

  return tr("Registered via SDK", "Registrado via SDK")
}

function featureLabels(features: PluginFeatures) {
  const result: string[] = []

  if (features.server) result.push("server")

  if (features.tui) result.push("tui")

  if (features.rpc) result.push("rpc")

  if (features.gui) result.push("gui")

  return result
}
