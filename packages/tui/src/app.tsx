import { existsSync } from "fs"
import path from "path"
import { render, useRenderer, useTerminalDimensions } from "@opentui/solid"
import "./component/spinner-renderable"
import { Effect, Latch } from "effect"
import { Service, type Endpoint } from "@opencode/client/effect/service"
import { OpenCode, type SessionInfo } from "@opencode/client"
import { Global } from "@opencode/util/global"
import { noTimeoutFetch } from "@opencode/util/no-timeout-fetch"
import { ClipboardProvider, useClipboard } from "./context/clipboard"
import { LogProvider, type LogSink } from "./context/log"
import { ExitProvider, useExit } from "./context/exit"
import { EpilogueProvider } from "./context/epilogue"
import { epilogue, type SessionEpilogue } from "./util/presentation"
import { Selection } from "./util/selection"
import {
  CliRenderEvents,
  createCliRenderer,
  MouseButton,
  type CliRenderer,
  type CliRendererConfig,
  type ThemeMode,
} from "@opentui/core"
import { RouteProvider, useRoute } from "./context/route"
import {
  Switch,
  Match,
  createEffect,
  createMemo,
  ErrorBoundary,
  createSignal,
  onMount,
  onCleanup,
  batch,
  Show,
} from "solid-js"
import {
  TuiLifecycleProvider,
  TuiAppProvider,
  TuiPathsProvider,
  TuiStartupProvider,
  TuiTerminalEnvironmentProvider,
  useTuiApp,
  useTuiPaths,
  useTuiStartup,
  useTuiTerminalEnvironment,
  type TuiApp,
} from "./context/runtime"
import { DialogProvider, useDialog } from "./ui/dialog"
import { DialogIntegration } from "./component/dialog-integration"
import { ErrorComponent } from "./component/error-component"
import { PluginRouteMissing } from "./component/plugin-route-missing"
import { EditorContextProvider } from "./context/editor"
import { useEvent } from "./context/event"
import { ClientProvider, useClient } from "./context/client"
import { StartupLoading } from "./component/startup-loading"
import { DevToolsBar } from "./component/devtools-bar"
import { Reconnecting } from "./component/reconnecting"
import { MigrationOverlay } from "./component/migration-overlay"
import { DataProvider, useData } from "./context/data"
import { SessionTabsProvider, useSessionTabs } from "./context/session-tabs"
import { LocationProvider, useLocation } from "./context/location"
import { LocalProvider, useLocal } from "./context/local"
import { PermissionProvider } from "./context/permission"
import { DialogModel } from "./component/dialog-model"
import { useConnected } from "./component/use-connected"
import { DialogMcp } from "./component/dialog-mcp"
import { DialogUsage } from "./component/usage"
import { DialogStatus } from "./component/dialog-status"
import { DialogConfig } from "./component/dialog-config"
import { DialogDebug } from "./component/dialog-debug"
import { DialogPair } from "./component/dialog-pair"
import { DialogHighlights } from "./component/dialog-highlights"
import { claim } from "./util/highlights"
import { DialogThemeList } from "./component/dialog-theme-list"
import { DialogHelp } from "./ui/dialog-help"
import { DialogAgent } from "./component/dialog-agent"
import { DialogCustomizations } from "./component/dialog-customizations"
import { DialogAutoCustomizations } from "./component/dialog-auto-customizations"
import { DialogSessionList } from "./component/dialog-session-list"
import { DialogOpen, DialogOpenKey, moveOpenSession } from "./component/dialog-open"
import { SessionTabs } from "./component/session-tabs"
import { clampSessionTabsWidth, sessionTabsFitVertically, SESSION_SIDEBAR_WIDTH } from "./ui/layout"
import { createPaneResize } from "./ui/pane-resize"
import { PaneResizeHandle } from "./ui/pane-resize-handle"
import { clickedLink } from "./ui/link"
import { ThemeErrorToast } from "./component/theme-error-toast"
import { createThemeSource, ThemeProvider, useTheme, useThemes } from "./context/theme"
import { Home } from "./routes/home"
import { PromptHistoryProvider } from "./prompt/history"
import { FrecencyProvider } from "./prompt/frecency"
import { PromptStashProvider } from "./prompt/stash"
import { Toast, ToastProvider, useToast } from "./ui/toast"
import { isFallbackTitle } from "@opencode/util/session-title-fallback"
import * as Model from "./util/model"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import { openUrl } from "@opencode/util/open"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { Config, ConfigProvider, useConfig } from "./config"
import { newSessionLocation } from "./config/new-session-location"
import { UpdateNotificationProvider, useUpdateNotification, type UpdateSource } from "./context/update-notification"
import { PluginProvider, usePlugin, type PackageSource } from "./plugin/context"
import { localPluginDirectories } from "./plugin/discovery"
import { PluginRoute, Slot } from "./plugin/render"
import { CommandPaletteDialog } from "./component/command-palette"
import { COMMAND_PALETTE_COMMAND, Keymap, type KeymapCommand } from "./context/keymap"

import { DialogVariant } from "./component/dialog-variant"
import { DialogFusionModels } from "./component/dialog-fusion-models"
import { DialogOmniUpdate } from "./component/dialog-omni-update"
import { DialogMemoryBank } from "./component/dialog-memory-bank"
import { ReviewBarSignals } from "./component/prompt/review-bar"
import { destroyRenderer, setTerminalTitle } from "./util/renderer"
import { cliErrorMessage, errorFormat } from "./util/error"
import { AttentionProvider } from "./context/attention"
import { StorageProvider, useStorage } from "./context/storage"
import { SessionTerminalsProvider } from "./context/session-terminals"
import { ClientMcp } from "./context/client-mcp"
import { PanelProvider, usePanel } from "./context/panel"
import { SessionFrame } from "./component/session-frame"
import { createTuiClipboard } from "./clipboard"

const appGlobalBindingCommands = ["session.list", "session.new", "open.menu"] as const

const sessionTabBindingCommands = [
  "session.tab.next",
  "session.tab.previous",
  "session.tab.next_unread",
  "session.tab.previous_unread",
  "session.tab.close",
  "session.tab.reopen",
  "session.tab.select.1",
  "session.tab.select.2",
  "session.tab.select.3",
  "session.tab.select.4",
  "session.tab.select.5",
  "session.tab.select.6",
  "session.tab.select.7",
  "session.tab.select.8",
  "session.tab.select.9",
  "session.tab.select.10",
] as const

const pinnedSessionBindingCommands = [
  "session.quick_switch.1",
  "session.quick_switch.2",
  "session.quick_switch.3",
  "session.quick_switch.4",
  "session.quick_switch.5",
  "session.quick_switch.6",
  "session.quick_switch.7",
  "session.quick_switch.8",
  "session.quick_switch.9",
] as const

const appBindingCommands = [
  "command.palette.show",
  "model.list",
  "model.cycle_recent",
  "model.cycle_recent_reverse",
  "model.cycle_favorite",
  "model.cycle_favorite_reverse",
  "agent.list",
  "mcp.list",
  "usage.show",
  "agent.cycle",
  "agent.cycle.reverse",
  "variant.cycle",
  "variant.list",
  "provider.connect",
  "opencode.settings",
  "opencode.status",
  "opencode.update",
  "server.pair",
  "service.restart",
  "location.reload",
  "opencode.debug",
  "theme.switch",
  "theme.switch_mode",
  "theme.mode.lock",
  "help.show",
  "docs.open",
  "diff.open",
  "app.debug",
  "app.console",
  "terminal.suspend",
  "terminal.title.toggle",
  "app.toggle.animations",
  "app.toggle.file_context",
  "app.toggle.diffwrap",
  "app.toggle.paste_summary",
] as const

export type TuiInput = {
  app: TuiApp
  server: {
    endpoint: Endpoint
    local?: boolean
    service?: {
      reconnect: (signal: AbortSignal) => Promise<Endpoint>
      restart: () => Promise<void>
    }
  }
  args: Args
  config: Config.Interface
  updater?: UpdateSource
  packages: PackageSource
  environment?: Readonly<Record<string, string>>
  terminalHandoff?: () => Promise<
    | {
        readonly renderer: CliRenderer
        readonly mode: ThemeMode | null
        readonly complete: () => void
      }
    | undefined
  >
  log?: LogSink
}

export const run = Effect.fn("Tui.run")(function* (input: TuiInput) {
  const log = input.log ?? (() => {})
  const global = yield* Global.Service
  const config = Config.resolve(yield* Effect.tryPromise(() => input.config.get()), {
    terminalSuspend: process.platform !== "win32",
  })
  const headers = Service.headers(input.server.endpoint)
  const options = {
    baseUrl: input.server.endpoint.url,
    headers,
    fetch: noTimeoutFetch,
  }
  const api = OpenCode.make(options)
  const location = yield* Effect.tryPromise(() => api.file.list({ location: { directory: process.cwd() } })).pipe(
    Effect.map((response) => response.location),
    Effect.catch(() => Effect.tryPromise(() => api.location.get())),
  )
  const directory = location.directory
  const pluginDirectories = yield* Effect.promise(() => localPluginDirectories(process.cwd(), global.config))
  const handoff = input.terminalHandoff ? yield* Effect.promise(input.terminalHandoff) : undefined
  const managed = input.server.service
  const service = managed
    ? {
        reconnect: async (signal: AbortSignal) => {
          const endpoint = await managed.reconnect(signal)
          const next = { baseUrl: endpoint.url, headers: Service.headers(endpoint), fetch: noTimeoutFetch }
          return { api: OpenCode.make(next), url: endpoint.url, headers: next.headers }
        },
        restart: managed.restart,
      }
    : undefined
  const exit = {
    session: undefined as SessionEpilogue | undefined,
    updatedVersion: undefined as string | undefined,
    reason: undefined as unknown,
  }
  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      const options = {
        externalOutputMode: "passthrough",
        targetFps: 60,
        gatherStats: false,
        exitOnCtrlC: false,
        useKittyKeyboard: {},
        autoFocus: false,
        openConsoleOnError: false,
        useMouse: config.mouse,
        consoleOptions: {
          keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
        },
      } satisfies CliRendererConfig
      const renderer = yield* Effect.gen(function* () {
        if (handoff) {
          handoff.renderer.useMouse = options.useMouse
          return yield* Effect.acquireRelease(Effect.succeed(handoff.renderer), (renderer) =>
            Effect.promise(async () => {
              destroyRenderer(renderer)
              // closed rejects when the terminal is gone or the final flush times out; nothing is left to restore.
              await renderer.closed.catch(() => {})
            }),
          )
        }
        if (process.env.OPENCODE_DRIVE) {
          const { Drive } = yield* Effect.promise(() => import("@opencode/simulation/frontend"))
          return yield* Drive.create(options, input.app.version)
        }
        return yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => createCliRenderer(options),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }),
          (renderer) =>
            Effect.promise(async () => {
              destroyRenderer(renderer)
              await renderer.closed.catch(() => {})
            }),
        )
      })
      renderer.setMaxListeners(15)
      const clipboard = yield* Effect.acquireRelease(
        Effect.sync(() => createTuiClipboard(renderer)),
        (clipboard) =>
          Effect.tryPromise(() => clipboard.dispose()).pipe(
            Effect.catch((error) => Effect.sync(() => log("error", "Failed to dispose TUI clipboard", { error }))),
          ),
      )
      const finalizers = new Set<() => Promise<void>>()
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          const results = await Promise.allSettled([...finalizers].reverse().map((finalizer) => finalizer()))
          results
            .filter((result): result is PromiseRejectedResult => result.status === "rejected")
            .forEach((result) => log("error", "Failed to dispose TUI resource", { error: result.reason }))
        }),
      )
      const shutdown = yield* Latch.make()
      const onSighup = () => destroyRenderer(renderer)
      yield* Effect.acquireRelease(
        Effect.sync(() => process.on("SIGHUP", onSighup)),
        () => Effect.sync(() => process.off("SIGHUP", onSighup)),
      )
      renderer.once("destroy", () => shutdown.openUnsafe())
      yield* Effect.tryPromise(async () => {
        const mode = handoff?.mode ?? (await renderer.waitForThemeMode(1000)) ?? "dark"
        if (renderer.isDestroyed) return

        await render(() => {
          return (
            <LogProvider log={log}>
              <ExitProvider
                exit={(reason) => {
                  if (renderer.isDestroyed) return
                  exit.reason = reason
                  destroyRenderer(renderer)
                }}
              >
                <EpilogueProvider
                  value={{
                    session: (value) => (exit.session = value),
                    updatedVersion: (version) => (exit.updatedVersion = version),
                  }}
                >
                  <TuiAppProvider value={input.app}>
                    <ErrorBoundary
                      fallback={(error, reset) => (
                        <ClipboardProvider value={clipboard}>
                          <ErrorComponent error={error} reset={reset} mode={mode} />
                        </ClipboardProvider>
                      )}
                    >
                      <TuiPathsProvider
                        value={{
                          cwd: process.cwd(),
                          home: global.home,
                          state: global.state,
                          worktree: global.data + "/worktree",
                        }}
                      >
                        <StorageProvider>
                          <TuiLifecycleProvider
                            value={{
                              add(finalizer) {
                                finalizers.add(finalizer)
                                return () => finalizers.delete(finalizer)
                              },
                            }}
                          >
                            <TuiTerminalEnvironmentProvider
                              value={{
                                platform: process.platform,
                                variables: input.environment,
                                localServer: input.server.local,
                              }}
                            >
                              <TuiStartupProvider
                                value={{
                                  initialRoute: process.env.OPENCODE_STORY
                                    ? {
                                        type: "plugin",
                                        id: "opencode.storybook",
                                        name: "storybook",
                                        // OPENCODE_STORY=1 opens the index; any other value opens that story.
                                        data:
                                          process.env.OPENCODE_STORY === "1"
                                            ? undefined
                                            : { story: process.env.OPENCODE_STORY },
                                      }
                                    : process.env.OPENCODE_ROUTE
                                      ? JSON.parse(process.env.OPENCODE_ROUTE)
                                      : undefined,
                                  skipInitialLoading: Boolean(process.env.OPENCODE_FAST_BOOT),
                                }}
                              >
                                <ClipboardProvider value={clipboard}>
                                  <ArgsProvider {...input.args}>
                                    <ConfigProvider
                                      config={config}
                                      service={input.config}
                                      options={{ terminalSuspend: process.platform !== "win32" }}
                                    >
                                      <Keymap.Provider>
                                        <ToastProvider>
                                          <RouteProvider
                                            initialRoute={
                                              input.args.continue
                                                ? {
                                                    type: "session",
                                                    sessionID: "dummy",
                                                  }
                                                : undefined
                                            }
                                          >
                                            <ClientProvider
                                              api={api}
                                              url={input.server.endpoint.url}
                                              headers={headers}
                                              service={service}
                                            >
                                              <PermissionProvider>
                                                <DataProvider directory={directory}>
                                                  <LocationProvider>
                                                    <SessionTabsProvider>
                                                      <SessionTerminalsProvider>
                                                        <ThemeProvider
                                                          mode={mode}
                                                          source={createThemeSource(global.config)}
                                                        >
                                                          <ThemeErrorToast />
                                                          <ClientMcp />
                                                          <LocalProvider>
                                                            <PromptStashProvider>
                                                              <DialogProvider>
                                                                <FrecencyProvider>
                                                                  <PromptHistoryProvider>
                                                                    <PromptRefProvider>
                                                                      <EditorContextProvider>
                                                                        <AttentionProvider>
                                                                          <UpdateNotificationProvider
                                                                            updater={input.updater}
                                                                          >
                                                                            <PanelProvider>
                                                                              <PluginProvider
                                                                                packages={input.packages}
                                                                                directories={pluginDirectories}
                                                                              >
                                                                                <App />
                                                                              </PluginProvider>
                                                                            </PanelProvider>
                                                                          </UpdateNotificationProvider>
                                                                        </AttentionProvider>
                                                                      </EditorContextProvider>
                                                                    </PromptRefProvider>
                                                                  </PromptHistoryProvider>
                                                                </FrecencyProvider>
                                                              </DialogProvider>
                                                            </PromptStashProvider>
                                                          </LocalProvider>
                                                        </ThemeProvider>
                                                      </SessionTerminalsProvider>
                                                    </SessionTabsProvider>
                                                  </LocationProvider>
                                                </DataProvider>
                                              </PermissionProvider>
                                            </ClientProvider>
                                          </RouteProvider>
                                        </ToastProvider>
                                      </Keymap.Provider>
                                    </ConfigProvider>
                                  </ArgsProvider>
                                </ClipboardProvider>
                              </TuiStartupProvider>
                            </TuiTerminalEnvironmentProvider>
                          </TuiLifecycleProvider>
                        </StorageProvider>
                      </TuiPathsProvider>
                    </ErrorBoundary>
                  </TuiAppProvider>
                </EpilogueProvider>
              </ExitProvider>
            </LogProvider>
          )
        }, renderer)
        if (handoff) {
          renderer.once(CliRenderEvents.FRAME, handoff.complete)
          renderer.requestRender()
        }
      })
      yield* shutdown.await
      return { session: exit.session, updatedVersion: exit.updatedVersion, reason: exit.reason }
    }),
  )
  yield* Effect.sync(() => {
    if (result.reason !== undefined)
      process.stderr.write((cliErrorMessage(result.reason) ?? errorFormat(result.reason)) + "\n")
    const text = epilogue({ session: result.session, updatedVersion: result.updatedVersion })
    if (text) process.stdout.write(text + "\n")
  })
})

function App() {
  const app = useTuiApp()
  const startup = useTuiStartup()
  const config = useConfig()
  const devtools = createMemo(() => config.data.debug?.devtools ?? app.channel === "local")
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const dialog = useDialog()
  const local = useLocal()
  const sessionTabs = useSessionTabs()
  const panels = usePanel()
  const keymap = Keymap.use()
  const event = useEvent()
  const client = useClient()
  const toast = useToast()
  const updater = useUpdateNotification()
  const theme = useTheme()
  const { mode, supports, setMode, locked, lock, unlock, afterPaint } = useThemes()
  const data = useData()
  const location = useLocation()
  const exit = useExit()
  const promptRef = usePromptRef()
  const plugins = usePlugin()
  const clipboard = useClipboard()
  const terminalEnvironment = useTuiTerminalEnvironment()
  let paletteTimer: ReturnType<typeof setTimeout> | undefined
  const afterFrame = () => {
    // The native writer can still be flushing the frame when FRAME fires. Keep OSC probes behind visible app output.
    paletteTimer = setTimeout(afterPaint, 50)
  }
  onMount(() => renderer.once(CliRenderEvents.FRAME, afterFrame))
  onCleanup(() => {
    renderer.off(CliRenderEvents.FRAME, afterFrame)
    if (paletteTimer) clearTimeout(paletteTimer)
  })
  createEffect(() => {
    if (client.connection.status() !== "connected") return
    if (route.data.type !== "session") return
    const session = data.session.get(route.data.sessionID)
    if (!session) return
    if (data.session.creating(session.id)) return
    if (terminalEnvironment.variables === undefined) return
    void client.api.session
      .environment({ sessionID: session.id, variables: terminalEnvironment.variables })
      .catch(toast.error)
  })
  const [layout, updateLayout] = useStorage().store<{ verticalTabsWidth?: number }>("layout", {
    initial: { verticalTabsWidth: SESSION_SIDEBAR_WIDTH },
  })
  const tabsResize = createPaneResize({
    value: () => layout.verticalTabsWidth ?? SESSION_SIDEBAR_WIDTH,
    defaultValue: () => SESSION_SIDEBAR_WIDTH,
    clamp: (width) => clampSessionTabsWidth(width, dimensions().width),
    fromMouse: (event) => event.x + 1,
    contains: (event, width) => event.x >= width - 1 && event.x <= width,
    onCommit: (width) => {
      void updateLayout((draft) => {
        draft.verticalTabsWidth = width
      }).catch((error) => console.error("Failed to persist TUI layout", error))
    },
  })
  const [openSessions, setOpenSessions] = createSignal<SessionInfo[]>([])
  // Toast once when an MCP server enters a failed or needs-auth state so the user knows to act,
  // without having to open the status panel. Tracking the last alerted status avoids re-toasting
  // the same problem on every refresh while still re-alerting if the state changes.
  const mcpAlerted: Record<string, string> = {}
  createEffect(() => {
    for (const server of data.location.mcp.server.list() ?? []) {
      const status = server.status
      if (status.status !== "failed" && status.status !== "needs_auth") {
        delete mcpAlerted[server.name]
        continue
      }
      if (mcpAlerted[server.name] === status.status) continue
      mcpAlerted[server.name] = status.status
      if (status.status === "needs_auth")
        toast.show({
          variant: "warning",
          title: "MCP server needs authentication",
          message: `Connect "${server.name}" to use its tools.`,
          action: { label: "Open MCP servers", run: () => keymap.dispatch("mcp.list") },
        })
      else
        toast.show({
          variant: "error",
          title: `MCP server failed: ${server.name}`,
          message: "Run /mcps to view details.",
          action: { label: "Open MCP servers", run: () => keymap.dispatch("mcp.list") },
        })
    }
  })

  const copyOnSelectEnabled = () =>
    (config.data.terminal?.copy ?? (process.platform === "win32" ? "manual" : "select")) === "select"

  // Selection copy/dismiss must precede both app bindings and the terminal pane's raw key forwarding.
  const offSelectionKeys = keymap.intercept(
    "key",
    ({ event }) => {
      Selection.handleSelectionKey(renderer, toast, event, clipboard, copyOnSelectEnabled())
    },
    { priority: 101 },
  )
  onCleanup(() => {
    offSelectionKeys()
  })

  // Wire up console copy-to-clipboard via opentui's onCopySelection callback
  renderer.console.onCopySelection = async (text: string) => {
    if (!text || text.length === 0) return

    await clipboard
      .write(text)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)

    renderer.clearSelection()
  }
  const terminalTitleEnabled = () => config.data.terminal?.title ?? true
  const pasteSummaryEnabled = () => config.data.prompt?.paste !== "full"
  const tabsVertical = () =>
    config.data.tabs.layout === "vertical" && sessionTabsFitVertically(dimensions().width, tabsResize.size())
  const tabsAvailable = () => sessionTabs.enabled() && sessionTabs.tabs().length > 0 && route.data.type !== "plugin"
  const fullscreenPanel = () =>
    route.data.type === "session" &&
    panels.current()?.sessionID === route.data.sessionID &&
    panels.presentation() === "fullscreen"
  const tabsVisible = () => tabsAvailable() && !fullscreenPanel()
  const verticalTabsVisible = () => tabsVisible() && tabsVertical()

  // Measure the prospective split layout, even while full-screen hides the tabs.
  createEffect(() => panels.setWidth(dimensions().width - (tabsAvailable() && tabsVertical() ? tabsResize.size() : 0)))
  createEffect(() => {
    const current = panels.current()
    if (!current || (route.data.type === "session" && route.data.sessionID === current.sessionID)) return
    panels.close()
  })

  createEffect(() => {
    renderer.useMouse = config.data.mouse
  })

  let active: { id: string; title?: string } | undefined
  // Update terminal window title based on current route and session
  createEffect(() => {
    const session = route.data.type === "session" ? data.session.get(route.data.sessionID) : undefined
    if (session) active = { id: session.id, title: session.title }
    if (!terminalTitleEnabled()) return

    if (route.data.type === "home") {
      setTerminalTitle(renderer, "OnethyCode")
      return
    }

    if (route.data.type === "session") {
      const title = session?.title
      if (!title || isFallbackTitle(title)) {
        setTerminalTitle(renderer, "OnethyCode")
        return
      }

      setTerminalTitle(renderer, `OTC | ${title.length > 40 ? title.slice(0, 37) + "…" : title}`)
      return
    }

    if (route.data.type === "plugin") {
      setTerminalTitle(renderer, `OC | ${route.data.name}`)
    }
  })

  const args = useArgs()
  const startupPrompt = args.prompt ? { text: args.prompt, files: [], agents: [], pasted: [] } : undefined
  onMount(() => {
    batch(() => {
      if (args.agent) local.agent.set(args.agent)
      if (args.model) {
        const { providerID, modelID } = Model.parse(args.model)
        if (!providerID || !modelID)
          return toast.show({
            variant: "warning",
            message: `Invalid model format: ${args.model}`,
            duration: 3000,
          })
        local.model.set({ providerID, modelID }, { recent: true })
      }
      if (args.sessionID && !args.fork) {
        route.navigate({
          type: "session",
          sessionID: args.sessionID,
          prompt: startupPrompt,
        })
      }
    })
  })

  let continued = false
  createEffect(() => {
    if (continued || !args.continue) return
    continued = true
    const location = data.location.default()
    void client.api.session
      .list({
        limit: 1,
        order: "desc",
        parentID: null,
        directory: location.directory,
      })
      .then((response) => {
        const match = response.data[0]?.id
        if (!match) return
        if (!args.fork) {
          route.navigate({ type: "session", sessionID: match, prompt: startupPrompt })
          return
        }
        void client.api.session
          .fork({ sessionID: match })
          .then((result) => route.navigate({ type: "session", sessionID: result.id, prompt: startupPrompt }))
          .catch(toast.error)
      })
      .catch(toast.error)
  })

  // Handle --session with --fork once.
  let forked = false
  createEffect(() => {
    if (forked || !args.sessionID || !args.fork) return
    forked = true
    void client.api.session
      .fork({ sessionID: args.sessionID })
      .then((result) => route.navigate({ type: "session", sessionID: result.id, prompt: startupPrompt }))
      .catch(toast.error)
  })

  // Opens the release highlights once after an update, but only into an idle home screen during startup.
  const storage = useStorage()
  const paths = useTuiPaths()
  let highlighted = false
  createEffect(() => {
    if (highlighted || !plugins.ready() || client.connection.status() !== "connected") return
    highlighted = true
    const items = app.highlights ?? []
    if (config.data.highlights === false) return
    if (route.data.type !== "home" || dialog.stack.length > 0 || promptRef.current?.current.text) return
    if (args.prompt || args.continue || args.sessionID || args.newSessionID) return
    if (process.env.OPENCODE_DRIVE || process.env.OPENCODE_STORY || process.env.OPENCODE_ROUTE) return
    void claim(storage, {
      version: app.version,
      count: items.length,
      history: existsSync(path.join(paths.state, "prompt-history.jsonl")),
    })
      .then((show) => {
        if (show && dialog.stack.length === 0)
          dialog.replace(() => <DialogHighlights version={app.version} items={items} />)
      })
      .catch(toast.error)
  })

  const connected = useConnected()
  const appCommands = createMemo(() =>
    [
      {
        name: COMMAND_PALETTE_COMMAND,
        title: "Abrir paleta de comandos",
        category: "System",
        palette: undefined,
        run: () => {
          dialog.replace(() => <CommandPaletteDialog />)
        },
      },
      {
        name: "session.list",
        title: "Alternar sessão",
        category: "Session",
        suggested: data.session.list().length > 0,
        slash: { name: "sessions", aliases: ["resume", "continue"] },
        run: () => {
          dialog.replace(() => <DialogSessionList />)
        },
      },
      {
        name: "session.new",
        title: "Nova sessão",
        suggested: route.data.type === "session",
        category: "Session",
        slash: { name: "new" },
        run: () => {
          const model = local.model.current()
          const agent = local.agent.current()
          const current =
            route.data.type === "session"
              ? (data.session.get(route.data.sessionID)?.location ?? location.ref)
              : undefined
          route.navigate({
            type: "home",
            location: newSessionLocation(
              config.data.session.new_location,
              data.location.default().directory,
              current,
              location.error?.location,
            ),
          })
          if (agent) local.agent.set(agent.id)
          if (model) local.model.set(model)
          dialog.clear()
        },
      },
      {
        name: "session.clear",
        title: "Limpar sessão",
        category: "Session",
        slash: { name: "clear" },
        run: () => {
          const model = local.model.current()
          const agent = local.agent.current()
          const current =
            route.data.type === "session"
              ? (data.session.get(route.data.sessionID)?.location ?? location.ref)
              : undefined
          sessionTabs.close()
          route.navigate({
            type: "home",
            location: newSessionLocation(
              config.data.session.new_location,
              data.location.default().directory,
              current,
              location.error?.location,
            ),
          })
          if (agent) local.agent.set(agent.id)
          if (model) local.model.set(model)
          dialog.clear()
        },
      },
      {
        name: "open.menu",
        title: "Abrir sessão ou projeto",
        category: "Session",
        slash: { name: "open", aliases: ["projects", "project"] },
        run: () => {
          if (dialog.key === DialogOpenKey) return
          dialog.replace(() => <DialogOpen sessions={openSessions()} onLoad={setOpenSessions} />, undefined, {
            key: DialogOpenKey,
            size: "large",
          })
        },
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        name: `session.quick_switch.${i + 1}`,
        title: `Switch to session in quick slot ${i + 1}`,
        category: "Session",
        palette: undefined,
        enabled: () => !sessionTabs.enabled(),
        run: () => local.session.quickSwitch(i + 1),
      })),
      {
        name: "session.tab.next",
        title: "Próxima aba",
        category: "Session",
        palette: undefined,
        enabled: sessionTabs.enabled,
        run: () => sessionTabs.cycle(1),
      },
      {
        name: "session.tab.previous",
        title: "Aba anterior",
        category: "Session",
        palette: undefined,
        enabled: sessionTabs.enabled,
        run: () => sessionTabs.cycle(-1),
      },
      {
        name: "session.tab.next_unread",
        title: "Next unread tab",
        category: "Session",
        palette: undefined,
        enabled: sessionTabs.enabled,
        run: () => sessionTabs.cycleUnread(1),
      },
      {
        name: "session.tab.previous_unread",
        title: "Previous unread tab",
        category: "Session",
        palette: undefined,
        enabled: sessionTabs.enabled,
        run: () => sessionTabs.cycleUnread(-1),
      },
      {
        name: "session.tab.close",
        title: "Fechar aba",
        category: "Session",
        enabled: sessionTabs.enabled,
        run: () => sessionTabs.close(),
      },
      {
        name: "session.tab.reopen",
        title: "Reopen closed tab",
        category: "Session",
        enabled: sessionTabs.enabled,
        run: () => sessionTabs.reopen(),
      },
      ...Array.from({ length: 10 }, (_, i) => ({
        name: `session.tab.select.${i + 1}`,
        title: `Switch to tab ${i + 1}`,
        category: "Session",
        palette: undefined,
        enabled: sessionTabs.enabled,
        run: () => sessionTabs.selectIndex(i),
      })),
      {
        name: "model.list",
        title: "Alternar modelo de IA",
        suggested: true,
        category: "Agent",
        slash: { name: "models" },
        run: () => {
          dialog.replace(() => <DialogModel />)
        },
      },
      {
        name: "model.cycle_recent",
        title: "Model cycle",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.model.cycle(1)
        },
      },
      {
        name: "model.cycle_recent_reverse",
        title: "Model cycle reverse",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.model.cycle(-1)
        },
      },
      {
        name: "model.cycle_favorite",
        title: "Favorite cycle",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.model.cycleFavorite(1)
        },
      },
      {
        name: "model.cycle_favorite_reverse",
        title: "Favorite cycle reverse",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.model.cycleFavorite(-1)
        },
      },
      ...((process.env.ONETHY_ACTIVE === "1" || process.env.OMNICODE_ACTIVE === "1")
        ? [
            {
              name: "omnicode.orchestrator",
              title: "OnethyCode Orchestrator (Multi-Agent)",
              category: "OnethyCode",
              suggested: true,
              slash: { name: "orchestrator", aliases: ["omni", "orquestrador"] },
              run: () => {
                local.agent.set("omni")
                dialog.clear()
                toast.show({ variant: "info", message: "OnethyCode Orchestrator ativo (@omni / @orchestrator)" })
              },
            },
            {
              name: "omnicode.plan",
              title: "OnethyCode Plan Mode",
              category: "OnethyCode",
              slash: { name: "plan", aliases: ["planejar"] },
              run: () => {
                local.agent.set("plan")
                dialog.clear()
                toast.show({ variant: "info", message: "Modo de Planejamento ativo (@planner / @plan)" })
              },
            },
            {
              name: "omnicode.review",
              title: "OnethyCode Especialista Revisor (@reviewer)",
              category: "OnethyCode",
              slash: { name: "reviewer", aliases: ["revisar"] },
              run: () => {
                local.agent.set("reviewer")
                dialog.clear()
                toast.show({ variant: "info", message: "Especialista Revisor ativo (@reviewer)" })
              },
            },
            {
              name: "omnicode.architect",
              title: "OnethyCode Software Architect",
              category: "OnethyCode",
              slash: { name: "architect", aliases: ["arquiteto"] },
              run: () => {
                local.agent.set("architect")
                dialog.clear()
                toast.show({ variant: "info", message: "Especialista Arquiteto ativo (@architect)" })
              },
            },
            {
              name: "omnicode.coder",
              title: "OnethyCode Coder",
              category: "OnethyCode",
              slash: { name: "coder", aliases: ["dev"] },
              run: () => {
                local.agent.set("coder")
                dialog.clear()
                toast.show({ variant: "info", message: "Especialista Programador ativo (@coder)" })
              },
            },
            {
              name: "omnicode.librarian",
              title: "OnethyCode Especialista Bibliotecário (@librarian)",
              category: "OnethyCode",
              slash: { name: "librarian", aliases: ["bibliotecario"] },
              run: () => {
                local.agent.set("librarian")
                dialog.clear()
                toast.show({ variant: "info", message: "Especialista Bibliotecário ativo (@librarian)" })
              },
            },
            {
              name: "omnicode.customizations",
              title: "Central de Personalizações (Agentes, Skills, Plugins, Mods, Hooks, Comandos e MCPs)",
              category: "OnethyCode",
              suggested: true,
              slash: { name: "personalizacoes", aliases: ["customizations", "catalogo", "tudo"] },
              run: () => {
                dialog.replace(() => <DialogCustomizations filter="all" />)
              },
            },
            {
              name: "omnicode.skills",
              title: "Skills Instaladas e do Usuário (@skill)",
              category: "OnethyCode",
              slash: { name: "skills", aliases: ["habilidades"] },
              run: () => {
                dialog.replace(() => <DialogCustomizations filter="skills" />)
              },
            },
            {
              name: "omnicode.hooks",
              title: "Ganchos / Hooks Instalados e do Usuário",
              category: "OnethyCode",
              slash: { name: "hooks", aliases: ["ganchos"] },
              run: () => {
                dialog.replace(() => <DialogCustomizations filter="hooks" />)
              },
            },
            {
              name: "omnicode.mods",
              title: "Mods e Plugins Instalados e do Usuário",
              category: "OnethyCode",
              slash: { name: "mods", aliases: ["plugins"] },
              run: () => {
                dialog.replace(() => <DialogCustomizations filter="mods" />)
              },
            },
            {
              name: "omnicode.modes",
              title: "Settings, Presets e Modos Operacionais",
              category: "OnethyCode",
              slash: { name: "modes", aliases: ["modos", "presets"] },
              run: () => {
                dialog.replace(() => <DialogCustomizations filter="settings" />)
              },
            },
            {
              name: "omnicode.commands",
              title: "Comandos Slash e Loops Instalados (/)",
              category: "OnethyCode",
              slash: { name: "commands", aliases: ["comandos", "loops"] },
              run: () => {
                dialog.replace(() => <DialogCustomizations filter="commands" />)
              },
            },
            {
              name: "omnicode.auto_customizations",
              title: "Auto-Uso de Recursos (Skills, Agentes, MCPs, Hooks, Mods & Settings)",
              description: "Configura quais customizações a IA deve usar automaticamente de acordo com a tarefa",
              category: "OnethyCode",
              suggested: true,
              slash: { name: "auto-customizations", aliases: ["customizations-auto", "auto-skills", "auto-recursos"] },
              run: () => {
                dialog.replace(() => <DialogAutoCustomizations />)
              },
            },
            {
              name: "omnicode.auto_model",
              title: "Omni Fusion — Selecionar Variante (Modo Auto / Eficiência / Balanceado / Inteligente)",
              description: "Alterna tiers de inteligência e roteamento dinâmico entre modelos conectados",
              category: "OnethyCode",
              suggested: true,
              slash: { name: "auto", aliases: ["fusion", "omnfusion", "omnifusion", "otimizar", "optimize"] },
              run: () => {
                local.model.auto.enable()
                dialog.replace(() => <DialogVariant />)
              },
            },
            {
              name: "omnicode.fusion_models",
              title: "Omni Fusion — Configurar Modelos Permitidos (Marcar modelos ou Usar Todos)",
              description: "Abre checklist interativo para permitir ou restringir modelos no Omni Fusion",
              category: "OnethyCode",
              suggested: true,
              slash: { name: "fusion-models", aliases: ["modelos-fusion", "fusionmodels", "allowed-models"] },
              run: () => {
                local.model.auto.enable()
                dialog.replace(() => <DialogFusionModels />)
              },
            },
            {
              name: "omnicode.thinking_routing",
              title: "Omni Fusion — Roteamento Inteligente de Thinking (Ativar/Desativar)",
              description: "Ajusta tokens de raciocínio dinamicamente (low em buscas, max em arquitetura)",
              category: "OnethyCode",
              suggested: true,
              slash: { name: "thinking", aliases: ["thinking-routing", "raciocinio", "pensamento"] },
              run: () => {
                local.model.auto.toggleThinkingRouting()
              },
            },
            {
              name: "omnicode.keep",
              title: "ReviewBar — Manter / Confirmar Alterações (Keep)",
              description: "Confirma as alterações de arquivos realizadas pelo agente na sessão",
              category: "OnethyCode",
              suggested: true,
              slash: { name: "keep", aliases: ["manter", "confirmar", "aceitar"] },
              run: () => {
                ReviewBarSignals.dismiss(route.data.type === "session" ? route.data.sessionID : undefined)
              },
            },
            {
              name: "omnicode.cycle_tier",
              title: "Omni Fusion — Ciclar Modo de Otimização (Eficiência / Balanceado / Inteligente)",
              description: "Alterna rapidamente o perfil de seleção automática de modelos (Atalho: Alt+O)",
              category: "OnethyCode",
              suggested: true,
              slash: { name: "tier", aliases: ["cycle-tier", "modo", "perfil"] },
              run: () => {
                local.model.auto.cycleTier()
              },
            },
            {
              name: "omnicode.memory",
              title: "Memory Bank Persistente (.omnicode/memory-bank/)",
              description: "Abre painel visual com os arquivos de memória arquitetural do projeto",
              category: "OnethyCode",
              suggested: true,
              slash: { name: "memory", aliases: ["memory-bank", "lembrar", "memoria"] },
              run: () => {
                dialog.replace(() => <DialogMemoryBank />)
              },
            },
            {
              name: "omnicode.checkpoint",
              title: "Workspace Checkpoints (Salvar Snapshot Git)",
              description: "Salva snapshot do workspace para permitir time-travel e rollback",
              category: "OnethyCode",
              suggested: true,
              slash: { name: "checkpoint", aliases: ["checkpoints", "salvar-ponto"] },
              run: () => {
                toast.show({
                  variant: "info",
                  title: "💾 Checkpoints Git",
                  message: "Use a ferramenta omni_checkpoint ou rode /checkpoint-undo para restaurar o estado.",
                })
              },
            },
            {
              name: "omnicode.undo",
              title: "Time-Travel Checkpoint Undo (Reverter Workspace para Snapshot Anterior)",
              description: "Reverte alterações de código feitas pela IA para o snapshot git anterior",
              category: "OnethyCode",
              suggested: true,
              slash: { name: "checkpoint-undo", aliases: ["desfazer-checkpoint", "reverter-checkpoint", "git-undo"] },
              run: () => {
                toast.show({
                  variant: "warning",
                  title: "⏪ Time-Travel Undo",
                  message: "Revertendo arquivos modificados pela IA ao último snapshot git...",
                })
              },
            },
            {
              name: "omnicode.heal",
              title: "Self-Healing Test & Build Loop (Autocura Autônoma)",
              description: "Inicia loop autônomo de execução de testes, diagnóstico e correção de falhas",
              category: "OnethyCode",
              suggested: true,
              slash: { name: "heal", aliases: ["self-heal", "corrigir-loop", "autofix"] },
              run: () => {
                toast.show({
                  variant: "info",
                  title: "🔄 Self-Healing Loop",
                  message: "Executando testes e diagnosticando falhas para correção automática...",
                })
              },
            },
            {
              name: "omnicode.commit",
              title: "Auto-Commit Inteligente (Mensagens Convencionais do Git Diff)",
              description: "Analisa o git diff e gera mensagens de commit padronizadas",
              category: "OnethyCode",
              suggested: true,
              slash: { name: "commit", aliases: ["autocommit", "git-commit", "salvar"] },
              run: () => {
                toast.show({
                  variant: "info",
                  title: "🏷️ Auto-Commit Inteligente",
                  message: "Inspecionando diff e gerando commit convencional...",
                })
              },
            },
            {
              name: "omnicode.team",
              title: "Pipeline de Equipe Completa (Planner -> Architect -> Coder -> Reviewer)",
              description: "Dispara esquadrão autônomo de 4 fases para construir funcionalidades complexas",
              category: "OnethyCode",
              suggested: true,
              slash: { name: "team", aliases: ["equipe", "pipeline", "squad"] },
              run: () => {
                toast.show({
                  variant: "info",
                  title: "🎯 Pipeline de Equipe",
                  message: "Iniciando orquestração em 4 fases com entregas formais.",
                })
              },
            },
          ]
        : []),
      {
        name: "agent.list",
        title: "Alternar agente",
        category: "Agent",
        slash: { name: "agents", aliases: ["agent", "agentes"] },
        run: () => {
          dialog.replace(() => <DialogAgent />)
        },
      },
      {
        name: "usage.show",
        title: "Ver consumo e estatísticas",
        category: "Agent",
        slash: { name: "usage" },
        run: () => {
          dialog.replace(() => <DialogUsage />)
        },
      },
      {
        name: "mcp.list",
        title: "Servidores MCP",
        category: "Agent",
        slash: { name: "mcps" },
        run: () => {
          dialog.replace(() => <DialogMcp />)
        },
      },
      {
        name: "agent.cycle",
        title: "Agent cycle",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.agent.move(1)
        },
      },
      {
        name: "variant.cycle",
        title: "Variant cycle",
        category: "Agent",
        run: () => {
          local.model.variant.cycle()
        },
      },
      {
        name: "variant.list",
        title: "Switch model variant",
        category: "Agent",
        palette: local.model.variant.list().length === 0 ? undefined : (true as const),
        slash: { name: "variants", aliases: ["variant", "effort"] },
        run: () => {
          if (local.model.variant.list().length === 0) {
            return toast.show({
              title: "No variants available",
              message: "The current model does not support any variants.",
              variant: "info",
            })
          }
          dialog.replace(() => <DialogVariant />)
        },
      },
      {
        name: "agent.cycle.reverse",
        title: "Agent cycle reverse",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.agent.move(-1)
        },
      },
      {
        name: "provider.connect",
        title: "Conectar integração / provedor",
        suggested: !connected(),
        slash: { name: "connect" },
        run: () => {
          dialog.replace(() => (
            <DialogIntegration
              onConnected={(providerID) => dialog.replace(() => <DialogModel providerID={providerID} />)}
            />
          ))
        },
        category: "Integration",
      },
      ...(app.highlights?.length
        ? [
            {
              name: "opencode.highlights",
              title: "Show release highlights",
              slash: { name: "highlights" },
              run: () => dialog.replace(() => <DialogHighlights version={app.version} items={app.highlights ?? []} />),
              category: "System",
            },
          ]
        : []),
      {
        name: "opencode.settings",
        title: "Abrir configurações",
        suggested: true,
        slash: { name: "settings" },
        run: () => {
          dialog.replace(() => <DialogConfig />)
        },
        category: "System",
      },
      {
        name: "opencode.status",
        title: "Ver status do sistema",
        slash: { name: "status" },
        run: () => {
          dialog.replace(() => <DialogStatus />)
        },
        category: "System",
      },
      {
        name: "opencode.update",
        title: (process.env.ONETHY_ACTIVE === "1" || process.env.OMNICODE_ACTIVE === "1" || !updater.open)
          ? "Atualizar OnethyCode"
          : "Update OpenCode",
        description: "Verifica e instala atualizações do OnethyCode via GitHub",
        slash: { name: "update", aliases: ["atualizar", "upgrade"] },
        run: () => {
          if (process.env.ONETHY_ACTIVE === "1" || process.env.OMNICODE_ACTIVE === "1" || !updater.open) {
            dialog.replace(() => <DialogOmniUpdate />)
            return
          }
          updater.open("manual")
        },
        category: "System",
      },
      {
        name: "server.pair",
        title: "Pair device",
        slash: { name: "pair", aliases: ["web"] },
        run: () => {
          dialog.replace(() => <DialogPair />)
        },
        category: "System",
      },
      ...(client.restart
        ? [
            {
              name: "service.restart",
              title: "Reiniciar serviço",
              slash: { name: "restart" },
              run: async () => {
                const restart = client.restart
                if (!restart) return
                dialog.clear()
                toast.show({ variant: "info", message: "Restarting service…", duration: 30000 })
                // restart resolves once the replacement service is healthy; the
                // event stream reattaches through the reconnect loop.
                await restart()
                  .then(() => toast.show({ variant: "success", message: "Service restarted" }))
                  .catch(toast.error)
              },
              category: "System",
            },
          ]
        : []),
      {
        name: "location.reload",
        title: "Recarregar configurações",
        slash: { name: "reload" },
        run: async () => {
          dialog.clear()
          toast.show({ variant: "info", message: "Reloading configuration…", duration: 30000 })
          await client.api.location
            .reload()
            .then(() => {
              toast.show({ variant: "success", message: "Configuration reloaded" })
            })
            .catch(toast.error)
        },
        category: "System",
      },
      {
        name: "opencode.debug",
        title: "View debug info",
        slash: { name: "debug" },
        run: () => {
          dialog.replace(() => <DialogDebug />)
        },
        category: "System",
      },
      {
        name: "theme.switch",
        title: "Alternar tema (Themes)",
        slash: { name: "themes", aliases: ["theme", "tema", "temas"] },
        run: () => {
          dialog.replace(() => <DialogThemeList />)
        },
        category: "System",
      },
      {
        name: "theme.switch_mode",
        title: mode() === "dark" ? "Switch to light mode" : "Switch to dark mode",
        palette: undefined,
        enabled: () => supports(mode() === "dark" ? "light" : "dark"),
        run: () => {
          setMode(mode() === "dark" ? "light" : "dark")
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "theme.mode.lock",
        title: locked() ? "Unlock theme mode" : "Lock theme mode",
        palette: undefined,
        run: () => {
          if (locked()) unlock()
          else lock()
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "help.show",
        title: "Help",
        slash: { name: "help" },
        run: () => {
          dialog.replace(() => <DialogHelp />)
        },
        category: "System",
      },
      {
        name: "docs.open",
        title: "Open docs",
        run: () => {
          openUrl("https://opencode.ai/v2/docs").catch(() => {})
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "app.exit",
        title: "Exit the app",
        slash: { name: "exit", aliases: ["quit", "q"] },
        run: () => exit(),
        category: "System",
      },
      {
        name: "app.debug",
        title: "Toggle debug panel",
        category: "System",
        palette: undefined,
        run: () => {
          renderer.toggleDebugOverlay()
          dialog.clear()
        },
      },
      {
        name: "app.console",
        title: "Toggle console",
        category: "System",
        run: () => {
          renderer.console.toggle()
          dialog.clear()
        },
      },
      {
        name: "terminal.suspend",
        title: "Suspend terminal",
        category: "System",
        palette: undefined,
        enabled: process.platform !== "win32",
        run: async () => {
          await renderer.suspend()
          process.once("SIGCONT", () => renderer.resume())
          process.kill(0, "SIGTSTP")
        },
      },
      {
        name: "terminal.title.toggle",
        title: terminalTitleEnabled() ? "Disable terminal title" : "Enable terminal title",
        category: "System",
        palette: undefined,
        run: () => {
          const next = !terminalTitleEnabled()
          if (!next) setTerminalTitle(renderer, "")
          void config
            .update((draft) => {
              draft.terminal = { ...draft.terminal, title: next }
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "app.toggle.animations",
        title: (config.data.animations ?? true) ? "Disable animations" : "Enable animations",
        category: "System",
        palette: undefined,
        run: () => {
          void config
            .update((draft) => {
              draft.animations = !(config.data.animations ?? true)
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "app.toggle.file_context",
        title: (config.data.prompt?.editor ?? true) ? "Disable file context" : "Enable file context",
        category: "System",
        palette: undefined,
        run: () => {
          void config
            .update((draft) => {
              draft.prompt = { ...draft.prompt, editor: !(config.data.prompt?.editor ?? true) }
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "app.toggle.diffwrap",
        title: (config.data.diffs?.wrap ?? "word") === "word" ? "Disable diff wrapping" : "Enable diff wrapping",
        category: "System",
        palette: undefined,
        run: () => {
          void config
            .update((draft) => {
              draft.diffs = {
                ...draft.diffs,
                wrap: (config.data.diffs?.wrap ?? "word") === "word" ? "none" : "word",
              }
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "app.toggle.paste_summary",
        title: pasteSummaryEnabled() ? "Disable paste summary" : "Enable paste summary",
        category: "System",
        palette: undefined,
        run: () => {
          void config
            .update((draft) => {
              draft.prompt = { ...draft.prompt, paste: pasteSummaryEnabled() ? "full" : "compact" }
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
    ].map(
      ({ name, category, ...command }) =>
        ({
          id: name,
          group: category,
          bind: false,
          palette: true as const,
          ...command,
        }) satisfies KeymapCommand,
    ),
  )

  Keymap.createLayer(() => ({
    mode: "global",
    commands: appCommands(),
  }))

  Keymap.createLayer(() => ({
    bindings: appBindingCommands,
  }))

  Keymap.createLayer(() => ({
    mode: "global",
    bindings: appGlobalBindingCommands,
  }))

  Keymap.createLayer(() => ({
    mode: "global",
    enabled: sessionTabs.enabled,
    bindings: sessionTabBindingCommands,
  }))

  Keymap.createLayer(() => ({
    mode: "global",
    enabled: () => !sessionTabs.enabled(),
    bindings: pinnedSessionBindingCommands,
  }))

  Keymap.createLayer(() => ({
    enabled: () => {
      const current = promptRef.current
      if (!current?.focused) return true
      return current.current.text === ""
    },
    bindings: ["app.exit"],
  }))

  event.on("tui.command.execute", (evt, { directory }) => {
    if (directory !== (location.current?.directory ?? data.location.default().directory)) return
    keymap.dispatch(evt.data.command)
  })

  event.on("tui.toast.show", (evt, { directory }) => {
    if (directory !== (location.current?.directory ?? data.location.default().directory)) return
    toast.show({
      title: evt.data.title,
      message: evt.data.message,
      variant: evt.data.variant,
      duration: evt.data.duration,
    })
  })

  event.on("tui.session.select", (evt, { directory }) => {
    if (directory !== (location.current?.directory ?? data.location.default().directory)) return
    route.navigate({
      type: "session",
      sessionID: evt.data.sessionID,
    })
  })

  event.on("session.moved", (evt) => {
    setOpenSessions((sessions) =>
      sessions.map((session) => (session.id !== evt.data.sessionID ? session : moveOpenSession(session, evt))),
    )
  })

  event.on("session.deleted", (evt) => {
    setOpenSessions((sessions) => sessions.filter((session) => session.id !== evt.data.sessionID))
    if (route.data.type === "session" && route.data.sessionID === evt.data.sessionID) {
      const title = active?.id === evt.data.sessionID ? active.title : undefined
      route.navigate({ type: "home" })
      toast.show({
        variant: "info",
        message: title ? `Session "${title}" was deleted` : "The current session was deleted",
      })
    }
  })

  // Suppress the full-screen overlay for transient startup and event-stream retry states.
  // Initial connection gets a longer grace period; retries surface more quickly.
  const [showReconnecting, setShowReconnecting] = createSignal(false)
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    const status = client.connection.status()
    if (status === "connected") {
      setShowReconnecting(false)
      return
    }
    reconnectTimer = setTimeout(
      () => {
        reconnectTimer = undefined
        setShowReconnecting(true)
      },
      status === "reconnecting" ? 1000 : 5000,
    ).unref()
  })
  onCleanup(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background.base}
      onMouseDown={(evt) => {
        if (copyOnSelectEnabled()) return
        if (evt.button !== MouseButton.RIGHT) return

        if (!Selection.copy(renderer, toast, clipboard)) return
        evt.preventDefault()
        evt.stopPropagation()
      }}
      onMouseUp={(event) => {
        const url = clickedLink(renderer, event)
        if (url) return void openUrl(url).catch(toast.error)
        if (copyOnSelectEnabled()) Selection.copyOnSelectRelease(event, renderer, toast, clipboard)
      }}
    >
      <box
        flexGrow={1}
        minHeight={0}
        flexDirection="row"
        position="relative"
        onMouseDrag={tabsResize.onMouseDrag}
        onMouseDragEnd={tabsResize.onMouseDragEnd}
        onMouseUp={tabsResize.onMouseUp}
      >
        <Show when={verticalTabsVisible()}>
          <SessionTabs orientation="vertical" width={tabsResize.size()} />
        </Show>
        <box flexGrow={1} minWidth={0} flexDirection="column">
          <Show when={plugins.ready()}>
            <box flexGrow={1} minHeight={0} flexDirection="column">
              <Show when={tabsVisible() && !tabsVertical()}>
                <SessionTabs />
              </Show>
              <Switch>
                <Match when={route.data.type === "home"}>
                  <Home />
                </Match>
                <Match when={route.data.type === "session"}>
                  <Show when={route.data.type === "session" ? route.data.sessionID : undefined} keyed>
                    {(sessionID) => (
                      <SessionFrame
                        sessionID={sessionID}
                        verticalTabsWidth={verticalTabsVisible() ? tabsResize.size() : 0}
                      />
                    )}
                  </Show>
                </Match>
                <Match when={route.data.type === "plugin"}>
                  <PluginRoute
                    fallback={(id, name) => (
                      <PluginRouteMissing id={id} name={name} onHome={() => route.navigate({ type: "home" })} />
                    )}
                  />
                </Match>
              </Switch>
            </box>
            <Slot path="app" />
          </Show>
        </box>
        <Show when={verticalTabsVisible()}>
          <PaneResizeHandle resize={tabsResize} left={tabsResize.size() - 1} />
        </Show>
      </box>
      <Show when={devtools() && !(route.data.type === "plugin" && route.data.id === "opencode.stats")}>
        <DevToolsBar />
      </Show>
      <Show when={!startup.skipInitialLoading}>
        <StartupLoading ready={plugins.ready} />
      </Show>
      <Show when={showReconnecting()}>
        <Reconnecting managed={client.restart !== undefined} />
      </Show>
      <MigrationOverlay />
      <Toast />
    </box>
  )
}
