import { RGBA, TextAttributes } from "@opentui/core"
import { For, Show, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"
import { bigLogo, compactLetters, go } from "../logo"

const CYBER_PALETTE: RGBA[] = [
  RGBA.fromHex("#00F5FF"), // O - Cyan
  RGBA.fromHex("#00D2FF"), // N - Sky Cyan
  RGBA.fromHex("#38BDF8"), // E - Cyan Blue
  RGBA.fromHex("#6366F1"), // T - Indigo
  RGBA.fromHex("#8B5CF6"), // H - Purple Neon
  RGBA.fromHex("#A855F7"), // Y - Violet Neon
  RGBA.fromHex("#C084FC"), // C - Light Violet
  RGBA.fromHex("#D946EF"), // O - Magenta
  RGBA.fromHex("#EC4899"), // D - Pink
  RGBA.fromHex("#F43F5E"), // E - Rose Neon
]

const CYBER_BEVEL: RGBA[] = [
  RGBA.fromHex("#0891B2"), // O bevel
  RGBA.fromHex("#0284C7"), // N bevel
  RGBA.fromHex("#0369A1"), // E bevel
  RGBA.fromHex("#4338CA"), // T bevel
  RGBA.fromHex("#6D28D9"), // H bevel
  RGBA.fromHex("#7E22CE"), // Y bevel
  RGBA.fromHex("#9333EA"), // C bevel
  RGBA.fromHex("#A21CAF"), // O bevel
  RGBA.fromHex("#BE123C"), // D bevel
  RGBA.fromHex("#E11D48"), // E bevel
]

export function Logo() {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()

  const colorAt = (index: number) => {
    return CYBER_PALETTE[index % CYBER_PALETTE.length] ?? theme.text.base
  }

  const bevelAt = (index: number) => {
    return CYBER_BEVEL[index % CYBER_BEVEL.length] ?? theme.text.muted
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

  const glitchGlifs = [
    { left: "  ───  ── ─   ", right: "   ─ ──  ───  " },
    { left: "    ─  ─── ─  ", right: "  ─ ───  ─    " },
    { left: "  ──── ─ ──   ", right: "   ── ─ ────  " },
    { left: "   ── ──── ─  ", right: "  ─ ──── ──   " },
    { left: "  ─── ─ ─     ", right: "     ─ ─ ───  " },
    { left: "  ──   ─── ─  ", right: "  ─ ───   ──  " },
  ]

  type MoonPart = { text: string; fg: RGBA; bold?: boolean }

  const moonRows: MoonPart[][] = [
    [
      { text: "                      . · ´ ¯ ¯ ", fg: RGBA.fromHex("#38BDF8") },
      { text: "▄▄", fg: RGBA.fromHex("#FFFFFF"), bold: true },
      { text: " ` · .                      ", fg: RGBA.fromHex("#38BDF8") },
    ],
    [
      { text: "                  . · ´ ", fg: RGBA.fromHex("#38BDF8") },
      { text: "▄███", fg: RGBA.fromHex("#FFFFFF"), bold: true },
      { text: "▀", fg: RGBA.fromHex("#A855F7"), bold: true },
      { text: "   °  ·", fg: RGBA.fromHex("#49329E") },
      { text: " ` · .                  ", fg: RGBA.fromHex("#38BDF8") },
    ],
    [
      { text: "               . · ´ ", fg: RGBA.fromHex("#38BDF8") },
      { text: "▄████", fg: RGBA.fromHex("#FFFFFF"), bold: true },
      { text: "▀", fg: RGBA.fromHex("#A855F7"), bold: true },
      { text: "      ·  *  ", fg: RGBA.fromHex("#49329E") },
      { text: "` · .                ", fg: RGBA.fromHex("#38BDF8") },
    ],
    [
      { text: "             . ´  ", fg: RGBA.fromHex("#38BDF8") },
      { text: "▄████", fg: RGBA.fromHex("#FFFFFF"), bold: true },
      { text: "▀", fg: RGBA.fromHex("#A855F7"), bold: true },
      { text: "   *      ·      ", fg: RGBA.fromHex("#49329E") },
      { text: "` .              ", fg: RGBA.fromHex("#38BDF8") },
    ],
    [
      { text: "  ─── ─ ──   ", fg: RGBA.fromHex("#00D2FF"), bold: true },
      { text: "/   ", fg: RGBA.fromHex("#38BDF8") },
      { text: "▄████", fg: RGBA.fromHex("#FFFFFF"), bold: true },
      { text: "▀", fg: RGBA.fromHex("#A855F7"), bold: true },
      { text: "                   ", fg: RGBA.fromHex("#49329E") },
      { text: "\\", fg: RGBA.fromHex("#38BDF8") },
      { text: "   ── ─── ──  ", fg: RGBA.fromHex("#D946EF"), bold: true },
    ],
    [
      { text: "           /   ", fg: RGBA.fromHex("#38BDF8") },
      { text: "█████", fg: RGBA.fromHex("#FFFFFF"), bold: true },
      { text: "▌", fg: RGBA.fromHex("#818CF8"), bold: true },
      { text: "                      ", fg: RGBA.fromHex("#49329E") },
      { text: "\\           ", fg: RGBA.fromHex("#38BDF8") },
    ],
    [
      { text: "          │   ", fg: RGBA.fromHex("#38BDF8") },
      { text: "█████", fg: RGBA.fromHex("#FFFFFF"), bold: true },
      { text: "▌", fg: RGBA.fromHex("#818CF8"), bold: true },
      { text: "      ·  °              ", fg: RGBA.fromHex("#49329E") },
      { text: "│          ", fg: RGBA.fromHex("#38BDF8") },
    ],
  ]

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
          {/* Meia-Lua ascendente no centro do topo (atrás do meio do nome) */}
          <Show when={dimensions().height >= 22 && dimensions().width >= 64}>
            <box flexDirection="column" alignItems="center" justifyContent="center">
              <For each={moonRows}>
                {(row) => (
                  <box flexDirection="row">
                    <For each={row}>
                      {(part) => (
                        <text
                          fg={part.fg}
                          attributes={part.bold ? TextAttributes.BOLD : undefined}
                          selectable={false}
                        >
                          {part.text}
                        </text>
                      )}
                    </For>
                  </box>
                )}
              </For>
            </box>
          </Show>

          {/* Nome ONETHYCODE com scanlines cósmicas nas laterais */}
          <For each={bigRows}>
            {(rowIdx) => {
              const glitch = () => glitchGlifs[rowIdx] ?? { left: "", right: "" }
              return (
                <box flexDirection="row" gap={1} alignItems="center">
                  <Show when={dimensions().width >= 96}>
                    <text fg={RGBA.fromHex("#00D2FF")} attributes={TextAttributes.BOLD} selectable={false}>
                      {glitch().left}
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
                    <text fg={RGBA.fromHex("#D946EF")} attributes={TextAttributes.BOLD} selectable={false}>
                      {glitch().right}
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>

          {/* Subtítulo idêntico ao design com diamantes/losangos */}
          <Show when={dimensions().height >= 22}>
            <box flexDirection="row" paddingTop={1} gap={1} alignItems="center" justifyContent="center">
              <text fg={RGBA.fromHex("#D946EF")} attributes={TextAttributes.BOLD} selectable={false}>
                ◇
              </text>
              <text fg={RGBA.fromHex("#A855F7")} attributes={TextAttributes.BOLD} selectable={false}>
                ORQUESTRADOR MULTI-AGENTE IA
              </text>
              <text fg={RGBA.fromHex("#00F5FF")} attributes={TextAttributes.BOLD} selectable={false}>
                ◇
              </text>
              <text fg={RGBA.fromHex("#00D2FF")} attributes={TextAttributes.BOLD} selectable={false}>
                ONETHY FUSION
              </text>
              <text fg={RGBA.fromHex("#D946EF")} attributes={TextAttributes.BOLD} selectable={false}>
                ◇
              </text>
              <text fg={RGBA.fromHex("#00F5FF")} attributes={TextAttributes.BOLD} selectable={false}>
                ONETHY BUS ATIVO
              </text>
              <text fg={RGBA.fromHex("#A855F7")} attributes={TextAttributes.BOLD} selectable={false}>
                ◇
              </text>
            </box>
          </Show>
        </box>
      )}
    </box>
  )
}
