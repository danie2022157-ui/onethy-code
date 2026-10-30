import { RGBA, TextAttributes } from "@opentui/core"
import { For, Show, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"
import { bigLogo, compactLetters, go } from "../logo"

export function Logo() {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()

  const palette = (): RGBA[] => {
    const scales = theme.categorical
    if (scales.length === 0) return [theme.text.base]
    return scales.map((scale) => scale[400])
  }

  const bevelPalette = (): RGBA[] => {
    const scales = theme.categorical
    if (scales.length === 0) return [theme.text.muted]
    return scales.map((scale) => scale[200])
  }

  const colorAt = (index: number) => {
    const list = palette()
    return list[index % list.length] ?? theme.text.base
  }

  const bevelAt = (index: number) => {
    const list = bevelPalette()
    const base = list[(index + 1) % list.length] ?? theme.text.muted
    return tint(theme.background.base, base, 0.82)
  }

  const renderCompactLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
    const shadow = tint(theme.background.base, fg, 0.28)
    const attrs = bold ? TextAttributes.BOLD : undefined
    return Array.from(line).map((char) => {
      if (char === "_") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            {" "}
          </text>
        )
      }
      if (char === "^") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === "~") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === ",") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▄
          </text>
        )
      }
      return (
        <text fg={fg} attributes={attrs} selectable={false}>
          {char}
        </text>
      )
    })
  }

  const renderBigSegment = (segment: string, fg: RGBA, bevel: RGBA): JSX.Element[] => {
    return Array.from(segment).map((char) => {
      if (char === "█") {
        return (
          <text fg={fg} attributes={TextAttributes.BOLD} selectable={false}>
            █
          </text>
        )
      }
      if (char === " ") {
        return (
          <text fg={fg} selectable={false}>
            {" "}
          </text>
        )
      }
      return (
        <text fg={bevel} attributes={TextAttributes.BOLD} selectable={false}>
          {char}
        </text>
      )
    })
  }

  const bigRows = [0, 1, 2, 3, 4, 5] as const
  const compactRows = [0, 1, 2, 3] as const

  return (
    <box alignItems="center" flexDirection="column">
      {dimensions().height < 12 ? null : dimensions().width < 22 ? (
        <For each={go.right.slice(1)}>
          {(line, idx) => <box flexDirection="row">{renderCompactLine(line, colorAt(idx()), true)}</box>}
        </For>
      ) : dimensions().width < 44 ? (
        <>
          <For each={[1, 2, 3]}>
            {(rowIdx) => (
              <box flexDirection="row" gap={1}>
                <For each={compactLetters.slice(0, 4)}>
                  {(letter, letterIdx) => (
                    <box flexDirection="row">
                      {renderCompactLine(letter.lines[rowIdx] ?? "", colorAt(letterIdx()), true)}
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>
          <For each={compactRows}>
            {(rowIdx) => (
              <box flexDirection="row" gap={1}>
                <For each={compactLetters.slice(4)}>
                  {(letter, letterIdx) => (
                    <box flexDirection="row">
                      {renderCompactLine(letter.lines[rowIdx] ?? "", colorAt(letterIdx() + 4), true)}
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>
        </>
      ) : dimensions().width < 78 || dimensions().height < 22 ? (
        <box alignItems="center" flexDirection="column">
          <For each={compactRows}>
            {(rowIdx) => (
              <box flexDirection="row" gap={1}>
                <For each={compactLetters}>
                  {(letter, letterIdx) => (
                    <box flexDirection="row">
                      {renderCompactLine(letter.lines[rowIdx] ?? "", colorAt(letterIdx()), true)}
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>
        </box>
      ) : (
        <box alignItems="center" flexDirection="column">
          <Show when={dimensions().height >= 26 && dimensions().width >= 86}>
            <box flexDirection="column" alignItems="center" justifyContent="center">
              <box flexDirection="row" gap={1} alignItems="center" justifyContent="center">
                <text fg={colorAt(1)} attributes={TextAttributes.BOLD} selectable={false}>
                  ★
                </text>
                <text fg={colorAt(2)} selectable={false}>
                  · ˙
                </text>
                <text fg={colorAt(3)} attributes={TextAttributes.BOLD} selectable={false}>
                  🌙
                </text>
                <text fg={colorAt(2)} selectable={false}>
                  ˙ ·
                </text>
                <text fg={colorAt(1)} attributes={TextAttributes.BOLD} selectable={false}>
                  ★
                </text>
              </box>
              <text fg={tint(theme.background.base, colorAt(3), 0.75)} attributes={TextAttributes.BOLD} selectable={false}>
                ╭──────────────────────────.·´  L U N A R  `·.──────────────────────────╮
              </text>
            </box>
          </Show>
          <For each={bigRows}>
            {(rowIdx) => {
              const moonArcs = [
                { left: "  .·´  ", right: "  `·.  " },
                { left: " /     ", right: "     \\ " },
                { left: "│  🌙  ", right: "  ✦  │ " },
                { left: "│  ✦   ", right: "  🌙 │ " },
                { left: " \\     ", right: "     / " },
                { left: "  `·.  ", right: "  .·´  " },
              ]
              const arc = () => moonArcs[rowIdx] ?? { left: "", right: "" }
              return (
                <box flexDirection="row" gap={1} alignItems="center">
                  <Show when={dimensions().width >= 96}>
                    <text fg={tint(theme.background.base, colorAt(2), 0.7)} attributes={TextAttributes.BOLD} selectable={false}>
                      {arc().left}
                    </text>
                  </Show>
                  <For each={bigLogo}>
                    {(letter, letterIdx) => (
                      <box flexDirection="row">
                        {renderBigSegment(
                          letter.lines[rowIdx] ?? "",
                          colorAt(letterIdx()),
                          bevelAt(letterIdx()),
                        )}
                      </box>
                    )}
                  </For>
                  <Show when={dimensions().width >= 96}>
                    <text fg={tint(theme.background.base, colorAt(5), 0.7)} attributes={TextAttributes.BOLD} selectable={false}>
                      {arc().right}
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
          <Show when={dimensions().height >= 26 && dimensions().width >= 86}>
            <text fg={tint(theme.background.base, colorAt(4), 0.75)} attributes={TextAttributes.BOLD} selectable={false}>
              ╰──────────────────────────`·.  O N E T H Y  .·´──────────────────────────╯
            </text>
          </Show>
          <Show when={dimensions().height >= 24}>
            <box flexDirection="row" paddingTop={1} gap={1} alignItems="center" justifyContent="center">
              <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
                {(idx) => (
                  <text fg={colorAt(idx)} attributes={TextAttributes.BOLD} selectable={false}>
                    ━━━━━━━━
                  </text>
                )}
              </For>
            </box>
            <box flexDirection="row" paddingTop={0} gap={1} alignItems="center" justifyContent="center">
              <text fg={colorAt(0)} attributes={TextAttributes.BOLD} selectable={false}>
                ✦
              </text>
              <text fg={colorAt(1)} attributes={TextAttributes.BOLD} selectable={false}>
                ORQUESTRADOR MULTI-AGENTE IA
              </text>
              <text fg={theme.text.muted} selectable={false}>
                •
              </text>
              <text fg={colorAt(3)} attributes={TextAttributes.BOLD} selectable={false}>
                ⚡ ONETHY FUSION
              </text>
              <text fg={theme.text.muted} selectable={false}>
                •
              </text>
              <text fg={colorAt(5)} attributes={TextAttributes.BOLD} selectable={false}>
                🔗 ONETHY BUS ATIVO
              </text>
              <text fg={colorAt(7)} attributes={TextAttributes.BOLD} selectable={false}>
                ✦
              </text>
            </box>
          </Show>
        </box>
      )}
    </box>
  )
}
