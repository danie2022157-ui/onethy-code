import { Show, createEffect, createMemo, createSignal } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Menu } from "@opencode/ui/menu"
import { Slash } from "@opencode/ui/slash"
import { Tooltip } from "@opencode/ui/tooltip"
import { ComposerEditor } from "./editor/editor"
import { DialogSelectModel, ModelSelectorDrawer } from "@/providers/models/select-dialog"
import { DialogSelectModelUnpaid } from "@/providers/models/unpaid"
import { DialogFusionModels } from "@/providers/models/fusion-dialog"
import { BoltIcon } from "@/providers/models/fusion-icons"
import { useFusion } from "@/providers/models/fusion"
import { formatKeybind, useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import type { FusionTier } from "@opencode/client/fusion"
import type { ComposerModel } from "./model"
import type { ComposerModelLabel } from "./model-label"

export function Composer(props: {
  class?: string
  model: ComposerModel
  borderUnderlay?: boolean
  readOnly?: boolean
  suggestionBoundary?: () => HTMLElement | undefined
}) {
  const dialog = useDialog()
  const command = useCommand()
  const language = useLanguage()
  const { tr } = useOnethyI18n()
  const fusion = useFusion()

  const modelName = () => {
    const preview = props.model.model.preview

    if (preview) return preview.model
    const selection = props.model.model.selection
    const model = selection.current()

    if (model) return model.name
    const key = selection.key()

    if (key) return language.t("dialog.model.unavailable", { model: key.modelID })

    return language.t("dialog.model.select.title")
  }

  const modelLabel = () => {
    const preview = props.model.model.preview
    const label = preview ? preview.label : props.model.model.label

    if (label) return label

    return { provider: preview ? preview.provider : props.model.model.providerName, model: modelName() }
  }

  const openFusionMatrix = () => {
    void dialog.show(
      () => <DialogFusionModels selection={props.model.model.selection} onClose={() => dialog.close()} />,
      props.model.restoreFocus,
    )
  }

  const openMemoryBank = () => {
    void command.trigger("memory.bank", "palette")
  }

  const openCustomProvider = () => {
    void command.trigger("provider.custom", "palette")
  }

  return (
    <div class="flex flex-col gap-3">
      <ComposerEditor
        controller={props.model}
        borderUnderlay={props.borderUnderlay}
        readOnly={props.readOnly}
        class={props.class}
        modelControlsVisible={!props.model.model.loading || !!props.model.model.preview}
        hideVariant={fusion.enabled()}
        attachKeybind={command.keybindParts("file.attach")}
        attachShortcut={command.keybind("file.attach")}
        alternateKeybind={[formatKeybind("mod", language.t), "↵"]}
        exitShellKeybind={[formatKeybind("esc", language.t)]}
        suggestionBoundary={props.suggestionBoundary}
        extraAddMenuItems={
          <>
            <Menu.Item onSelect={openFusionMatrix} shortcut="/fusion">
              <span class="inline-flex items-center gap-2">
                <BoltIcon class="size-3.5 text-v2-icon-icon-muted" />
                <span>Onethy Fusion Matrix</span>
              </span>
            </Menu.Item>
            <Menu.Item onSelect={openMemoryBank} shortcut="/memory">
              <span class="inline-flex items-center gap-2">
                <Icon name="outline-brain" size="small" class="text-v2-icon-icon-muted" />
                <span>Memory Bank (.omnicode)</span>
              </span>
            </Menu.Item>
            <Menu.Item onSelect={openCustomProvider} shortcut="/connect">
              <span class="inline-flex items-center gap-2">
                <Icon name="outline-globe-plus" size="small" class="text-v2-icon-icon-muted" />
                <span>{tr("Custom Provider", "Provedor Personalizado")}</span>
              </span>
            </Menu.Item>
          </>
        }
        modelControl={
          <ComposerModelControl
            loading={props.model.model.loading}
            preview={!!props.model.model.preview}
            paid={props.model.model.paid}
            title={language.t("command.model.choose")}
            keybind={command.keybindParts("model.choose")}
            model={props.model.model.selection}
            label={modelLabel()}
            onClose={props.model.restoreFocus}
            onUnpaidClick={() => dialog.show(() => <DialogSelectModelUnpaid model={props.model.model.selection} />)}
          />
        }
        extraControls={
          <ComposerFusionControl
            model={props.model.model.selection}
            onOpenMatrix={openFusionMatrix}
          />
        }
        extraActions={
          <Tooltip placement="top" value="Memory Bank (/memory)">
            <IconButton
              data-action="composer-memory-bank"
              type="button"
              variant="ghost-muted"
              size="normal"
              class="size-7 rounded-md"
              icon={<Icon name="outline-brain" size="small" />}
              aria-label="Memory Bank"
              onMouseDown={(event: MouseEvent) => event.preventDefault()}
              onClick={openMemoryBank}
            />
          </Tooltip>
        }
      />
    </div>
  )
}

function ComposerFusionControl(props: {
  model: ComposerModel["model"]["selection"]
  onOpenMatrix: () => void
}) {
  const fusion = useFusion()
  const { tr, locale } = useOnethyI18n()

  const candidates = createMemo(() =>
    props.model.list().map((item) => ({
      providerID: item.provider.id,
      id: item.id,
      name: item.name,
      providerName: item.provider.name,
      variants: Object.keys(item.variants ?? {}),
    })),
  )

  const applyTier = (tier: FusionTier) => {
    fusion.setTier(tier)
    const decision = fusion.routeForPrompt("", candidates())

    if (decision) props.model.set({ providerID: decision.providerID, modelID: decision.modelID })
  }

  const toggleAuto = () => {
    if (fusion.enabled()) {
      fusion.disable()

      return
    }

    fusion.enable()
    const decision = fusion.routeForPrompt("", candidates())

    if (decision) props.model.set({ providerID: decision.providerID, modelID: decision.modelID })
  }

  const buttonLabel = () => {
    if (!fusion.enabled()) return "Auto"

    return `${fusion.modeName(candidates())} · ${fusion.tierLabel(undefined, locale())}`
  }

  return (
    <Tooltip
      placement="top"
      value={
        fusion.enabled()
          ? tr(
              "Auto Mode active ({{summary}}) — click to adjust tier or models",
              "Auto Mode ativo ({{summary}}) — clique para ajustar nível ou modelos",
              { summary: fusion.allowedSummary(candidates(), locale()) },
            )
          : tr(
              "Enable Auto Mode / Omni Fusion (automatic model and effort routing)",
              "Ativar Auto Mode / Omni Fusion (roteamento automático de modelo e esforço)",
            )
      }
    >
      <Menu gutter={6} modal={false} placement="top-start">
        <Menu.Trigger
          as={Button}
          data-action="composer-fusion"
          variant="ghost-muted"
          size="normal"
          style={{ height: "28px" }}
          class={`max-w-[240px] justify-start gap-1 ![font-weight:460] ${
            fusion.enabled()
              ? "!bg-emerald-500/12 !text-emerald-600 dark:!text-emerald-400 border border-emerald-500/30"
              : ""
          }`}
          aria-label="Auto Mode / Omni Fusion"
        >
          <BoltIcon class="size-3.5 shrink-0" />
          <span class="truncate leading-5">{buttonLabel()}</span>
          <span class="-ms-0.5 -me-1 flex shrink-0">
            <Icon name="chevron-down" />
          </span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content style={{ "min-width": "256px" }}>
            <Menu.Item onSelect={toggleAuto}>
              <span class="inline-flex items-center gap-2">
                <BoltIcon class="size-3.5 text-v2-icon-icon-muted" />
                <span>
                  {fusion.enabled()
                    ? tr("Disable Auto Mode", "Desativar Auto Mode")
                    : tr("Enable Auto Mode (Omni Fusion)", "Ativar Auto Mode (Omni Fusion)")}
                </span>
              </span>
            </Menu.Item>
            <Menu.Separator />
            <Menu.RadioGroup
              value={fusion.enabled() ? fusion.tier() : ""}
              onChange={(value) => {
                if (
                  value === "default" ||
                  value === "efficiency" ||
                  value === "balanced" ||
                  value === "intelligence"
                ) {
                  applyTier(value)
                }
              }}
            >
              <Menu.RadioItem value="default" closeOnSelect>
                <span class="inline-flex items-center gap-2">
                  <BoltIcon class="size-3.5 text-v2-icon-icon-muted" />
                  <span>{tr("Auto (by complexity)", "Auto (por complexidade)")}</span>
                </span>
              </Menu.RadioItem>
              <Menu.RadioItem value="efficiency" closeOnSelect>
                <span class="inline-flex items-center gap-2">
                  <BoltIcon class="size-3.5 text-emerald-500" />
                  <span>{tr("Efficiency (Fast & Economical)", "Eficiência (Rápido & Econômico)")}</span>
                </span>
              </Menu.RadioItem>
              <Menu.RadioItem value="balanced" closeOnSelect>
                <span class="inline-flex items-center gap-2">
                  <Icon name="outline-sliders" size="small" class="text-blue-500" />
                  <span>{tr("Balanced (General Purpose)", "Balanceado (Uso Geral)")}</span>
                </span>
              </Menu.RadioItem>
              <Menu.RadioItem value="intelligence" closeOnSelect>
                <span class="inline-flex items-center gap-2">
                  <Icon name="outline-brain" size="small" class="text-purple-500" />
                  <span>{tr("High Intelligence (Reasoning)", "Alta Inteligência (Raciocínio)")}</span>
                </span>
              </Menu.RadioItem>
            </Menu.RadioGroup>
            <Menu.Separator />
            <Menu.Item onSelect={() => fusion.toggleThinkingRouting()}>
              <span class="inline-flex items-center gap-2">
                <Icon
                  name={fusion.thinkingRouting() ? "circle-check" : "outline-brain"}
                  size="small"
                  class={fusion.thinkingRouting() ? "text-purple-500" : "text-v2-icon-icon-muted"}
                />
                <span>
                  {fusion.thinkingRouting()
                    ? tr("Thinking Routing: Enabled", "Thinking Routing: Ativado")
                    : tr("Thinking Routing: Disabled", "Thinking Routing: Desativado")}
                </span>
              </span>
            </Menu.Item>
            <Menu.Item onSelect={props.onOpenMatrix}>
              <span class="inline-flex items-center gap-2">
                <Icon name="dot-grid" size="small" class="text-v2-icon-icon-muted" />
                <span>{tr("Configure Pool (Fusion Matrix)...", "Configurar Pool (Fusion Matrix)...")}</span>
              </span>
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </Tooltip>
  )
}

function ComposerModelControl(props: {
  loading: boolean
  preview: boolean
  paid: boolean
  title: string
  keybind: string[]
  model: ComposerModel["model"]["selection"]
  label: ComposerModelLabel
  onClose: () => void
  onUnpaidClick: () => void
}) {
  // A preview paints the chip in its resting state, and the loaded names replace it in place.
  const shouldAnimate = createMemo<boolean>((previous) => previous ?? (props.loading && !props.preview))
  const mobile = createMediaQuery("(max-width: 767px)")
  const dialog = useDialog()

  const open = (detail: number) => {
    if (!props.paid) return props.onUnpaidClick()
    // A pointer open keeps focus in the composer, so the dialog returns it to the caret. A keyboard open
    // (a click with no pointer presses) returns focus to this trigger instead of moving it to the editor.
    void dialog.show(() => <DialogSelectModel model={props.model} />, detail === 0 ? undefined : props.onClose)
  }

  // A previewed chip is visible before the catalog loads, so a click on it opens the dialog once loading finishes.
  const [deferred, setDeferred] = createSignal<number>()

  createEffect(() => {
    const detail = deferred()

    if (props.loading || detail === undefined) return
    setDeferred(undefined)
    open(detail)
  })

  const content = () => (
    <>
      <span class="flex min-w-0 whitespace-nowrap leading-4">
        <Show when={props.label.provider}>
          {(name) => (
            <>
              <bdi class="min-w-0 shrink-[2] truncate text-v2-text-text-faint">{name()}</bdi>
              <Slash />
              <span class="sr-only">{" / "}</span>
            </>
          )}
        </Show>
        <bdi class="min-w-0 truncate">{props.label.model}</bdi>
      </span>
      <span class="-ml-0.5 -mr-1 flex shrink-0">
        <Icon name="chevron-down" />
      </span>
    </>
  )

  return (
    <Show when={!props.loading || props.preview}>
      <Tooltip
        inactive={mobile()}
        placement="top"
        value={
          <>
            {props.title}
            <Keybind keys={props.keybind} variant="neutral" />
          </>
        }
      >
        {/* While loading, the drawer would open on a catalog that isn't there yet, so the inert chip stands in. */}
        <Show
          when={mobile() && !props.loading}
          fallback={
            <Button
              data-action="composer-model"
              data-control-type="dialog"
              variant="ghost-muted"
              size="normal"
              class="min-w-0 max-w-[60cqw] justify-start ![font-weight:440]"
              classList={{ "animate-in fade-in": shouldAnimate() }}
              style={{ height: "28px" }}
              onMouseDown={(event: MouseEvent) => event.preventDefault()}
              onClick={(event: MouseEvent) => {
                if (!props.loading) return open(event.detail)

                // On mobile this inert chip stands in for the drawer trigger, so a click there is dropped.
                if (!mobile()) setDeferred(event.detail)
              }}
            >
              {content()}
            </Button>
          }
        >
          <ModelSelectorDrawer
            model={props.model}
            trigger={(triggerProps) => (
              <Button
                {...triggerProps}
                variant="ghost-muted"
                size="normal"
                style={{ height: "28px" }}
                class="min-w-0 max-w-[60cqw] justify-start ![font-weight:440]"
                classList={{ "animate-in fade-in": shouldAnimate() }}
                data-action="composer-model"
                data-control-type="drawer"
              >
                {content()}
              </Button>
            )}
            onClose={props.onClose}
          />
        </Show>
      </Tooltip>
    </Show>
  )
}
