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
import { RGBA, TextAttributes } from "@opentui/core"

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

  const statsSummary = createMemo(() => {
    const loc = currentLocation()
    const agents = (data.location.agent.list(loc) ?? []).filter((a) => !a.hidden).length
    const skills = (data.location.skill.list(loc) ?? []).length
    const mcps = (data.location.mcp.server.list(loc) ?? []).length
    return { agents, skills, mcps }
  })

  const quickCommands = [
    { cmd: "/ulw", desc: "Ultrawork", fg: RGBA.fromHex("#00F5FF") },
    { cmd: "/arena", desc: "Multi-Modelo", fg: RGBA.fromHex("#10B981") },
    { cmd: "/raph", desc: "Loop", fg: RGBA.fromHex("#F43F5E") },
    { cmd: "/bus", desc: "OmniBus", fg: RGBA.fromHex("#00D2FF") },
    { cmd: "/auto", desc: "Omni Fusion", fg: RGBA.fromHex("#A855F7") },
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
        <Show when={dimensions().height >= 22 && dimensions().width >= 60}>
          <box
            flexDirection="column"
            alignItems="center"
            paddingTop={1}
            gap={1}
            width="100%"
            maxWidth={78}
            flexShrink={0}
          >
            {/* Linha discreta de estatísticas do ecossistema */}
            <box
              flexDirection="row"
              alignItems="center"
              justifyContent="center"
              gap={1}
              onMouseUp={() => dialog.replace(() => <DialogCustomizations />)}
            >
              <text fg={RGBA.fromHex("#00F5FF")} attributes={TextAttributes.BOLD} selectable={false}>
                ✦ {statsSummary().agents}
              </text>
              <text fg={theme.text.muted} selectable={false}>
                agentes
              </text>
              <text fg={theme.text.muted} selectable={false}>
                ·
              </text>
              <text fg={RGBA.fromHex("#A855F7")} attributes={TextAttributes.BOLD} selectable={false}>
                ✦ {statsSummary().skills}
              </text>
              <text fg={theme.text.muted} selectable={false}>
                skills
              </text>
              <text fg={theme.text.muted} selectable={false}>
                ·
              </text>
              <text fg={RGBA.fromHex("#06B6D4")} attributes={TextAttributes.BOLD} selectable={false}>
                ✦ {statsSummary().mcps}
              </text>
              <text fg={theme.text.muted} selectable={false}>
                MCPs
              </text>
              <text fg={theme.text.muted} selectable={false}>
                ·
              </text>
              <text fg={RGBA.fromHex("#10B981")} attributes={TextAttributes.BOLD} selectable={false}>
                /personalizacoes
              </text>
            </box>

            {/* Linha única e limpa de atalhos rápidos essenciais */}
            <Show when={dimensions().height >= 25}>
              <box flexDirection="row" flexWrap="wrap" justifyContent="center" gap={2}>
                <For each={quickCommands}>
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
                          fg={chip.fg}
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
