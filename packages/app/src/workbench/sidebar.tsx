import { lazy, Match, Show, Suspense, Switch } from "solid-js"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { useWorkbench, type ActivityView } from "./state"

const ExplorerPanel = lazy(() =>
  import("./panels/explorer-panel").then((mod) => ({ default: mod.ExplorerPanel })),
)
const SearchPanel = lazy(() =>
  import("./panels/search-panel").then((mod) => ({ default: mod.SearchPanel })),
)
const GitPanel = lazy(() =>
  import("./panels/git-panel").then((mod) => ({ default: mod.GitPanel })),
)
const AgentsPanel = lazy(() =>
  import("./panels/agents-panel").then((mod) => ({ default: mod.AgentsPanel })),
)
const SessionsPanel = lazy(() =>
  import("./panels/sessions-panel").then((mod) => ({ default: mod.SessionsPanel })),
)
const McpPanel = lazy(() =>
  import("./panels/mcp-panel").then((mod) => ({ default: mod.McpPanel })),
)
const CustomizationsPanel = lazy(() =>
  import("./panels/customizations-panel").then((mod) => ({ default: mod.CustomizationsPanel })),
)
const ExtensionsPanel = lazy(() =>
  import("./panels/extensions-panel").then((mod) => ({ default: mod.ExtensionsPanel })),
)
const ModelsPanel = lazy(() =>
  import("./panels/models-panel").then((mod) => ({ default: mod.ModelsPanel })),
)

const TITLE_MAP: Record<ActivityView, { en: string; pt: string }> = {
  explorer: { en: "Explorer", pt: "Explorer" },
  search: { en: "Global Search", pt: "Busca Global" },
  git: { en: "Git & Worktrees", pt: "Git & Worktrees" },
  agents: { en: "Agents & Activity", pt: "Agentes & Atividade" },
  sessions: { en: "Sessions", pt: "Sessões" },
  mcp: { en: "MCP Servers", pt: "Servidores MCP" },
  skills: { en: "Skills & Customizations", pt: "Skills & Customizações" },
  extensions: { en: "Extensions", pt: "Extensões" },
  models: { en: "Models & Fusion", pt: "Modelos & Fusion" },
}

function PanelFallback() {
  const { tr } = useOnethyI18n()

  return (
    <div class="flex flex-1 items-center justify-center p-4 text-[12px] text-v2-text-text-faint">
      {tr("Loading panel...", "Carregando painel...")}
    </div>
  )
}

export function WorkbenchSidebar() {
  const workbench = useWorkbench()
  const { tr } = useOnethyI18n()

  const activeTitle = () => {
    const entry = TITLE_MAP[workbench.activity()]
    return tr(entry.en, entry.pt)
  }

  return (
    <Show when={workbench.sidebarOpen()}>
      <aside
        data-slot="workbench-sidebar"
        aria-label={activeTitle()}
        class="relative z-10 flex h-full min-h-0 shrink-0 flex-col overflow-hidden"
        style={{ width: `${workbench.sidebarWidth()}px` }}
      >
        <div
          data-slot="workbench-sidebar-header"
          class="flex shrink-0 items-center justify-between px-3 select-none"
        >
          <span class="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-v2-text-text-muted">
            {activeTitle()}
          </span>
          <Tooltip placement="bottom" value={tr("Collapse Sidebar (Ctrl+B)", "Recolher Sidebar (Ctrl+B)")}>
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
              aria-label={tr("Collapse Sidebar", "Recolher Sidebar")}
              onClick={() => workbench.closeSidebar()}
            >
              <Icon name="close" size="small" />
            </button>
          </Tooltip>
        </div>

        <div data-slot="workbench-scroll" class="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Suspense fallback={<PanelFallback />}>
            <Switch>
              <Match when={workbench.activity() === "explorer"}>
                <ExplorerPanel />
              </Match>
              <Match when={workbench.activity() === "search"}>
                <SearchPanel />
              </Match>
              <Match when={workbench.activity() === "git"}>
                <GitPanel />
              </Match>
              <Match when={workbench.activity() === "agents"}>
                <AgentsPanel />
              </Match>
              <Match when={workbench.activity() === "sessions"}>
                <SessionsPanel />
              </Match>
              <Match when={workbench.activity() === "mcp"}>
                <McpPanel />
              </Match>
              <Match when={workbench.activity() === "skills"}>
                <CustomizationsPanel />
              </Match>
              <Match when={workbench.activity() === "extensions"}>
                <ExtensionsPanel />
              </Match>
              <Match when={workbench.activity() === "models"}>
                <ModelsPanel />
              </Match>
            </Switch>
          </Suspense>
        </div>

        <ResizeHandle
          class="-end-1"
          direction="horizontal"
          size={workbench.sidebarWidth()}
          min={210}
          max={480}
          onResize={(width) => workbench.setSidebarWidth(width)}
        />
      </aside>
    </Show>
  )
}
