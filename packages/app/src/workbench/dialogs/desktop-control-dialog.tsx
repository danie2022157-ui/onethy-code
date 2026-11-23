import { createMemo, createResource, createSignal, For, Match, Show, Switch, untrack, type Component } from "solid-js"
import { Option, Schema } from "effect"
import type { McpServer } from "@opencode/client/promise"
import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { showToast } from "@/shell/notifications/toast"
import { useTabs } from "@/shell/tabs/tabs"
import { AgentsIcon, CheckShieldIcon, McpPlugIcon, PlayRunIcon, TerminalPromptIcon } from "../icons"
import { useWorkbench, type ShellRunResult } from "../state"

type TargetOS = "windows" | "macos" | "linux"

type CheckKey = "status" | "permissions" | "env" | "install"

type DiagnosticRow = {
  readonly label: string
  readonly value: string
  readonly severity: "normal" | "success" | "warning" | "error"
}

type CheckReport = {
  readonly key: CheckKey
  readonly command: string
  readonly result: ShellRunResult
  readonly ranAt: number
}

const AGENT_DESKTOP_PACKAGE = "agent-desktop@1.2.0"

const DESKTOP_MCP_PATTERN =
  /(desktop|computer[-_ ]?use|pyautogui|accessibility|playwright|puppeteer|browser|screen|window|gui|chrome[-_ ]?devtools|devtools|uiautomation|xdotool|applescript|robot|agent[-_ ]?desktop)/i

const OS_LABELS: Record<TargetOS, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
}

const OS_TABS: readonly TargetOS[] = ["windows", "macos", "linux"]

function DesktopMonitorIcon(props: { class?: string; size?: number }) {
  const size = () => props.size ?? 16
  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={props.class}
      aria-hidden="true"
    >
      <rect x="1.75" y="2.5" width="12.5" height="8.5" rx="1.6" stroke="currentColor" stroke-width="1.35" />
      <path d="M5.5 13.5h5M8 11v2.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
      <path d="m6.2 5.7 1.4 1.3-1.4 1.3M8.5 8.3h1.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

function detectInitialOS(platformOS: string | undefined): TargetOS {
  if (platformOS === "windows" || platformOS === "macos" || platformOS === "linux") return platformOS
  if (typeof navigator === "undefined") return "windows"
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("mac")) return "macos"
  if (ua.includes("linux")) return "linux"
  return "windows"
}

function isDesktopCapableMcp(server: McpServer) {
  return DESKTOP_MCP_PATTERN.test(server.name) || (server.title ? DESKTOP_MCP_PATTERN.test(server.title) : false)
}

function formatKey(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function classifySeverity(value: string): DiagnosticRow["severity"] {
  const normalized = value.trim().toLowerCase()
  if (
    ["granted", "allowed", "authorized", "ready", "available", "connected", "enabled", "ok", "supported", "true"].includes(
      normalized,
    )
  ) {
    return "success"
  }
  if (["denied", "blocked", "error", "failed", "unsupported", "unavailable", "false"].includes(normalized)) {
    return "error"
  }
  if (
    ["missing", "unknown", "prompt", "required", "not_granted", "not granted", "not_determined", "not determined"].includes(
      normalized,
    )
  ) {
    return "warning"
  }
  return "normal"
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

function parseJsonRows(output: string, defaults: { result: string; items: string }): readonly DiagnosticRow[] {
  const trimmed = output.trim()
  if (!trimmed.startsWith("{")) return []

  const decoded = decodeJson(trimmed)
  if (Option.isNone(decoded)) return []

  const root = decoded.value
  if (!root || typeof root !== "object" || Array.isArray(root)) return []

  const rows: DiagnosticRow[] = []
  const walk = (value: unknown, prefix: string, depth: number) => {
    if (rows.length >= 24) return
    if (value === null || value === undefined) return
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = String(value)
      rows.push({
        label: formatKey(prefix || defaults.result),
        value: text.length > 220 ? `${text.slice(0, 220)}...` : text,
        severity: classifySeverity(text),
      })
      return
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return
      if (value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
        const joined = value.map(String).join(", ")
        rows.push({
          label: formatKey(prefix || defaults.items),
          value: joined.length > 220 ? `${joined.slice(0, 220)}...` : joined,
          severity: "normal",
        })
        return
      }
      if (depth >= 3) return
      value.slice(0, 6).forEach((item, index) => walk(item, `${prefix} ${index + 1}`, depth + 1))
      return
    }
    if (depth >= 3) return
    for (const [key, nested] of Object.entries(value)) {
      if (rows.length >= 24) break
      walk(nested, prefix ? `${prefix} / ${key}` : key, depth + 1)
    }
  }

  walk(root, "", 0)
  return rows
}

function mcpDotClass(status: McpServer["status"]["status"]) {
  if (status === "connected") return "bg-emerald-500"
  if (status === "failed") return "bg-red-500"
  if (status === "needs_auth") return "bg-amber-500"
  if (status === "standby") return "bg-sky-500"
  return "bg-v2-icon-icon-muted opacity-60"
}

export const DialogDesktopControl: Component<{ onClose: () => void }> = (props) => {
  const { tr } = useOnethyI18n()
  const workbench = useWorkbench()
  const platform = usePlatform()
  const tabs = useTabs()

  const hostOS = detectInitialOS(platform.platform === "desktop" ? platform.os : undefined)
  const [selectedOS, setSelectedOS] = createSignal<TargetOS>(hostOS)
  const [mcpRefreshTick, setMcpRefreshTick] = createSignal(0)
  const [runningCheck, setRunningCheck] = createSignal<CheckKey | undefined>(undefined)
  const [report, setReport] = createSignal<CheckReport | undefined>(undefined)
  const [confirmInstall, setConfirmInstall] = createSignal(false)

  const checkTitle = (key: CheckKey) => {
    if (key === "status") return tr("Native Runtime Status", "Status do Runtime Nativo")
    if (key === "permissions") return tr("OS Accessibility Permissions", "Permissões de Acessibilidade do SO")
    if (key === "env") return tr("Local Environment Check", "Verificação do Ambiente Local")
    return tr("Install {{pkg}}", "Instalação de {{pkg}}", { pkg: AGENT_DESKTOP_PACKAGE })
  }

  const omniAutomationPrompt = () =>
    tr(
      "@omni Use the desktop_control tool to check the desktop environment status, list available windows, and present a plan before clicking or typing in any application.",
      "@omni Use a ferramenta desktop_control para verificar o status do ambiente desktop, listar as janelas disponíveis e apresentar um plano antes de clicar ou digitar em qualquer aplicativo.",
    )

  const [liveMcps] = createResource(
    () => {
      const ctx = workbench.activeServerCtx()
      const dir = workbench.activeDirectory() ?? ""
      const tick = mcpRefreshTick()
      if (!ctx) return undefined
      return `${ctx.sdk.url}\0${dir}\0${tick}`
    },
    async (): Promise<readonly McpServer[]> => {
      const ctx = untrack(workbench.activeServerCtx)
      if (!ctx) return []
      const loc = untrack(workbench.activeLocation)
      const location = loc ?? ctx.data.location.default()
      const res = await ctx.sdk.api.mcp.list({ location }).catch(() => undefined)
      return res?.data ?? ctx.data.location.mcp.server.list(location) ?? []
    },
  )

  const allMcps = createMemo<readonly McpServer[]>(() => {
    const fetched = liveMcps()
    if (fetched) return fetched
    const ctx = workbench.activeServerCtx()
    if (!ctx) return []
    const loc = workbench.activeLocation() ?? ctx.data.location.default()
    return ctx.data.location.mcp.server.list(loc) ?? []
  })

  const desktopMcps = createMemo(() => allMcps().filter(isDesktopCapableMcp))

  const connectedDesktopCount = createMemo(
    () => desktopMcps().filter((item) => item.status.status === "connected").length,
  )

  const connectedTotalMcpCount = createMemo(
    () => allMcps().filter((item) => item.status.status === "connected").length,
  )

  const runCheck = async (key: CheckKey, command: string, timeout = 20_000) => {
    if (runningCheck()) return

    setRunningCheck(key)
    const result = await workbench.runShellCommand(command, { timeout })
    setRunningCheck(undefined)

    setReport({
      key,
      command,
      result,
      ranAt: Date.now(),
    })

    const title = checkTitle(key)

    if (result.error) {
      showToast({
        variant: "error",
        title: tr("Failed to run: {{title}}", "Falha ao executar: {{title}}", { title }),
        description: result.error,
      })
      return
    }

    if (result.exit === 0) {
      showToast({
        variant: "success",
        title: tr("{{title}} completed", "{{title}} concluído", { title }),
      })
      return
    }

    showToast({
      variant: "default",
      title: tr("{{title}} exited with code {{code}}", "{{title}} retornou código {{code}}", {
        title,
        code: result.exit ?? tr("unknown", "desconhecido"),
      }),
      description: tr(
        "Check the output details in the diagnostics below.",
        "Consulte os detalhes da saída no diagnóstico abaixo.",
      ),
    })
  }

  const handleCheckRuntime = () => {
    void runCheck("status", "agent-desktop status", 15_000)
  }

  const handleCheckPermissions = () => {
    void runCheck("permissions", "agent-desktop permissions", 15_000)
  }

  const handleCheckEnvironment = () => {
    const notFound = tr("agent-desktop not found in PATH", "agent-desktop nao encontrado no PATH")
    const command =
      hostOS === "windows"
        ? "node -v & npm -v & where agent-desktop"
        : `node -v; npm -v; command -v agent-desktop || echo "${notFound}"`
    void runCheck("env", command, 15_000)
  }

  const handleInstallRuntime = () => {
    setConfirmInstall(false)
    void runCheck("install", `npm install -g ${AGENT_DESKTOP_PACKAGE}`, 180_000)
  }

  const handleOpenMcpPanel = () => {
    workbench.openActivity("mcp")
    props.onClose()
  }

  const handleInsertOmniPrompt = async () => {
    const promptText = omniAutomationPrompt()
    const bridge = workbench.bridge()
    if (bridge) {
      workbench.setAgent("omni")
      workbench.insertComposerText(promptText)
      showToast({
        variant: "success",
        title: tr("@omni prompt inserted in composer", "Prompt @omni inserido no composer"),
        description: tr(
          "Review the command and send when ready.",
          "Revise o comando e envie quando estiver pronto.",
        ),
      })
      props.onClose()
      return
    }

    const conn = workbench.activeServer()
    const dir = workbench.activeDirectory() ?? workbench.activeServerCtx()?.data.location.default().directory
    if (!conn || !dir) {
      showToast({
        variant: "error",
        title: tr("No active workspace", "Nenhum workspace ativo"),
        description: tr(
          "Open a project or session to start an automation with @omni.",
          "Abra um projeto ou sessão para iniciar uma automação com @omni.",
        ),
      })
      return
    }

    await tabs.newDraft({ server: ServerConnection.key(conn), directory: dir }, promptText)
    showToast({
      variant: "success",
      title: tr("New session prepared with @omni", "Nova sessão preparada com @omni"),
      description: tr(
        "The desktop automation prompt has been filled into the composer.",
        "O prompt de automação desktop já foi preenchido no composer.",
      ),
    })
    props.onClose()
  }

  const guidance = createMemo(() => {
    const os = selectedOS()
    if (os === "macos") {
      return {
        label: OS_LABELS.macos,
        subtitle: tr("Accessibility & Screen Recording", "Acessibilidade & Gravação de Tela"),
        steps: [
          tr(
            "Open System Settings -> Privacy & Security -> Accessibility and enable Onethy Code (or your host terminal).",
            "Abra Ajustes do Sistema -> Privacidade e Segurança -> Acessibilidade e habilite o Onethy Code (ou terminal host).",
          ),
          tr(
            "For visual window captures, also enable Privacy & Security -> Screen & System Audio Recording.",
            "Para capturas visuais de janelas, habilite também Privacidade e Segurança -> Gravação de Tela e Áudio do Sistema.",
          ),
          tr(
            "After granting permissions, restart the application so macOS applies the new TCC token.",
            "Após conceder as permissões, reinicie o aplicativo para que o macOS aplique o novo token TCC.",
          ),
        ],
        note: tr(
          "Without Accessibility permission, element snapshots and native clicks will be rejected by the system.",
          "Sem permissão de Acessibilidade, snapshots de elementos e cliques nativos serão recusados pelo sistema.",
        ),
      }
    }
    if (os === "linux") {
      return {
        label: OS_LABELS.linux,
        subtitle: "AT-SPI2 (X11 / Wayland)",
        steps: [
          tr(
            "Ensure an active graphical session with DISPLAY (X11) or WAYLAND_DISPLAY (Wayland) exported in the server environment.",
            "Garanta uma sessão gráfica ativa com DISPLAY (X11) ou WAYLAND_DISPLAY (Wayland) exportado no ambiente do servidor.",
          ),
          tr(
            "Install and enable the AT-SPI2 accessibility bus (at-spi2-core / libatk-adaptor packages) and GTK_MODULES=gail:atk-bridge.",
            "Instale e ative o barramento de acessibilidade AT-SPI2 (pacotes at-spi2-core / libatk-adaptor) e GTK_MODULES=gail:atk-bridge.",
          ),
          tr(
            "In restrictive Wayland sessions, prefer XWayland windows or compositors supporting the RemoteDesktop portal.",
            "Em sessões Wayland restritivas, prefira janelas XWayland ou compositores com suporte ao portal RemoteDesktop.",
          ),
        ],
        note: tr(
          "Headless SSH sessions without a graphical bus do not expose an accessibility tree.",
          "Sessões SSH headless sem barramento gráfico não expõem árvore de acessibilidade.",
        ),
      }
    }
    return {
      label: OS_LABELS.windows,
      subtitle: tr("Native UI Automation (UIA)", "UI Automation (UIA) nativo"),
      steps: [
        tr(
          "The native runtime uses Windows UI Automation without needing extra permissions for standard user applications.",
          "O runtime nativo utiliza Windows UI Automation sem necessidade de permissões extras para aplicativos de usuário comum.",
        ),
        tr(
          "To control windows running as Administrator, launch the Onethy Code server with the same privilege level.",
          "Para controlar janelas executando como Administrador, inicie o servidor Onethy Code com o mesmo nível de privilégio.",
        ),
        tr(
          "If Windows Defender or SmartScreen blocks the agent-desktop binary, allow execution in Protection History.",
          "Caso o Windows Defender ou SmartScreen bloqueie o binário agent-desktop, autorize a execução no histórico de proteção.",
        ),
      ],
      note: tr(
        "Automation always executes on the machine hosting the Onethy Code backend.",
        "A automação executa sempre na máquina que hospeda o backend do Onethy Code.",
      ),
    }
  })

  const reportRows = createMemo(() => {
    const current = report()
    if (!current) return []
    return parseJsonRows(current.result.output, {
      result: tr("Result", "Resultado"),
      items: tr("Items", "Itens"),
    })
  })

  const reportOk = createMemo(() => {
    const current = report()
    if (!current) return false
    return !current.result.error && current.result.exit === 0
  })

  return (
    <Dialog
      size="large"
      fit
      containerClass="!w-[min(calc(100vw_-_32px),780px)] !max-h-[min(calc(100vh_-_48px),720px)] !rounded-[12px] !bg-v2-background-bg-base"
      class="[font-family:var(--v2-font-family-sans)]"
    >
      <DialogHeader closeLabel={tr("Close", "Fechar")}>
        <div class="flex min-w-0 flex-1 items-start justify-between gap-3 pe-2">
          <div class="flex min-w-0 items-start gap-2.5">
            <div class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01 text-v2-text-text-accent">
              <DesktopMonitorIcon size={16} />
            </div>
            <DialogTitleGroup
              title="Desktop Control & Computer Use"
              description={tr(
                "Inspect automation MCP servers, run live native runtime diagnostics, and review OS permissions",
                "Inspeção de servidores MCP de automação, diagnóstico real do runtime nativo e permissões do sistema operacional",
              )}
            />
          </div>

          <Badge variant={connectedDesktopCount() > 0 ? "accent" : "neutral"} class="mt-1 shrink-0">
            {OS_LABELS[hostOS]}
          </Badge>
        </div>
      </DialogHeader>

      <DialogBody class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-1 [scrollbar-width:thin]">
        {/* Section 1: Real MCP Desktop Capabilities */}
        <section class="rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-3.5">
          <div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <McpPlugIcon size={14} class="text-v2-icon-icon-muted" />
              <span class="text-[12.5px] font-semibold text-v2-text-text-base">
                {tr("Desktop & Automation MCP Capabilities", "Capacidades MCP de Desktop & Automação")}
              </span>
              <Badge variant={connectedDesktopCount() > 0 ? "accent" : "neutral"}>
                {tr("{{connected}}/{{total}} active", "{{connected}}/{{total}} ativos", {
                  connected: connectedDesktopCount(),
                  total: desktopMcps().length,
                })}
              </Badge>
            </div>

            <div class="flex items-center gap-2">
              <span class="text-[11px] text-v2-text-text-faint">
                {tr("Total connected MCPs: {{connected}}/{{total}}", "Total MCP conectados: {{connected}}/{{total}}", {
                  connected: connectedTotalMcpCount(),
                  total: allMcps().length,
                })}
              </span>
              <button
                type="button"
                class="inline-flex h-6 items-center gap-1 rounded border border-v2-border-border-base bg-v2-background-bg-base px-2 text-[11px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
                disabled={liveMcps.loading}
                onClick={() => setMcpRefreshTick((n) => n + 1)}
              >
                <Show when={liveMcps.loading} fallback={<Icon name="refresh" size="small" class="size-3" />}>
                  <Loader width={11} height={11} />
                </Show>
                <span>{tr("Revalidate", "Revalidar")}</span>
              </button>
            </div>
          </div>

          <Show
            when={desktopMcps().length > 0}
            fallback={
              <div class="flex flex-col gap-1.5 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2.5 text-[12px]">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="font-medium text-v2-text-text-base">
                    {tr(
                      "No desktop/browser-specific MCP server detected",
                      "Nenhum servidor MCP específico de desktop/browser detectado",
                    )}
                  </span>
                  <button
                    type="button"
                    class="text-[11.5px] font-medium text-v2-text-text-accent hover:underline"
                    onClick={handleOpenMcpPanel}
                  >
                    {tr("Configure in MCP Panel", "Configurar no Painel MCP")}
                  </button>
                </div>
                <p class="text-[11.5px] leading-4 text-v2-text-text-muted">
                  {tr(
                    "Agents can still operate native windows using the built-in",
                    "Os agentes ainda podem operar janelas nativas usando a ferramenta integrada",
                  )}{" "}
                  <code class="rounded bg-v2-background-bg-layer-02 px-1 py-0.5 font-mono text-[11px] text-v2-text-text-base">
                    desktop_control
                  </code>{" "}
                  {tr("tool (via", "(via runtime")}{" "}
                  <code class="font-mono text-[11px]">agent-desktop</code>
                  {tr(
                    " runtime) or via MCP servers such as Playwright and Chrome DevTools.",
                    ") ou via MCPs como Playwright e Chrome DevTools.",
                  )}
                </p>
              </div>
            }
          >
            <div class="flex flex-col gap-1.5">
              <For each={desktopMcps()}>
                {(server) => (
                  <div class="flex items-center justify-between gap-2 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-2.5 py-2 text-[12px]">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class={`size-2 shrink-0 rounded-full ${mcpDotClass(server.status.status)}`} />
                      <span class="truncate font-medium text-v2-text-text-base">{server.title ?? server.name}</span>
                      <Show when={server.title && server.title !== server.name}>
                        <span class="truncate font-mono text-[10.5px] text-v2-text-text-faint">{server.name}</span>
                      </Show>
                    </div>
                    <span class="max-w-[50%] truncate text-[11px] text-v2-text-text-muted">
                      <Switch fallback={server.status.status}>
                        <Match when={server.status.status === "connected"}>
                          <span class="font-medium text-v2-state-fg-success">{tr("Connected", "Conectado")}</span>
                        </Match>
                        <Match when={server.status.status === "standby"}>{tr("Standby", "Standby")}</Match>
                        <Match when={server.status.status === "disabled"}>{tr("Disabled", "Desativado")}</Match>
                        <Match when={server.status.status === "failed" ? server.status : undefined}>
                          {(failed) => (
                            <span class="text-v2-state-fg-danger">{failed().error || tr("Failed", "Falha")}</span>
                          )}
                        </Match>
                        <Match when={server.status.status === "needs_auth" ? server.status : undefined}>
                          {(auth) => (
                            <span class="text-v2-state-fg-warning">
                              {tr("Auth: {{reason}}", "Auth: {{reason}}", {
                                reason: auth().error || tr("required", "necessária"),
                              })}
                            </span>
                          )}
                        </Match>
                      </Switch>
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        {/* Section 2: Real Environment Diagnostics via runShellCommand */}
        <section class="rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-3.5">
          <div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <TerminalPromptIcon size={14} class="text-v2-icon-icon-muted" />
              <span class="text-[12.5px] font-semibold text-v2-text-text-base">
                {tr("Live Environment Verification (Shell)", "Verificação Real do Ambiente (Shell)")}
              </span>
            </div>
            <Show when={!workbench.activeDirectory()}>
              <span class="text-[11px] text-v2-state-fg-warning">
                {tr("Open a workspace to run checks", "Abra um workspace para executar verificações")}
              </span>
            </Show>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button
              size="small"
              variant="neutral"
              disabled={Boolean(runningCheck()) || !workbench.activeDirectory()}
              onClick={handleCheckRuntime}
            >
              <span class="inline-flex items-center gap-1.5">
                <Show when={runningCheck() === "status"} fallback={<PlayRunIcon size={12} />}>
                  <Loader width={12} height={12} />
                </Show>
                <span>{tr("Runtime Status", "Status do Runtime")}</span>
              </span>
            </Button>

            <Button
              size="small"
              variant="neutral"
              disabled={Boolean(runningCheck()) || !workbench.activeDirectory()}
              onClick={handleCheckPermissions}
            >
              <span class="inline-flex items-center gap-1.5">
                <Show when={runningCheck() === "permissions"} fallback={<CheckShieldIcon size={12} />}>
                  <Loader width={12} height={12} />
                </Show>
                <span>{tr("Test Permissions", "Testar Permissões")}</span>
              </span>
            </Button>

            <Button
              size="small"
              variant="neutral"
              disabled={Boolean(runningCheck()) || !workbench.activeDirectory()}
              onClick={handleCheckEnvironment}
            >
              <span class="inline-flex items-center gap-1.5">
                <Show when={runningCheck() === "env"} fallback={<TerminalPromptIcon size={12} />}>
                  <Loader width={12} height={12} />
                </Show>
                <span>{tr("Check Node / Binary", "Checar Node / Binário")}</span>
              </span>
            </Button>

            <Button
              size="small"
              variant="ghost"
              disabled={Boolean(runningCheck()) || !workbench.activeDirectory()}
              onClick={() => setConfirmInstall((current) => !current)}
            >
              <span class="inline-flex items-center gap-1.5">
                <Icon name="plus" size="small" class="size-3" />
                <span>{tr("Install {{pkg}}", "Instalar {{pkg}}", { pkg: AGENT_DESKTOP_PACKAGE })}</span>
              </span>
            </Button>
          </div>

          <Show when={confirmInstall()}>
            <div class="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px]">
              <span class="text-v2-text-text-base">
                {tr("Run", "Executar")}{" "}
                <code class="font-mono">npm install -g {AGENT_DESKTOP_PACKAGE}</code>{" "}
                {tr("on this machine?", "nesta máquina?")}
              </span>
              <div class="flex items-center gap-1.5">
                <Button size="small" variant="ghost" onClick={() => setConfirmInstall(false)}>
                  {tr("Cancel", "Cancelar")}
                </Button>
                <Button size="small" variant="submit" onClick={handleInstallRuntime}>
                  {tr("Confirm Installation", "Confirmar Instalação")}
                </Button>
              </div>
            </div>
          </Show>

          <Show when={report()}>
            {(current) => (
              <div class="mt-3 flex flex-col gap-2 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base p-2.5">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-v2-border-border-muted pb-1.5">
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      class="size-2 shrink-0 rounded-full"
                      classList={{
                        "bg-emerald-500": reportOk(),
                        "bg-amber-500": !reportOk() && !current().result.error,
                        "bg-red-500": Boolean(current().result.error),
                      }}
                    />
                    <span class="truncate text-[12px] font-semibold text-v2-text-text-base">
                      {checkTitle(current().key)}
                    </span>
                  </div>
                  <div class="flex items-center gap-2 font-mono text-[10.5px] text-v2-text-text-faint">
                    <span>exit {current().result.exit ?? "—"}</span>
                    <span>·</span>
                    <span class="max-w-[260px] truncate" title={current().command}>
                      {current().command}
                    </span>
                  </div>
                </div>

                <Show when={reportRows().length > 0}>
                  <div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    <For each={reportRows()}>
                      {(row) => (
                        <div class="flex items-center justify-between gap-2 rounded bg-v2-background-bg-layer-01 px-2 py-1 text-[11.5px]">
                          <span class="truncate text-v2-text-text-muted">{row.label}</span>
                          <span
                            class="max-w-[60%] truncate font-mono font-medium"
                            classList={{
                              "text-v2-state-fg-success": row.severity === "success",
                              "text-v2-state-fg-warning": row.severity === "warning",
                              "text-v2-state-fg-danger": row.severity === "error",
                              "text-v2-text-text-base": row.severity === "normal",
                            }}
                            title={row.value}
                          >
                            {row.value}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={current().result.error}>
                  {(err) => <div class="text-[11.5px] text-v2-state-fg-danger">{err()}</div>}
                </Show>

                <Show when={current().result.output.trim().length > 0}>
                  <pre class="max-h-36 overflow-auto rounded bg-v2-background-bg-deep p-2 font-mono text-[11px] leading-4 text-v2-text-text-muted whitespace-pre-wrap break-words [scrollbar-width:thin]">
                    {current().result.output.trim()}
                  </pre>
                </Show>
              </div>
            )}
          </Show>
        </section>

        {/* Section 3: OS-Specific Permissions & Usage Guidance */}
        <section class="rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-3.5">
          <div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <CheckShieldIcon size={14} class="text-v2-icon-icon-muted" />
              <span class="text-[12.5px] font-semibold text-v2-text-text-base">
                {tr("Permissions by Operating System", "Permissões por Sistema Operacional")}
              </span>
            </div>

            <div class="flex items-center gap-0.5 rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-0.5">
              <For each={OS_TABS}>
                {(os) => {
                  const active = () => selectedOS() === os
                  return (
                    <button
                      type="button"
                      class="rounded px-2 py-0.5 text-[11px] font-medium transition-colors"
                      classList={{
                        "bg-v2-background-bg-accent text-v2-text-text-inverse": active(),
                        "text-v2-text-text-muted hover:text-v2-text-text-base": !active(),
                      }}
                      onClick={() => setSelectedOS(os)}
                    >
                      {OS_LABELS[os]}
                      {os === hostOS ? tr(" (current)", " (atual)") : ""}
                    </button>
                  )
                }}
              </For>
            </div>
          </div>

          <div class="rounded-md border border-v2-border-border-muted bg-v2-background-bg-base p-3">
            <div class="mb-1.5 text-[11.5px] font-semibold text-v2-text-text-base">{guidance().subtitle}</div>
            <ul class="flex flex-col gap-1.5 text-[11.5px] leading-4 text-v2-text-text-muted">
              <For each={guidance().steps}>
                {(step, index) => (
                  <li class="flex items-start gap-2">
                    <span class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-v2-background-bg-layer-02 font-mono text-[10px] font-semibold text-v2-text-text-base">
                      {index() + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                )}
              </For>
            </ul>
            <div class="mt-2.5 border-t border-v2-border-border-muted pt-2 text-[11px] text-v2-text-text-faint">
              {guidance().note} {tr("Recommended flow:", "Fluxo recomendado:")}{" "}
              <span class="font-mono text-v2-text-text-muted">
                {tr(
                  "status -> list-windows -> snapshot -> action on ref -> verify",
                  "status -> list-windows -> snapshot -> ação em ref -> verificar",
                )}
              </span>
              .{" "}
              {tr(
                "Never expose credentials or sensitive screenshots without authorization.",
                "Nunca exponha credenciais ou capturas sensíveis sem autorização.",
              )}
            </div>
          </div>
        </section>
      </DialogBody>

      <DialogFooter>
        <div class="flex w-full flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-1.5">
            <Button size="small" variant="neutral" onClick={handleOpenMcpPanel}>
              <span class="inline-flex items-center gap-1.5">
                <McpPlugIcon size={13} />
                <span>{tr("Open MCP Panel", "Abrir Painel MCP")}</span>
              </span>
            </Button>

            <Button size="small" variant="neutral" onClick={() => void handleInsertOmniPrompt()}>
              <span class="inline-flex items-center gap-1.5">
                <AgentsIcon size={13} />
                <span>{tr("Insert @omni Prompt", "Inserir Prompt @omni")}</span>
              </span>
            </Button>
          </div>

          <Button size="small" variant="submit" onClick={props.onClose}>
            {tr("Close", "Fechar")}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
