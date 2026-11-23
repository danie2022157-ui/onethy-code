import { Tooltip } from "@opencode/ui/tooltip"
import { useCommand } from "@/shell/commands/command"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { useWorkbench, type LayoutMode } from "./state"
import {
  LayoutChatIcon,
  LayoutEditorIcon,
  LayoutSplitIcon,
  PanelBottomIcon,
  SearchCodeIcon,
  SidebarLeftIcon,
} from "./icons"

const MODES: ReadonlyArray<{ id: LayoutMode; en: string; pt: string; shortcut: string }> = [
  { id: "chat", en: "Chat Focus", pt: "Foco no Chat", shortcut: "Ctrl+Alt+1" },
  { id: "split", en: "Split Chat + Editor/Diff", pt: "Split Chat + Editor/Diff", shortcut: "Ctrl+Alt+2" },
  { id: "editor", en: "Editor Focus", pt: "Foco no Editor", shortcut: "Ctrl+Alt+3" },
]

export function TitlebarWorkbenchControls() {
  const workbench = useWorkbench()
  const command = useCommand()
  const { tr } = useOnethyI18n()

  return (
    <div
      data-slot="titlebar-workbench-controls"
      class="flex shrink-0 items-center gap-1 pe-1.5"
      style={{ "-webkit-app-region": "no-drag" }}
    >
      <Tooltip placement="bottom" value={tr("Command Palette (Ctrl+K / Ctrl+Shift+P)", "Command Palette (Ctrl+K / Ctrl+Shift+P)")}>
        <button
          type="button"
          class="flex h-6 items-center gap-1.5 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-2 text-[11px] text-v2-text-text-muted transition-colors hover:border-v2-border-border-base hover:text-v2-text-text-base"
          onClick={() => command.trigger("commands.search")}
        >
          <SearchCodeIcon size={12} />
          <span class="hidden xl:inline">{tr("Commands", "Comandos")}</span>
          <span class="rounded bg-v2-background-bg-layer-02 px-1 py-0.5 font-mono text-[10px] leading-none text-v2-text-text-faint">
            Ctrl+K
          </span>
        </button>
      </Tooltip>

      <div
        role="group"
        aria-label={tr("Main Area Layout Mode", "Modo de Layout da Área Principal")}
        class="flex items-center rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-0.5"
      >
        {MODES.map((item) => {
          const active = () => workbench.layoutMode() === item.id
          const label = () => tr(item.en, item.pt)
          return (
            <Tooltip placement="bottom" value={`${label()} (${item.shortcut})`}>
              <button
                type="button"
                aria-label={label()}
                aria-pressed={active()}
                class="flex h-5 w-6 items-center justify-center rounded-[4px] transition-colors"
                classList={{
                  "bg-v2-background-bg-accent text-v2-text-text-inverse": active(),
                  "text-v2-icon-icon-muted hover:text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover":
                    !active(),
                }}
                onClick={() => workbench.setLayoutMode(item.id)}
              >
                {item.id === "chat" && <LayoutChatIcon size={13} />}
                {item.id === "split" && <LayoutSplitIcon size={13} />}
                {item.id === "editor" && <LayoutEditorIcon size={13} />}
              </button>
            </Tooltip>
          )
        })}
      </div>

      <Tooltip placement="bottom" value={tr("Toggle Sidebar (Ctrl+B)", "Alternar Sidebar (Ctrl+B)")}>
        <button
          type="button"
          aria-label={tr("Toggle Sidebar", "Alternar Sidebar")}
          aria-pressed={workbench.sidebarOpen()}
          class="flex size-6 items-center justify-center rounded-[6px] transition-colors"
          classList={{
            "bg-v2-background-bg-layer-02 text-v2-text-text-accent": workbench.sidebarOpen(),
            "text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
              !workbench.sidebarOpen(),
          }}
          onClick={() => workbench.toggleSidebar()}
        >
          <SidebarLeftIcon size={14} />
        </button>
      </Tooltip>

      <Tooltip placement="bottom" value={tr("Toggle Bottom Panel (Ctrl+`)", "Alternar Painel Inferior (Ctrl+`)")}>
        <button
          type="button"
          aria-label={tr("Toggle Bottom Panel", "Alternar Painel Inferior")}
          aria-pressed={workbench.bottomOpen()}
          class="flex size-6 items-center justify-center rounded-[6px] transition-colors"
          classList={{
            "bg-v2-background-bg-layer-02 text-v2-text-text-accent": workbench.bottomOpen(),
            "text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
              !workbench.bottomOpen(),
          }}
          onClick={() => workbench.toggleBottom()}
        >
          <PanelBottomIcon size={14} />
        </button>
      </Tooltip>
    </div>
  )
}
