import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout } from "../ui/dialog"
import { useData } from "../context/data"
import { useLocal } from "../context/local"
import { useLocation } from "../context/location"
import { For, Match, Switch, Show, createMemo } from "solid-js"

export function DialogStatus() {
  const data = useData()
  const local = useLocal()
  const location = useLocation()
  const theme = useTheme().surface("dialog")
  const currentRef = () => location.ref ?? data.location.default()

  const agents = createMemo(() => (local.agent.all ? local.agent.all() : local.agent.list()))
  const skills = createMemo(() => data.location.skill.list(currentRef()) ?? [])
  const commands = createMemo(() => data.location.command.list(currentRef()) ?? [])
  const mcp = createMemo(() => data.location.mcp.server.list(currentRef()) ?? [])

  const breakdown = createMemo(() => {
    const allSkills = skills()
    const hooks = allSkills.filter((s) => s.id.startsWith("hook-") || s.name.startsWith("hook-")).length
    const mods = allSkills.filter((s) => s.id.startsWith("mod-") || s.name.startsWith("mod-")).length
    const settings = allSkills.filter((s) => s.id.startsWith("setting-") || s.name.startsWith("setting-")).length
    const pureSkills = allSkills.length - hooks - mods - settings
    const allCmds = commands()
    const loops = allCmds.filter((c) => c.name.startsWith("loop-")).length
    return {
      agents: agents().length,
      pureSkills,
      hooks,
      mods,
      settings,
      commands: allCmds.length,
      loops,
      mcps: mcp().length,
    }
  })

  const color = (status: string) => {
    if (status === "connected") return theme.text.feedback.success.base
    if (status === "failed") return theme.text.feedback.error.base
    if (status === "needs_auth") return theme.text.feedback.warning.base
    return theme.text.muted
  }

  return (
    <DialogLayout header={<DialogHeader title="Status do Sistema & Personalizações OmniCode" />}>
      <box flexDirection="column" gap={1}>
        <box flexDirection="column">
          <text fg={theme.text.base}>
            <b>Personalizações Ativas (Carregamento em Tempo Real)</b>
          </text>
          <text fg={theme.text.base}>
            • Agentes (@): <b>{breakdown().agents}</b> (/agents)
          </text>
          <text fg={theme.text.base}>
            • Skills (@): <b>{breakdown().pureSkills}</b> (/skills)
          </text>
          <text fg={theme.text.base}>
            • Mods & Plugins: <b>{breakdown().mods}</b> (/mods · /plugins)
          </text>
          <text fg={theme.text.base}>
            • Ganchos / Hooks: <b>{breakdown().hooks}</b> (/hooks)
          </text>
          <text fg={theme.text.base}>
            • Settings & Modos: <b>{breakdown().settings}</b> (/modes)
          </text>
          <text fg={theme.text.base}>
            • Comandos Slash & Loops (/): <b>{breakdown().commands}</b> ({breakdown().loops} loops) (/commands)
          </text>
          <text fg={theme.text.base}>
            • Servidores MCP: <b>{breakdown().mcps}</b> (/mcps)
          </text>
          <text fg={theme.text.muted}>
            Use /personalizacoes (ou Ctrl+P) para pesquisar tudo. Novos arquivos em %APPDATA%\omnicode ou .omnicode aparecem automaticamente.
          </text>
        </box>

        <Show when={mcp().length > 0} fallback={<text fg={theme.text.base}>Nenhum servidor MCP</text>}>
          <box flexDirection="column">
            <text fg={theme.text.base}>
              <b>Servidores MCP ({mcp().length} registrados — use /mcps para conectar/desconectar)</b>
            </text>
            <For each={mcp().slice(0, 12)}>
              {(item) => (
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} style={{ fg: color(item.status.status) }}>
                    •
                  </text>
                  <text fg={theme.text.base} wrapMode="word">
                    <b>{item.name}</b>{" "}
                    <span style={{ fg: theme.text.muted }}>
                      <Switch fallback={item.status.status}>
                        <Match when={item.status.status === "connected"}>Conectado</Match>
                        <Match when={item.status.status === "failed" && item.status}>{(val) => val().error}</Match>
                        <Match when={item.status.status === "disabled"}>Disponível (desativado por padrão)</Match>
                        <Match when={item.status.status === "needs_auth" && item.status}>
                          {(val) => `Requer autenticação: ${val().error}`}
                        </Match>
                      </Switch>
                    </span>
                  </text>
                </box>
              )}
            </For>
            <Show when={mcp().length > 12}>
              <text fg={theme.text.muted}>... e mais {mcp().length - 12} servidores em /mcps</text>
            </Show>
          </box>
        </Show>
      </box>
    </DialogLayout>
  )
}
