import { useDialog } from "@opencode/ui/context/dialog"
import { useTheme } from "@opencode/ui/theme/context"
import { useCommand } from "@/shell/commands/command"
import { usePlatform } from "@/runtime/platform/platform"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { useSettingsDialog } from "@/settings/command"
import { useFusion } from "@/providers/models/fusion"
import { showToast } from "@/shell/notifications/toast"
import { useWorkbench } from "./state"

export function useWorkbenchCommands() {
  const command = useCommand()
  const workbench = useWorkbench()
  const dialog = useDialog()
  const theme = useTheme()
  const platform = usePlatform()
  const openAppearanceSettings = useSettingsDialog("appearance")
  const fusion = useFusion()
  const { tr, locale } = useOnethyI18n()

  const openStatus = async () => {
    const { DialogSystemStatus } = await import("./dialogs/status-dialog")
    void dialog.show(() => <DialogSystemStatus onClose={() => dialog.close()} />)
  }

  const openDesktopControl = async () => {
    const { DialogDesktopControl } = await import("./dialogs/desktop-control-dialog")
    void dialog.show(() => <DialogDesktopControl onClose={() => dialog.close()} />)
  }

  const switchAgent = (agentId: string, enLabel: string, ptLabel: string) => {
    workbench.setAgent(agentId)
    showToast({
      variant: "default",
      title: tr("{{label}} activated (@{{id}})", "{{label}} ativado (@{{id}})", {
        label: tr(enLabel, ptLabel),
        id: agentId,
      }),
    })
  }

  command.register("workbench", () => [
    {
      id: "workbench.sidebar.toggle",
      title: tr("Toggle Tool Sidebar", "Alternar Sidebar de Ferramentas"),
      category: "IDE",
      keybind: "mod+b",
      onSelect: () => workbench.toggleSidebar(),
    },
    {
      id: "workbench.bottom.toggle",
      title: tr("Toggle Bottom Panel (Terminal / Logs / Problems)", "Alternar Painel Inferior (Terminal / Logs / Problems)"),
      category: "IDE",
      keybind: "mod+`,mod+j",
      onSelect: () => workbench.toggleBottom(),
    },
    {
      id: "workbench.activity.explorer",
      title: tr("Open File Explorer", "Abrir Explorer de Arquivos"),
      category: "IDE",
      keybind: "shift+mod+e",
      slash: "explorer",
      onSelect: () => workbench.openActivity("explorer"),
    },
    {
      id: "workbench.activity.search",
      title: tr("Open Global Code Search", "Abrir Busca Global no Código"),
      category: "IDE",
      keybind: "shift+mod+f",
      slash: "search",
      onSelect: () => workbench.openActivity("search"),
    },
    {
      id: "workbench.activity.git",
      title: tr("Open Git & Worktrees", "Abrir Git & Worktrees"),
      category: "IDE",
      keybind: "shift+mod+g",
      slash: "git",
      onSelect: () => workbench.openActivity("git"),
    },
    {
      id: "workbench.activity.agents",
      title: tr("Open Agents, Subagents & Approvals Panel", "Abrir Painel de Agentes, Subagentes & Aprovações"),
      category: tr("Agent", "Agente"),
      keybind: "shift+mod+a",
      slash: "agents",
      onSelect: () => workbench.openActivity("agents"),
    },
    {
      id: "workbench.activity.sessions",
      title: tr("Open Sessions Panel", "Abrir Painel de Sessões"),
      category: tr("Session", "Sessão"),
      slash: "sessions",
      onSelect: () => workbench.openActivity("sessions"),
    },
    {
      id: "workbench.activity.mcp",
      title: tr("Manage MCP Servers", "Gerenciar Servidores MCP"),
      category: "IDE",
      slash: "mcps",
      onSelect: () => workbench.openActivity("mcp"),
    },
    {
      id: "workbench.activity.skills",
      title: tr("Customizations Hub (Skills, Hooks, Mods, Modes & Commands)", "Hub de Customizações (Skills, Hooks, Mods, Modos e Comandos)"),
      category: "OnethyCode",
      slash: "customizations",
      onSelect: () => workbench.openActivity("skills"),
    },
    {
      id: "workbench.activity.skills.alias",
      title: tr("View Installed Skills", "Ver Skills Instaladas"),
      category: "OnethyCode",
      slash: "skills",
      onSelect: () => workbench.openActivity("skills"),
    },
    {
      id: "workbench.activity.hooks",
      title: tr("View Installed Hooks", "Ver Hooks Instalados"),
      category: "OnethyCode",
      slash: "hooks",
      onSelect: () => workbench.openActivity("skills"),
    },
    {
      id: "workbench.activity.mods",
      title: tr("View Mods & Plugins", "Ver Mods & Plugins"),
      category: "OnethyCode",
      slash: "mods",
      onSelect: () => workbench.openActivity("extensions"),
    },
    {
      id: "workbench.activity.models",
      title: tr("Models & Omni Fusion Panel", "Painel de Modelos & Omni Fusion"),
      category: tr("Model", "Modelo"),
      slash: "models",
      onSelect: () => workbench.openActivity("models"),
    },
    {
      id: "workbench.bottom.terminal",
      title: tr("Open Integrated Terminal", "Abrir Terminal Integrado"),
      category: "IDE",
      slash: "terminal",
      onSelect: () => workbench.openBottom("terminal"),
    },
    {
      id: "workbench.bottom.output",
      title: tr("Open Output Panel", "Abrir Painel Output"),
      category: "IDE",
      slash: "output",
      onSelect: () => workbench.openBottom("output"),
    },
    {
      id: "workbench.bottom.problems",
      title: tr("Open Problems Panel (Diagnostics)", "Abrir Painel Problems (Diagnósticos)"),
      category: "IDE",
      keybind: "shift+mod+m",
      slash: "problems",
      onSelect: () => workbench.openBottom("problems"),
    },
    {
      id: "workbench.bottom.logs",
      title: tr("View Core, Server & Desktop Logs", "Visualizar Logs do Core, Servidor e Desktop"),
      category: tr("System", "Sistema"),
      slash: "logs",
      onSelect: () => workbench.openBottom("logs"),
    },
    {
      id: "workbench.bottom.debug",
      title: tr("Open Debug Console & Diagnostics", "Abrir Debug Console & Diagnósticos"),
      category: tr("System", "Sistema"),
      slash: "debug",
      onSelect: () => workbench.openBottom("debug"),
    },
    {
      id: "workbench.layout.chat",
      title: tr("Layout: Chat Focus", "Layout: Foco no Chat"),
      category: tr("View", "Visualização"),
      keybind: "ctrl+alt+1",
      onSelect: () => workbench.setLayoutMode("chat"),
    },
    {
      id: "workbench.layout.split",
      title: tr("Layout: Split Chat + Editor/Diff", "Layout: Split Chat + Editor/Diff"),
      category: tr("View", "Visualização"),
      keybind: "ctrl+alt+2",
      onSelect: () => workbench.setLayoutMode("split"),
    },
    {
      id: "workbench.layout.editor",
      title: tr("Layout: Editor Focus", "Layout: Foco no Editor"),
      category: tr("View", "Visualização"),
      keybind: "ctrl+alt+3",
      onSelect: () => workbench.setLayoutMode("editor"),
    },
    {
      id: "workbench.status",
      title: tr("View Onethy Code System Status", "Ver Status do Sistema Onethy Code"),
      category: tr("System", "Sistema"),
      slash: "status",
      onSelect: () => void openStatus(),
    },
    {
      id: "workbench.desktop.control",
      title: tr("Manage Desktop Computer Use", "Gerenciar Desktop Computer Use"),
      category: "OnethyCode",
      slash: "desktop",
      onSelect: () => void openDesktopControl(),
    },
    {
      id: "workbench.theme.toggle",
      title:
        theme.mode() === "dark"
          ? tr("Switch to Light Theme (Porcelain)", "Alternar para Tema Claro (Porcelain)")
          : tr("Switch to Dark Theme (Obsidian)", "Alternar para Tema Escuro (Obsidian)"),
      category: tr("View", "Visualização"),
      slash: "themes",
      onSelect: () => {
        const next = theme.mode() === "dark" ? "light" : "dark"
        theme.setColorScheme(next)
        showToast({
          variant: "default",
          title:
            next === "dark"
              ? tr("Dark mode (Obsidian) enabled", "Modo Escuro (Obsidian) ativado")
              : tr("Light mode (Porcelain) enabled", "Modo Claro (Porcelain) ativado"),
        })
      },
    },
    {
      id: "workbench.theme.settings",
      title: tr("Choose Interface Theme", "Escolher Tema da Interface"),
      category: tr("View", "Visualização"),
      onSelect: () => openAppearanceSettings(),
    },
    {
      id: "workbench.service.restart",
      title: tr("Restart Application / Service", "Reiniciar Aplicativo / Serviço"),
      category: tr("System", "Sistema"),
      slash: "restart",
      onSelect: () => void platform.restart(),
    },
    {
      id: "workbench.fusion.tier",
      title: tr("Omni Fusion — Cycle Optimization Tier", "Omni Fusion — Alternar Nível de Otimização (Tier)"),
      category: "OnethyCode",
      slash: "tier",
      onSelect: () => {
        fusion.enable()
        fusion.cycleTier()
        showToast({ variant: "default", title: `Omni Fusion: ${fusion.tierLabel(undefined, locale())}` })
      },
    },
    {
      id: "workbench.fusion.thinking",
      title: tr("Omni Fusion — Toggle Thinking Routing", "Omni Fusion — Alternar Thinking Routing"),
      category: "OnethyCode",
      slash: "thinking",
      onSelect: () => {
        fusion.toggleThinkingRouting()
        showToast({
          variant: "default",
          title: fusion.thinkingRouting()
            ? tr("Thinking Routing enabled", "Thinking Routing ativado")
            : tr("Thinking Routing disabled", "Thinking Routing desativado"),
        })
      },
    },
    {
      id: "workbench.agent.omni",
      title: tr("Activate OnethyCode Orchestrator (@omni)", "Ativar Orquestrador OnethyCode (@omni)"),
      category: "OnethyCode",
      slash: "omni",
      onSelect: () => switchAgent("omni", "OnethyCode Orchestrator", "Orquestrador OnethyCode"),
    },
    {
      id: "workbench.agent.plan",
      title: tr("Activate Plan Mode (@plan)", "Ativar Modo Planejamento (@plan)"),
      category: "OnethyCode",
      slash: "plan",
      onSelect: () => switchAgent("plan", "Plan Mode", "Plan Mode"),
    },
    {
      id: "workbench.agent.architect",
      title: tr("Activate Software Architect (@architect)", "Ativar Especialista Arquiteto (@architect)"),
      category: "OnethyCode",
      slash: "architect",
      onSelect: () => switchAgent("architect", "Architect", "Arquiteto"),
    },
    {
      id: "workbench.agent.coder",
      title: tr("Activate Coder Specialist (@coder)", "Ativar Especialista Coder (@coder)"),
      category: "OnethyCode",
      slash: "coder",
      onSelect: () => switchAgent("coder", "Coder", "Coder"),
    },
    {
      id: "workbench.agent.reviewer",
      title: tr("Activate Code Reviewer (@reviewer)", "Ativar Especialista Code Reviewer (@reviewer)"),
      category: "OnethyCode",
      slash: "reviewer",
      onSelect: () => switchAgent("reviewer", "Reviewer", "Reviewer"),
    },
    {
      id: "workbench.agent.librarian",
      title: tr("Activate Librarian Specialist (@librarian)", "Ativar Especialista Librarian (@librarian)"),
      category: "OnethyCode",
      slash: "librarian",
      onSelect: () => switchAgent("librarian", "Librarian", "Librarian"),
    },
  ])
}
