import { RGBA, TextAttributes, type BoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import { stringWidth } from "../../util/string-width"

export function PromptMetadataRow(props: {
  mode: "normal" | "shell"
  agent?: string
  auto: boolean
  model: string
  provider: string
  variant?: string
  /** What the workspace's limits leave for the model, once it is running low. */
  limit?: { readonly text: string; readonly danger: boolean }
  muted: boolean
  highlight: RGBA
  agentAlpha: number
  modelAlpha: number
  variantAlpha: number
}) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const [boxWidth, setBoxWidth] = createSignal(72)

  const layout = createMemo(() => {
    if (props.mode === "shell") return { agent: props.agent ?? "Shell", model: "" }
    const targetWidth = Math.min(boxWidth(), Math.max(0, dimensions().width - (dimensions().width < 44 ? 9 : 14)))
    return promptMetadataLayout({
      width: Math.max(20, targetWidth),
      terminalWidth: dimensions().width,
      agent: props.agent ?? "",
      auto: props.auto && !props.model.startsWith("⚡"),
      model: props.model,
      provider: props.model.startsWith("⚡") ? "" : props.provider,
      variant: props.variant === "modo auto" ? undefined : props.variant,
      limit: props.limit?.text,
    })
  })

  return (
    <box
      flexDirection="row"
      gap={1}
      flexGrow={1}
      flexShrink={1}
      minWidth={0}
      height={1}
      overflow="hidden"
      alignItems="center"
      onSizeChange={function (this: BoxRenderable) {
        if (this.width > 10 && this.width !== boxWidth()) {
          setBoxWidth(this.width)
        }
      }}
    >
      <Show
        when={(props.mode === "shell" || props.agent) && (layout().agent || layout().model)}
        fallback={<box height={1} />}
      >
        <Show when={layout().agent}>
          {(agent) => (
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={RGBA.fromHex("#E0F2FE")} attributes={TextAttributes.BOLD} selectable={false}>
                ✦
              </text>
              <text fg={RGBA.fromHex("#10B981")} attributes={TextAttributes.BOLD} selectable={false}>
                {agent()}
              </text>
            </box>
          )}
        </Show>
        <Show when={props.mode === "normal" && layout().auto && !props.model.startsWith("⚡")}>
          <text fg={fade(RGBA.fromHex("#34D399"), props.agentAlpha)}>auto</text>
        </Show>
        <Show when={props.mode === "normal" && layout().model}>
          <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0} alignItems="center">
            <Show when={layout().agent}>
              <text fg={RGBA.fromHex("#38BDF8")} attributes={TextAttributes.BOLD} selectable={false}>
                •
              </text>
            </Show>
            <text
              flexShrink={1}
              minWidth={0}
              wrapMode="none"
              truncate
              fg={fade(props.muted ? theme.text.muted : RGBA.fromHex("#FFFFFF"), props.modelAlpha)}
              attributes={TextAttributes.BOLD}
            >
              {layout().model}
            </text>
            <Show when={layout().provider && !layout().model.startsWith("⚡")}>
              {(provider) => (
                <text flexShrink={0} fg={fade(RGBA.fromHex("#94A3B8"), props.modelAlpha)}>
                  {provider()}
                </text>
              )}
            </Show>
            <Show when={layout().variant && layout().variant !== "modo auto"}>
              {(variant) => (
                <>
                  <text fg={RGBA.fromHex("#38BDF8")} attributes={TextAttributes.BOLD} selectable={false}>
                    •
                  </text>
                  <text
                    fg={fade(RGBA.fromHex("#F59E0B"), props.variantAlpha)}
                    attributes={TextAttributes.BOLD}
                    selectable={false}
                  >
                    {variant()}
                  </text>
                </>
              )}
            </Show>
            <Show when={layout().limit ? props.limit : undefined}>
              {(limit) => (
                <text
                  flexShrink={0}
                  marginLeft={1}
                  wrapMode="none"
                  fg={fade(limit().danger ? theme.text.feedback.error.base : theme.text.muted, props.modelAlpha)}
                >
                  {limit().text}
                </text>
              )}
            </Show>
          </box>
        </Show>
      </Show>
    </box>
  )
}

function fade(color: RGBA, alpha: number) {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}

type Layout = {
  agent?: string
  auto?: boolean
  model: string
  provider?: string
  variant?: string
  limit?: string
}

function promptMetadataLayout(input: {
  width: number
  terminalWidth: number
  agent: string
  auto?: boolean
  model: string
  provider: string
  variant?: string
  limit?: string
}) {
  const agent = input.terminalWidth < 44 ? undefined : input.agent
  const provider = input.terminalWidth < 44 ? "" : input.provider
  const limit = input.limit
  const candidates: Layout[] = [
    { agent, auto: input.auto, model: input.model, provider, variant: input.variant, limit },
    { agent, model: input.model, provider, variant: input.variant, limit },
    {
      agent,
      model: input.model,
      provider: provider.split(" / ").at(-1) ?? provider,
      variant: input.variant,
      limit,
    },
    { agent, model: input.model, variant: input.variant, limit },
  ]
  const fit = candidates.find((candidate) => stringWidth(text(candidate)) <= input.width)
  if (fit) return fit

  const prefix = agent ? `${agent} · ` : ""
  const suffix = `${input.variant ? ` · ${input.variant}` : ""}${limit ? `  ${limit}` : ""}`
  return {
    agent,
    model: Locale.truncateWidth(
      input.model,
      Math.max(9, input.width - stringWidth(prefix) - stringWidth(suffix)),
    ).replace(/\s+…$/, "…"),
    variant: input.variant,
    limit,
  }
}

function text(input: Layout) {
  return [
    ...(input.agent ? [input.agent] : []),
    ...(input.auto ? ["auto"] : []),
    ...(input.model ? [...(input.agent ? ["·"] : []), input.model] : []),
    ...(input.provider ? [input.provider] : []),
    ...(input.variant ? ["·", input.variant] : []),
    ...(input.limit ? [` ${input.limit}`] : []),
  ].join(" ")
}
