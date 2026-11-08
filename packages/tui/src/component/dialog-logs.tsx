import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js"
import { logPath, errorLogPath, readLogs, type Source, type Level } from "@opencode/util/observability/log-view"
import { useTheme } from "../context/theme"
import { useTuiApp } from "../context/runtime"
import { Keymap } from "../context/keymap"
import { useClipboard } from "../context/clipboard"
import { useToast } from "../ui/toast"
import { DialogHeader, DialogLayout, useDialog } from "../ui/dialog"

const sources: Source[] = ["all", "tui", "server", "cli"]
const levels: Level[] = ["all", "ERROR", "WARN", "INFO", "DEBUG"]

export function DialogLogs() {
  const theme = useTheme().surface("dialog")
  const dialog = useDialog()
  const app = useTuiApp()
  const clipboard = useClipboard()
  const toast = useToast()
  const file = createMemo(() => level() === "ERROR" || level() === "WARN" ? errorLogPath(app.channel) : logPath(app.channel))
  const [source, setSource] = createSignal<Source>("all")
  const [level, setLevel] = createSignal<Level>("all")
  const [lines, setLines] = createSignal<string[]>([])
  const [error, setError] = createSignal("")
  const [paused, setPaused] = createSignal(false)
  let loading = false
  let disposed = false
  dialog.setSize("xlarge")

  const refresh = async () => {
    if (disposed || loading || paused()) return
    loading = true
    try {
      const result = await readLogs(file(), { source: source(), level: level(), lines: 100 })
      if (!disposed) {
        setLines(result)
        setError("")
      }
    } catch (cause) {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      loading = false
    }
  }

  onMount(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 1250)
    onCleanup(() => { disposed = true; clearInterval(timer) })
  })

  const cycleSource = () => {
    setSource((current) => sources[(sources.indexOf(current) + 1) % sources.length]!)
    void refresh()
  }
  const cycleLevel = () => {
    setLevel((current) => levels[(levels.indexOf(current) + 1) % levels.length]!)
    void refresh()
  }
  const copy = () => {
    void clipboard.write(lines().join("\n")).then(() => {
      toast.show({ message: "Logs filtrados copiados (dados conhecidos ocultados)", variant: "info" })
    }).catch(toast.error)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "s", title: "Filtrar origem", group: "Debug", run: cycleSource },
      { bind: "l", title: "Filtrar nível", group: "Debug", run: cycleLevel },
      { bind: "p", title: "Pausar/retomar", group: "Debug", run: () => { setPaused((value) => !value); void refresh() } },
      { bind: "r", title: "Atualizar", group: "Debug", run: refresh },
      { bind: "c", title: "Copiar logs", group: "Debug", run: copy },
    ],
  }))

  const output = createMemo(() => lines().map((line) => line.length > 700 ? line.slice(0, 700) + "…" : line))
  const color = (line: string) => line.includes("level=ERROR") ? theme.text.feedback.error.base
    : line.includes("level=WARN") ? theme.text.feedback.warning.base
    : theme.text.base

  return (
    <DialogLayout
      header={<DialogHeader title="OnethyCode · Logs" description="Core, servidor, TUI e plugins · atualiza automaticamente" />}
      footer={{ actions: {
        secondary: [
          { title: "origem", key: "s", onTrigger: cycleSource },
          { title: "nível", key: "l", onTrigger: cycleLevel },
          { title: paused() ? "retomar" : "pausar", key: "p", onTrigger: () => setPaused((value) => !value) },
        ],
        primary: [
          { title: "copiar", key: "c", onTrigger: copy },
          { title: "atualizar", key: "r", onTrigger: () => void refresh() },
        ],
      } }}
    >
      <box flexDirection="column" gap={1}>
        <text fg={theme.text.muted}>Origem: {source()} · Nível: {level()} · {paused() ? "pausado" : "ao vivo"} · {file()}</text>
        <scrollbox maxHeight={20} scrollbarOptions={{ visible: true }}>
          <box flexDirection="column">
            <For each={output()}>{(line) => (
              <text fg={color(line)} wrapMode="word">{line}</text>
            )}</For>
            <text fg={theme.text.muted}>
              {error() || (lines().length ? "" : "Nenhum log para o filtro. Para DEBUG: ONETHY_DEBUG=1 e reinicie o serviço.")}
            </text>
          </box>
        </scrollbox>
        <text fg={theme.text.muted}>Dados conhecidos são ocultados; revise antes de compartilhar logs. s=origem · l=nível · p=pausa · c=copia</text>
      </box>
    </DialogLayout>
  )
}
