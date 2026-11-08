import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { RGBA, TextAttributes, type BoxRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { useLocal } from "../context/local"
import { DIALOG_INSET, dialogWidth, DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { Keymap } from "../context/keymap"
import { useToast } from "../ui/toast"
import { stringWidth } from "../util/string-width"

type ProviderColumnItem = {
  id: string
  name: string
  shortName: string
  providerID: string
  bucket: "efficiency" | "balanced" | "intelligence"
}

type ProviderColumn = {
  colIndex: number
  providerID: string
  title: string
  icon: string
  accentHex: string
  models: ProviderColumnItem[]
}

const PROVIDER_META: Record<string, { title: string; icon: string; accentHex: string; order: number }> = {
  openai: { title: "OpenAI", icon: "🟢", accentHex: "#10B981", order: 1 },
  google: { title: "Google", icon: "🔵", accentHex: "#38BDF8", order: 2 },
  opencode: { title: "OpenCode", icon: "🟣", accentHex: "#A855F7", order: 3 },
  anthropic: { title: "Anthropic", icon: "🟠", accentHex: "#F59E0B", order: 4 },
  deepseek: { title: "DeepSeek", icon: "🔷", accentHex: "#00F5FF", order: 5 },
  xai: { title: "xAI / Grok", icon: "⚡", accentHex: "#F43F5E", order: 6 },
}

function cleanModelLabel(name: string, id: string): string {
  const base = name
    .replace(/^(OpenAI|Google|Anthropic|OpenCode)\s*[:\-–]?\s*/i, "")
    .replace(/\bAntigravity\s+/i, "")
    .replace(/\s*\(Free\)/i, " Free")
    .trim()
  return base.length > 0 ? base : id
}

// Measure terminal cells, not JavaScript string length: emoji and wide characters
// must never push the model's classification badge out of its column.
function fitLabel(value: string, maxWidth: number): string {
  const width = Math.max(1, Math.floor(maxWidth))
  if (stringWidth(value) <= width) return value
  let result = ""
  for (const character of value) {
    if (stringWidth(result + character) >= width) break
    result += character
  }
  return result + "…"
}

export function DialogFusionModels() {
  const local = useLocal()
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const dimensions = useTerminalDimensions()

  dialog.setSize("xlarge")
  dialog.setCentered(true)

  const [colIdx, setColIdx] = createSignal(0)
  const [rowIdx, setRowIdx] = createSignal(0)
  let scroll: ScrollBoxRenderable | undefined
  const modelRows = new Map<string, BoxRenderable>()

  // The dialog is capped at 116 cells. The terminal can be much wider, so using
  // terminal width directly was packing three columns into a much smaller dialog.
  // Keep space for DialogLayout padding and the scroll bar.
  const contentWidth = createMemo(() =>
    Math.max(1, Math.min(dialogWidth("xlarge"), dimensions().width - 2) - DIALOG_INSET * 2 - 1),
  )
  const columnsPerRow = createMemo(() => (contentWidth() >= 104 ? 3 : contentWidth() >= 66 ? 2 : 1))
  const columnWidth = createMemo(() => Math.floor((contentWidth() - (columnsPerRow() - 1)) / columnsPerRow()))
  // Column border(2), padding(2), row padding(2), check(1), gaps(2), badge(4).
  const modelLabelWidth = createMemo(() => Math.max(1, columnWidth() - 13))

  const columns = createMemo<ProviderColumn[]>(() => {
    const raw = local.model.auto.rawConnectedModels()
    const provList = local.model.auto.connectedProviders()
    const provNames = new Map(provList.map((p) => [p.id, p.name]))
    const grouped = new Map<string, ProviderColumnItem[]>()

    for (const m of raw) {
      const list = grouped.get(m.providerID) ?? []
      list.push({
        id: m.id,
        name: m.name,
        shortName: cleanModelLabel(m.name, m.id),
        providerID: m.providerID,
        bucket: local.model.auto.classify(m.id, m.name),
      })
      grouped.set(m.providerID, list)
    }

    const temp: (Omit<ProviderColumn, "colIndex"> & { order: number })[] = []
    for (const [providerID, models] of grouped.entries()) {
      const meta = PROVIDER_META[providerID.toLowerCase()] ?? {
        title: provNames.get(providerID) ?? providerID,
        icon: "⚡",
        accentHex: "#00F5FF",
        order: 99,
      }
      temp.push({
        providerID,
        title: meta.title,
        icon: meta.icon,
        accentHex: meta.accentHex,
        order: meta.order,
        models,
      })
    }

    temp.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    return temp.map((col, idx) => ({ ...col, colIndex: idx }))
  })

  const columnRows = createMemo<ProviderColumn[][]>(() => {
    const cols = columns()
    const perRow = columnsPerRow()
    const rows: ProviderColumn[][] = []
    for (let i = 0; i < cols.length; i += perRow) {
      rows.push(cols.slice(i, i + perRow))
    }
    return rows
  })

  const activeCol = createMemo(() => {
    const cols = columns()
    if (cols.length === 0) return undefined
    const idx = Math.min(Math.max(0, colIdx()), cols.length - 1)
    return cols[idx]
  })

  const activeModel = createMemo(() => {
    const col = activeCol()
    if (!col || col.models.length === 0) return undefined
    const idx = Math.min(Math.max(0, rowIdx()), col.models.length - 1)
    return col.models[idx]
  })

  // Ensure keyboard navigation stays visible even when a provider has many models.
  function revealActiveRow() {
    const model = activeModel()
    if (!model || !scroll || scroll.isDestroyed) return
    const row = modelRows.get(`${model.providerID}/${model.id}`)
    if (!row || row.isDestroyed) return
    if (row.y < scroll.viewport.y) scroll.scrollBy(row.y - scroll.viewport.y)
    else if (row.y + row.height > scroll.viewport.y + scroll.viewport.height)
      scroll.scrollBy(row.y + row.height - scroll.viewport.y - scroll.viewport.height)
  }

  createEffect(() => {
    colIdx()
    rowIdx()
    columnsPerRow()
    dimensions().height
    revealActiveRow()
  })

  function moveColumn(delta: number) {
    const cols = columns()
    if (cols.length === 0) return
    const nextCol = (colIdx() + delta + cols.length) % cols.length
    const targetModels = cols[nextCol]?.models ?? []
    setColIdx(nextCol)
    setRowIdx((r) => Math.min(r, Math.max(0, targetModels.length - 1)))
  }

  function moveRow(delta: number) {
    const col = activeCol()
    if (!col || col.models.length === 0) return
    const len = col.models.length
    setRowIdx((r) => (r + delta + len) % len)
  }

  function toggleCurrentModel() {
    const m = activeModel()
    if (!m) return
    local.model.auto.toggleModelAllowed(m.providerID, m.id)
  }

  function toggleCurrentProvider() {
    const col = activeCol()
    if (!col) return
    local.model.auto.toggleProviderModels(col.providerID)
    toast.show({
      variant: "info",
      message: `Provedor ${col.title} alternado no pool do Omni Fusion`,
      duration: 2000,
    })
  }

  function triggerPreset() {
    local.model.auto.applyRecommendedPreset()
    toast.show({
      variant: "info",
      message: "⭐ Recommended Preset applied (1 Fast + 1 Reasoning/Code + 1 Backup)",
      duration: 2800,
    })
  }

  function triggerAllowAll() {
    local.model.auto.setAllowAllModels()
    toast.show({
      variant: "info",
      message: "✓ All connected models enabled in Omni Fusion",
      duration: 2200,
    })
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    enabled: true,
    commands: [
      {
        bind: "left",
        title: "Previous column",
        group: "Dialog",
        run: () => moveColumn(-1),
      },
      {
        bind: "h",
        title: "Previous column",
        group: "Dialog",
        run: () => moveColumn(-1),
      },
      {
        bind: "right",
        title: "Next column",
        group: "Dialog",
        run: () => moveColumn(1),
      },
      {
        bind: "l",
        title: "Next column",
        group: "Dialog",
        run: () => moveColumn(1),
      },
      {
        bind: "tab",
        title: "Next column",
        group: "Dialog",
        run: () => moveColumn(1),
      },
      {
        bind: "up",
        title: "Previous model",
        group: "Dialog",
        run: () => moveRow(-1),
      },
      {
        bind: "k",
        title: "Previous model",
        group: "Dialog",
        run: () => moveRow(-1),
      },
      {
        bind: "down",
        title: "Next model",
        group: "Dialog",
        run: () => moveRow(1),
      },
      {
        bind: "j",
        title: "Next model",
        group: "Dialog",
        run: () => moveRow(1),
      },
      {
        bind: "return",
        title: "Toggle model",
        group: "Dialog",
        run: () => toggleCurrentModel(),
      },
      {
        bind: "space",
        title: "Toggle model",
        group: "Dialog",
        run: () => toggleCurrentModel(),
      },
      {
        bind: "p",
        title: "Toggle provider models",
        group: "Dialog",
        run: () => toggleCurrentProvider(),
      },
      {
        bind: "a",
        title: "Allow all models",
        group: "Dialog",
        run: () => triggerAllowAll(),
      },
      {
        bind: "r",
        title: "Apply Recommended Preset",
        group: "Dialog",
        run: () => triggerPreset(),
      },
      {
        bind: "t",
        title: "Toggle Thinking Budget Routing",
        group: "Dialog",
        run: () => local.model.auto.toggleThinkingRouting(),
      },
      {
        bind: "backspace",
        title: "Back to Variants",
        group: "Dialog",
        run: () => dialog.pop(),
      },
    ],
  }))

  const bucketBadge = (bucket: "efficiency" | "balanced" | "intelligence") => {
    if (bucket === "efficiency") return { label: "Fast", color: RGBA.fromHex("#10B981") }
    if (bucket === "intelligence") return { label: "Deep", color: RGBA.fromHex("#A855F7") }
    return { label: "Bal", color: RGBA.fromHex("#38BDF8") }
  }

  const bucketFullName = (bucket: "efficiency" | "balanced" | "intelligence") => {
    if (bucket === "efficiency") return "⚡ Efficiency (Fast / Cost-Effective)"
    if (bucket === "intelligence") return "🧠 Deep Intelligence (Code & Architecture)"
    return "⚖️ Balanced (General Purpose)"
  }

  return (
    <DialogLayout
      header={
        <DialogHeader
          titleView={
            <box flexDirection="row" gap={1}>
              <text fg={RGBA.fromHex("#00F5FF")} attributes={TextAttributes.BOLD}>
                {contentWidth() < 72 ? "⚡ Omni Fusion — Models" : "⚡ Omni Fusion — Allowed Models by Provider"}
              </text>
              <Show when={contentWidth() >= 80}>
                <text fg={theme.text.muted}>({local.model.auto.allowedModelsSummary()})</text>
              </Show>
            </box>
          }
          closeLabel="esc"
        />
      }
    >
      <box flexDirection="column" gap={1}>
        {/* Top Action Bar */}
        <box
          flexDirection={contentWidth() < 90 ? "column" : "row"}
          justifyContent="space-between"
          gap={contentWidth() < 90 ? 1 : 0}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={RGBA.fromInts(0, 0, 0, 90)}
        >
          <box flexDirection="row" flexWrap="wrap" gap={1}>
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={
                local.model.auto.isAllModelsAllowed() ? RGBA.fromHex("#10B981") : RGBA.fromInts(255, 255, 255, 20)
              }
              onMouseUp={() => triggerAllowAll()}
            >
              <text
                fg={local.model.auto.isAllModelsAllowed() ? RGBA.fromHex("#000000") : theme.text.base}
                attributes={local.model.auto.isAllModelsAllowed() ? TextAttributes.BOLD : undefined}
                selectable={false}
              >
                {local.model.auto.isAllModelsAllowed() ? "✓ All Active [A]" : "○ Use All [A]"}
              </text>
            </box>

            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={RGBA.fromInts(245, 158, 11, 45)}
              onMouseUp={() => triggerPreset()}
            >
              <text fg={RGBA.fromHex("#F59E0B")} attributes={TextAttributes.BOLD} selectable={false}>
                {contentWidth() < 75 ? "Preset [R]" : "★ Recommended Preset (2-3 Models) [R]"}
              </text>
            </box>
          </box>

          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={
              local.model.auto.thinkingRouting() ? RGBA.fromInts(168, 85, 247, 55) : RGBA.fromInts(255, 255, 255, 15)
            }
            onMouseUp={() => local.model.auto.toggleThinkingRouting()}
          >
            <text
              fg={local.model.auto.thinkingRouting() ? RGBA.fromHex("#C084FC") : theme.text.muted}
              attributes={local.model.auto.thinkingRouting() ? TextAttributes.BOLD : undefined}
              selectable={false}
            >
              {contentWidth() < 75
                ? local.model.auto.thinkingRouting() ? "Thinking: ON [T]" : "Thinking: OFF [T]"
                : local.model.auto.thinkingRouting() ? "✓ Thinking Auto: ON [T]" : "○ Thinking Auto: OFF [T]"}
            </text>
          </box>
        </box>

        {/* Provider Columns Matrix (up to 3 columns per row) */}
        <scrollbox
          ref={(element: ScrollBoxRenderable) => (scroll = element)}
          maxHeight={Math.max(3, dimensions().height - (contentWidth() < 90 ? 21 : 18))}
          contentOptions={{ minHeight: 0 }}
        >
          <box flexDirection="column" gap={1}>
            <For each={columnRows()}>
              {(rowCols) => (
                <box flexDirection="row" gap={1} alignItems="stretch">
                  <For each={rowCols}>
                    {(col) => {
                      const isColActive = () => colIdx() === col.colIndex
                      const allowedCount = () =>
                        col.models.filter((m) => local.model.auto.isModelAllowed(m.providerID, m.id)).length
                      const allColAllowed = () => allowedCount() === col.models.length

                      return (
                        <box
                          flexDirection="column"
                          flexGrow={1}
                          flexBasis={0}
                          minWidth={0}
                          border={["top", "bottom", "left", "right"]}
                          borderColor={
                            isColActive() ? RGBA.fromHex(col.accentHex) : RGBA.fromInts(148, 163, 184, 55)
                          }
                          backgroundColor={
                            isColActive() ? RGBA.fromInts(15, 23, 42, 140) : RGBA.fromInts(0, 0, 0, 60)
                          }
                          paddingLeft={1}
                          paddingRight={1}
                          paddingBottom={1}
                        >
                          {/* Column Header (Provider Name + Counter + Click to Toggle Provider) */}
                          <box
                            flexDirection="row"
                            justifyContent="space-between"
                            paddingBottom={1}
                            onMouseUp={() => {
                              setColIdx(col.colIndex)
                              local.model.auto.toggleProviderModels(col.providerID)
                            }}
                          >
                            <text
                              fg={RGBA.fromHex(col.accentHex)}
                              attributes={TextAttributes.BOLD}
                              wrapMode="none"
                              selectable={false}
                            >
                              {fitLabel(`${col.icon} ${col.title}`, Math.max(1, columnWidth() - 13))}
                            </text>
                            <text
                              fg={allColAllowed() ? RGBA.fromHex("#10B981") : theme.text.muted}
                              wrapMode="none"
                              selectable={false}
                            >
                              [{allowedCount()}/{col.models.length}]
                            </text>
                          </box>

                          {/* Models List inside this Provider Column */}
                          <box flexDirection="column" gap={0}>
                            <For each={col.models}>
                              {(m, rIndex) => {
                                const isSelectedRow = () => isColActive() && rowIdx() === rIndex()
                                const isAllowed = () => local.model.auto.isModelAllowed(m.providerID, m.id)
                                const badge = bucketBadge(m.bucket)

                                return (
                                  <box
                                    ref={(element: BoxRenderable) => modelRows.set(`${m.providerID}/${m.id}`, element)}
                                    flexDirection="row"
                                    justifyContent="space-between"
                                    minWidth={0}
                                    paddingLeft={1}
                                    paddingRight={1}
                                    backgroundColor={
                                      isSelectedRow() ? RGBA.fromInts(0, 245, 255, 42) : undefined
                                    }
                                    onMouseOver={() => {
                                      setColIdx(col.colIndex)
                                      setRowIdx(rIndex())
                                    }}
                                    onMouseUp={() => {
                                      setColIdx(col.colIndex)
                                      setRowIdx(rIndex())
                                      local.model.auto.toggleModelAllowed(m.providerID, m.id)
                                    }}
                                  >
                                    <box flexDirection="row" gap={1} flexShrink={1} minWidth={0}>
                                      <text
                                        fg={isAllowed() ? RGBA.fromHex("#10B981") : theme.text.muted}
                                        attributes={isAllowed() ? TextAttributes.BOLD : undefined}
                                        selectable={false}
                                      >
                                        {isAllowed() ? "✓" : "○"}
                                      </text>
                                      <text
                                        fg={
                                          isSelectedRow()
                                            ? RGBA.fromHex("#00F5FF")
                                            : isAllowed()
                                              ? theme.text.base
                                              : theme.text.muted
                                        }
                                        attributes={isSelectedRow() ? TextAttributes.BOLD : undefined}
                                        width={modelLabelWidth()}
                                        wrapMode="none"
                                        selectable={false}
                                      >
                                        {fitLabel(m.shortName, modelLabelWidth())}
                                      </text>
                                    </box>

                                    <text fg={badge.color} width={4} flexShrink={0} wrapMode="none" selectable={false}>
                                      {badge.label}
                                    </text>
                                  </box>
                                )
                              }}
                            </For>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </box>
              )}
            </For>
          </box>
        </scrollbox>

        {/* Full selected model name remains readable even when the grid labels truncate. */}
        <Show when={dimensions().height >= 17 ? activeModel() : undefined}>
          {(m) => (
            <box
              flexDirection="column"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={RGBA.fromInts(15, 23, 42, 180)}
            >
              <text fg={RGBA.fromHex("#00F5FF")} wrapMode="none">
                {fitLabel(`▸ ${m().name}`, Math.max(1, contentWidth() - 2))}
              </text>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.text.muted} wrapMode="none">
                  {fitLabel(`${m().providerID}/${m().id}`, Math.max(1, contentWidth() - (contentWidth() > 85 ? 43 : 2)))}
                </text>
                <Show when={contentWidth() > 85}>
                  <text fg={theme.text.muted} wrapMode="none">{bucketFullName(m().bucket)}</text>
                </Show>
              </box>
            </box>
          )}
        </Show>

        <box flexDirection="row" justifyContent="space-between" gap={1} paddingLeft={1} paddingRight={1}>
          <text fg={theme.text.muted} wrapMode="none">
            {fitLabel(
              contentWidth() >= 100
                ? "←/→ Column · ↑/↓ Model · Space/Enter Toggle · [P] Provider · [R] Preset · [A] All"
                : contentWidth() >= 65
                  ? "←/→ Column · ↑/↓ Model · Enter Toggle · [P] Provider · [R] Preset"
                  : "←/→ Column · ↑/↓ Model · Enter Toggle",
              Math.max(1, contentWidth() - (contentWidth() < 55 ? 10 : 21)),
            )}
          </text>
          <box
            flexShrink={0}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={RGBA.fromInts(255, 255, 255, 18)}
            onMouseUp={() => dialog.pop()}
          >
            <text fg={RGBA.fromHex("#38BDF8")} selectable={false}>
              {contentWidth() < 55 ? "Back" : "← Back [Backspace]"}
            </text>
          </box>
        </box>
      </box>
    </DialogLayout>
  )
}
