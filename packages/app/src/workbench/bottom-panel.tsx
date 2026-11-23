import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { Tooltip } from "@opencode/ui/tooltip"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { BugDebugIcon, LogsStreamIcon, TerminalPromptIcon } from "./icons"
import { useWorkbench, type BottomTab } from "./state"
import { DebugTab } from "./bottom/debug-tab"
import { LogsTab } from "./bottom/logs-tab"
import { OutputTab } from "./bottom/output-tab"
import { ProblemsTab } from "./bottom/problems-tab"
import { TerminalTab } from "./bottom/terminal-tab"

const BOTTOM_TAB_IDS: readonly BottomTab[] = ["terminal", "output", "problems", "logs", "debug"]

function computeMaxHeight() {
  if (typeof window === "undefined") return 560
  return Math.max(260, Math.round(window.innerHeight * 0.65))
}

function MaximizeIcon(props: { maximized: boolean }) {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <Show
        when={props.maximized}
        fallback={<path d="M4.5 10L8 6.5L11.5 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />}
      >
        <path d="M4.5 6.5L8 10L11.5 6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </Show>
    </svg>
  )
}

export function WorkbenchBottomPanel() {
  const workbench = useWorkbench()
  const { tr } = useOnethyI18n()

  const tabLabel = (id: BottomTab) => {
    if (id === "terminal") return tr("Terminal", "Terminal")
    if (id === "output") return tr("Output", "Saída")
    if (id === "problems") return tr("Problems", "Problemas")
    if (id === "logs") return tr("Logs", "Logs")
    return tr("Debug Console", "Console de Debug")
  }

  const [hasOpened, setHasOpened] = createSignal(workbench.bottomOpen())
  const [terminalMounted, setTerminalMounted] = createSignal(
    workbench.bottomOpen() && workbench.bottomTab() === "terminal",
  )
  const [maximized, setMaximized] = createSignal(false)

  createEffect(() => {
    if (workbench.bottomOpen()) setHasOpened(true)
  })

  createEffect(() => {
    if (workbench.bottomOpen() && workbench.bottomTab() === "terminal") {
      setTerminalMounted(true)
    }
  })

  const problemCount = createMemo(() => workbench.problems().length)
  const errorCount = createMemo(() => workbench.problems().filter((p) => p.severity === "error").length)
  const warningCount = createMemo(() => workbench.problems().filter((p) => p.severity === "warning").length)

  const maxHeight = () => computeMaxHeight()
  const effectiveHeight = () => (maximized() ? maxHeight() : workbench.bottomHeight())

  const renderTabIcon = (id: BottomTab) => {
    if (id === "terminal") return <TerminalPromptIcon size={13} />
    if (id === "output") return <Icon name="code-lines" size="small" class="size-3.5" />
    if (id === "problems") return <Icon name="outline-hexagonal-warning" size="small" class="size-3.5" />
    if (id === "logs") return <LogsStreamIcon size={13} />
    return <BugDebugIcon size={13} />
  }

  return (
    <Show when={hasOpened()}>
      <section
        data-slot="workbench-bottom-panel"
        aria-label={tr("Workbench Bottom Panel", "Painel Inferior do Workbench")}
        class="relative z-10 flex shrink-0 flex-col"
        classList={{ hidden: !workbench.bottomOpen() }}
        style={{ height: `${effectiveHeight()}px` }}
      >
        <ResizeHandle
          direction="vertical"
          edge="start"
          size={effectiveHeight()}
          min={140}
          max={maxHeight()}
          collapseThreshold={90}
          onResize={(height) => {
            if (maximized()) setMaximized(false)
            workbench.setBottomHeight(height)
          }}
          onCollapse={() => workbench.closeBottom()}
        />

        <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* 34px tab strip */}
          <div
            data-slot="workbench-bottom-tabs"
            class="flex shrink-0 items-center justify-between gap-2 pe-2 select-none"
          >
            <div
              class="flex min-w-0 items-center overflow-x-auto"
              role="tablist"
              aria-label={tr("Bottom panel tabs", "Abas do painel inferior")}
            >
              <For each={BOTTOM_TAB_IDS}>
                {(tabId) => {
                  const isActive = () => workbench.bottomTab() === tabId
                  return (
                    <button
                      type="button"
                      role="tab"
                      data-slot="workbench-bottom-tab"
                      data-tab={tabId}
                      data-active={isActive() ? "true" : "false"}
                      aria-selected={isActive()}
                      class="shrink-0 whitespace-nowrap"
                      onClick={() => workbench.openBottom(tabId)}
                    >
                      {renderTabIcon(tabId)}
                      <span>{tabLabel(tabId)}</span>
                      <Show when={tabId === "problems" && problemCount() > 0}>
                        <span
                          class="rounded-full px-1.5 py-0.5 font-mono text-[9.5px] font-semibold leading-none"
                          classList={{
                            "bg-v2-state-fg-danger/15 text-v2-state-fg-danger": errorCount() > 0,
                            "bg-v2-state-fg-warning/15 text-v2-state-fg-warning":
                              errorCount() === 0 && warningCount() > 0,
                            "bg-v2-background-bg-layer-02 text-v2-text-text-muted":
                              errorCount() === 0 && warningCount() === 0,
                          }}
                        >
                          {problemCount()}
                        </span>
                      </Show>
                    </button>
                  )
                }}
              </For>
            </div>

            <div class="flex shrink-0 items-center gap-0.5">
              <Tooltip
                placement="top"
                value={
                  maximized()
                    ? tr("Restore panel height", "Restaurar altura do painel")
                    : tr("Maximize panel", "Maximizar painel")
                }
              >
                <button
                  type="button"
                  class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                  aria-label={
                    maximized() ? tr("Restore panel", "Restaurar painel") : tr("Maximize panel", "Maximizar painel")
                  }
                  aria-pressed={maximized()}
                  onClick={() => setMaximized((v) => !v)}
                >
                  <MaximizeIcon maximized={maximized()} />
                </button>
              </Tooltip>

              <Tooltip placement="top" value={tr("Close Panel (Ctrl+`)", "Fechar Painel (Ctrl+`)")}>
                <button
                  type="button"
                  class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                  aria-label={tr("Close Bottom Panel", "Fechar Painel Inferior")}
                  onClick={() => workbench.closeBottom()}
                >
                  <Icon name="close" size="small" />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Tab content body */}
          <div class="relative min-h-0 flex-1 overflow-hidden">
            {/* Keep Terminal mounted once opened so live PTY sessions stay alive across tab switches */}
            <Show when={terminalMounted()}>
              <div
                class="size-full"
                classList={{ hidden: workbench.bottomTab() !== "terminal" }}
              >
                <TerminalTab visible={workbench.bottomOpen() && workbench.bottomTab() === "terminal"} />
              </div>
            </Show>

            <Show when={workbench.bottomTab() === "output"}>
              <OutputTab visible={workbench.bottomOpen() && workbench.bottomTab() === "output"} />
            </Show>

            <Show when={workbench.bottomTab() === "problems"}>
              <ProblemsTab />
            </Show>

            <Show when={workbench.bottomTab() === "logs"}>
              <LogsTab visible={workbench.bottomOpen() && workbench.bottomTab() === "logs"} />
            </Show>

            <Show when={workbench.bottomTab() === "debug"}>
              <DebugTab visible={workbench.bottomOpen() && workbench.bottomTab() === "debug"} />
            </Show>
          </div>
        </div>
      </section>
    </Show>
  )
}
