import { createMemo, createSignal, For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { RGBA, TextAttributes } from "@opentui/core"
import { useLocal } from "../context/local"
import { DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { Keymap } from "../context/keymap"
import { useToast } from "../ui/toast"

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

function cleanModelLabel(name: string, id: string, maxLen = 23): string {
  const base = name
    .replace(/^(OpenAI|Google|Anthropic|OpenCode)\s*[:\-–]?\s*/i, "")
    .replace(/\bAntigravity\s+/i, "")
    .replace(/\s*\(Free\)/i, " Free")
    .trim()
  const label = base.length > 0 ? base : id
  if (label.length <= maxLen) return label
  return label.slice(0, maxLen - 1) + "…"
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
    const perRow = dimensions().width >= 96 ? 3 : dimensions().width >= 68 ? 2 : 1
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
    if (bucket === "efficiency") return { label: "⚡Fast", color: RGBA.fromHex("#10B981") }
    if (bucket === "intelligence") return { label: "🧠Int", color: RGBA.fromHex("#A855F7") }
    return { label: "⚖Bal", color: RGBA.fromHex("#38BDF8") }
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
                ⚡ Omni Fusion — Allowed Models by Provider
              </text>
              <text fg={theme.text.muted}>({local.model.auto.allowedModelsSummary()})</text>
            </box>
          }
          closeLabel="esc"
        />
      }
    >
      <box flexDirection="column" gap={1}>
        {/* Top Action Bar */}
        <box
          flexDirection="row"
          justifyContent="space-between"
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={RGBA.fromInts(0, 0, 0, 90)}
        >
          <box flexDirection="row" gap={1}>
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
                ⭐ Recommended Preset (2-3 Models) [R]
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
              {local.model.auto.thinkingRouting() ? "✓ 🧠 Thinking Auto: ON [T]" : "○ 🧠 Thinking Auto: OFF [T]"}
            </text>
          </box>
        </box>

        {/* Provider Columns Matrix (up to 3 columns per row) */}
        <scrollbox maxHeight={Math.max(10, dimensions().height - 16)}>
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
                              {col.icon} {col.title}
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
                                    flexDirection="row"
                                    justifyContent="space-between"
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
                                    <box flexDirection="row" gap={1} flexShrink={1}>
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
                                        wrapMode="none"
                                        selectable={false}
                                      >
                                        {m.shortName}
                                      </text>
                                    </box>

                                    <text fg={badge.color} wrapMode="none" selectable={false}>
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

        {/* Active Model Info & Keyboard Shortcuts Footer */}
        <Show when={activeModel()}>
          {(m) => (
            <box
              flexDirection="row"
              justifyContent="space-between"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={RGBA.fromInts(15, 23, 42, 180)}
            >
              <text fg={theme.text.base} wrapMode="none">
                <span style={{ fg: RGBA.fromHex("#00F5FF") }}>▸ {m().name}</span>
                <span style={{ fg: theme.text.muted }}>{` (${m().providerID}/${m().id})`}</span>
              </text>
              <text fg={theme.text.muted} wrapMode="none">
                {bucketFullName(m().bucket)}
              </text>
            </box>
          )}
        </Show>

        <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
          <text fg={theme.text.muted} wrapMode="none">
            <span style={{ fg: RGBA.fromHex("#00F5FF") }}>←/→</span> Column ·{" "}
            <span style={{ fg: RGBA.fromHex("#00F5FF") }}>↑/↓</span> Model ·{" "}
            <span style={{ fg: RGBA.fromHex("#10B981") }}>Space/Enter</span> Toggle ·{" "}
            <span style={{ fg: RGBA.fromHex("#38BDF8") }}>[P]</span> Provider ·{" "}
            <span style={{ fg: RGBA.fromHex("#F59E0B") }}>[R]</span> Preset ·{" "}
            <span style={{ fg: RGBA.fromHex("#A855F7") }}>[A]</span> All
          </text>
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={RGBA.fromInts(255, 255, 255, 18)}
            onMouseUp={() => dialog.pop()}
          >
            <text fg={RGBA.fromHex("#38BDF8")} selectable={false}>
              ← Back [Backspace]
            </text>
          </box>
        </box>
      </box>
    </DialogLayout>
  )
}
