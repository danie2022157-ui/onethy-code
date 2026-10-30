import { Prompt, type PromptRef } from "../component/prompt"
import { createEffect, createMemo, createSignal, For, onMount, Show, untrack } from "solid-js"
import { Logo } from "../component/logo"
import { useArgs } from "../context/args"
import { useRouteData } from "../context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { useEditorContext } from "../context/editor"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { FormPrompt } from "./session/form"
import { Slot } from "../plugin/render"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useUpdateNotification } from "../context/update-notification"
import { useExit } from "../context/exit"
import { FadeInText } from "../component/fade-in-text"
import { useDialog } from "../ui/dialog"
import { DialogAgent } from "../component/dialog-agent"
import { DialogCustomizations } from "../component/dialog-customizations"
import { DialogMcp } from "../component/dialog-mcp"
import { DialogModel } from "../component/dialog-model"
import { tint } from "../theme/color"
import { TextAttributes } from "@opentui/core"

let once = false
const placeholder = {
  normal: [
    "Resolva um TODO no código",
    "Qual é a stack deste projeto?",
    "Corrija os testes quebrados",
    "Planeje uma nova funcionalidade com /ulw",
  ],
  shell: ["ls -la", "git status", "pwd"],
}

export function Home() {
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const editor = useEditorContext()
  const data = useData()
  const location = useLocation()
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const dialog = useDialog()
  const [logoWidth, setLogoWidth] = createSignal(0)
  // Global MCP elicitations can arrive without a session route, so keep them reachable from Home.
  const currentLocation = () => route.location ?? data.location.default()
  const forms = createMemo(() => data.session.form.list("global", currentLocation()) ?? [])
  let sent = false

  // Track only the route location and (when absent) the default location; location.set
  // reads other signals internally and tracking them would re-assert the route location
  // after the user overrides it with /cd.
  createEffect(() => {
    const target = currentLocation()
    untrack(() => location.set(target))
  })

  onMount(() => {
    editor.clearSelection()
  })

  const bind = (r: PromptRef | undefined) => {
    setRef(r)
    promptRef.set(r)
    if (once || !r || route.prompt || !args.prompt) return
    r.set({ text: args.prompt, files: [], agents: [], pasted: [] })
    once = true
  }

  createEffect(() => {
    const composer = ref()
    const prompt = route.prompt
    if (!composer || prompt?.text === undefined) return
    untrack(() => composer.set(prompt))
  })

  // Wait for everything submit needs before auto-submitting --prompt; it runs once.
  createEffect(() => {
    const r = ref()
    if (sent) return
    if (!r) return
    if (!local.model.ready || !local.model.catalogReady) return
    if (!local.agent.current() || !local.model.current()) return
    if (!args.prompt) return
    if (r.current.text !== args.prompt) return
    sent = true
    r.submit()
  })

  const palette = () => {
    const scales = theme.categorical
    if (scales.length === 0) return [theme.text.base]
    return scales.map((scale) => scale[400])
  }

  const colorAt = (index: number) => {
    const list = palette()
    return list[index % list.length] ?? theme.text.base
  }

  const ecosystemStats = createMemo(() => {
    const loc = currentLocation()
    const agents = (data.location.agent.list(loc) ?? []).filter((a) => !a.hidden).length
    const allSkills = data.location.skill.list(loc) ?? []
    let skills = 0
    let mods = 0
    let hooks = 0
    for (const s of allSkills) {
      const p = s.path.replace(/\\/g, "/").toLowerCase()
      const n = s.name.toLowerCase()
      if (p.includes("/hooks/") || n.startsWith("hook-")) hooks++
      else if (p.includes("/mods/") || p.includes("/plugins/") || n.startsWith("mod-")) mods++
      else if (!p.includes("/settings/") && !n.startsWith("setting-")) skills++
    }
    const commands = (data.location.command.list(loc) ?? []).length
    const mcps = (data.location.mcp.server.list(loc) ?? []).length
    return [
      {
        icon: "🤖",
        label: "Agentes",
        count: String(agents),
        colorIdx: 0,
        onClick: () => dialog.replace(() => <DialogAgent />),
      },
      {
        icon: "✦",
        label: "Skills",
        count: String(skills),
        colorIdx: 1,
        onClick: () => dialog.replace(() => <DialogCustomizations filter="skills" />),
      },
      {
        icon: "🧩",
        label: "Mods",
        count: String(mods),
        colorIdx: 2,
        onClick: () => dialog.replace(() => <DialogCustomizations filter="mods" />),
      },
      {
        icon: "🪝",
        label: "Hooks",
        count: String(hooks),
        colorIdx: 3,
        onClick: () => dialog.replace(() => <DialogCustomizations filter="hooks" />),
      },
      {
        icon: "⌘",
        label: "Comandos",
        count: String(commands),
        colorIdx: 4,
        onClick: () => dialog.replace(() => <DialogCustomizations filter="commands" />),
      },
      {
        icon: "🔌",
        label: "MCPs",
        count: String(mcps),
        colorIdx: 5,
        onClick: () => dialog.replace(() => <DialogMcp />),
      },
      {
        icon: "⚡",
        label: local.model.auto.modeName(),
        count: local.model.auto.enabled() ? local.model.auto.tierLabel() : "Auto",
        colorIdx: 6,
        onClick: () => dialog.replace(() => <DialogModel />),
      },
    ]
  })

  const quickChips = [
    { cmd: "/ulw", desc: "Ultrawork", colorIdx: 0 },
    { cmd: "/arena", desc: "Multi-Modelo", colorIdx: 2 },
    { cmd: "/ralph", desc: "Loop Verificador", colorIdx: 4 },
    { cmd: "/bus", desc: "OmniBus", colorIdx: 5 },
    { cmd: "/auto", desc: "Omni Fusion", colorIdx: 1 },
    { cmd: "/personalizacoes", desc: "Catálogo", colorIdx: 3 },
  ]

  return (
    <>
      <box
        flexGrow={1}
        alignItems="center"
        paddingLeft={dimensions().width < 44 ? 1 : 2}
        paddingRight={dimensions().width < 44 ? 1 : 2}
      >
        <box flexGrow={1} minHeight={0} />
        <box height={2} minHeight={0} flexShrink={1} />
        <box
          flexShrink={0}
          onSizeChange={function () {
            setLogoWidth(this.width)
          }}
        >
          <Logo />
        </box>
        <box height={1} flexShrink={0} />
        <UpdateNotification width={logoWidth()} />
        <box width="100%" maxWidth={78} zIndex={1000} paddingTop={1} flexShrink={0} position="relative">
          <Prompt ref={bind} placeholders={placeholder} disabled={forms().length > 0} />
        </box>
        <Show when={dimensions().height >= 22 && dimensions().width >= 64}>
          <box
            flexDirection="column"
            alignItems="center"
            paddingTop={1}
            gap={1}
            width="100%"
            maxWidth={84}
            flexShrink={0}
          >
            <box flexDirection="row" flexWrap="wrap" justifyContent="center" gap={1}>
              <For each={ecosystemStats()}>
                {(badge) => {
                  const fg = () => colorAt(badge.colorIdx)
                  const [hovered, setHovered] = createSignal(false)
                  const bg = () => (hovered() ? tint(theme.background.base, fg(), 0.28) : tint(theme.background.base, fg(), 0.14))
                  return (
                    <box
                      flexDirection="row"
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={bg()}
                      onMouseOver={() => setHovered(true)}
                      onMouseOut={() => setHovered(false)}
                      onMouseUp={badge.onClick}
                    >
                      <text fg={fg()} attributes={TextAttributes.BOLD} selectable={false}>
                        {badge.icon} {badge.count}{" "}
                      </text>
                      <text fg={theme.text.base} selectable={false}>
                        {badge.label}
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>
            <Show when={dimensions().height >= 26}>
              <box flexDirection="row" flexWrap="wrap" justifyContent="center" gap={2}>
                <For each={quickChips}>
                  {(chip) => {
                    const [hovered, setHovered] = createSignal(false)
                    return (
                      <box
                        flexDirection="row"
                        onMouseOver={() => setHovered(true)}
                        onMouseOut={() => setHovered(false)}
                        onMouseUp={() => {
                          const composer = ref()
                          if (!composer) return
                          composer.set({ text: `${chip.cmd} `, files: [], agents: [], pasted: [] })
                        }}
                      >
                        <text
                          fg={colorAt(chip.colorIdx)}
                          attributes={hovered() ? TextAttributes.BOLD | TextAttributes.UNDERLINE : TextAttributes.BOLD}
                          selectable={false}
                        >
                          {chip.cmd}
                        </text>
                        <text fg={hovered() ? theme.text.base : theme.text.muted} selectable={false}>
                          {" "}
                          {chip.desc}
                        </text>
                      </box>
                    )
                  }}
                </For>
              </box>
            </Show>
          </box>
        </Show>
        <box flexGrow={1} minHeight={0} />
      </box>
      <box width="100%" flexShrink={0}>
        <Slot path="home.footer" />
      </box>
      <Show when={forms()[0]?.id} keyed>
        {(_) => {
          const form = forms()[0]
          return form ? (
            <box position="absolute" zIndex={2000} left={0} right={0} bottom={1} paddingLeft={2} paddingRight={2}>
              <box width="100%">
                <FormPrompt form={form} />
              </box>
            </box>
          ) : null
        }}
      </Show>
    </>
  )
}

function UpdateNotification(props: { width: number }) {
  const update = useUpdateNotification()
  const exit = useExit()
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  const backdrop = () => (hovered() ? theme.background.action.primary.hovered : theme.background.base)
  createEffect(() => {
    update.notification()
    setHovered(false)
  })

  return (
    <Show when={update.notification()} keyed>
      {(state) => {
        const remote = state.source === "server" && state.remote
        return (
          <Show when={!remote || state.type === "available"}>
            <box
              flexShrink={0}
              flexDirection="row"
              justifyContent="center"
              width={props.width}
              maxWidth="100%"
              gap={1}
              backgroundColor={hovered() ? theme.background.action.primary.hovered : undefined}
              onMouseOver={() => setHovered(true)}
              onMouseOut={() => setHovered(false)}
              onMouseUp={() => {
                if (remote) return update.dismiss()
                if (state.type === "installed") return exit()
                update.open?.("notification")
              }}
            >
              <FadeInText fg={theme.text.muted} backdrop={backdrop()}>
                <Show when={!remote}>
                  <span style={{ fg: theme.text.action.primary.selected }}>
                    {state.type === "installed" ? "/exit" : "/update"}
                  </span>
                </Show>
                {remote
                  ? "atualização do servidor remoto disponível"
                  : state.type === "installed"
                    ? ` reinicie para usar v${state.version}`
                    : ` para instalar v${state.version}`}
              </FadeInText>
            </box>
          </Show>
        )
      }}
    </Show>
  )
}
