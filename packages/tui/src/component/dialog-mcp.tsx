import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js"
import { useData } from "../context/data"
import { useClient } from "../context/client"
import { pipe, sortBy } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { McpServer } from "@opencode/client"
import { useToast } from "../ui/toast"
import { DialogErrorDetails } from "./dialog-error-details"
import { mcpFailurePreview, mcpFailureHelp } from "../util/mcp-diagnostics"
import { DialogIntegration } from "./dialog-integration"
import { useLocation } from "../context/location"
import { Global } from "@opencode/util/global"
import { managedMcpList, manageMcp, type McpAction } from "../../../cli/src/services/mcp-manager"

function statusError(status: McpServer["status"]) {
  if (status.status === "failed" || status.status === "needs_auth") return status.error
  return undefined
}

function Status(props: { status: McpServer["status"]; loading: boolean }) {
  if (props.loading || props.status.status === "pending") {
    return <>Connecting …</>
  }
  if (props.status.status === "connected") {
    return <span style={{ attributes: TextAttributes.BOLD }}>Connected ✓</span>
  }
  if (props.status.status === "failed") {
    return <>Failed !</>
  }
  if (props.status.status === "needs_auth") {
    return <>Sign in required →</>
  }
  return <>Disabled ○</>
}

export function DialogMcp(props: { initialServer?: string; details?: boolean } = {}) {
  const data = useData()
  const dialog = useDialog()
  const client = useClient()
  const location = useLocation()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  onMount(() => {
    if (process.env.OMNICODE_ACTIVE === "1") dialog.setSize("large")
  })
  const current = () => location.ref ?? data.location.default()
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set())
  const servers = createMemo(() =>
    pipe(
      (data.location.mcp.server.list(current()) ?? []).filter((server) => !hidden().has(server.name)),
      sortBy((server) => server.name),
    ),
  )
  const initial = props.initialServer ? servers().find((server) => server.name === props.initialServer) : undefined
  const [focused, setFocused] = createSignal<string | undefined>(props.initialServer)
  const [detail, setDetail] = createSignal<McpServer | undefined>(
    props.details && initial?.status.status === "failed" ? initial : undefined,
  )
  const [loading, setLoading] = createSignal<ReadonlySet<string>>(new Set())
  const [saving, setSaving] = createSignal(false)

  const statusColor = (status: McpServer["status"]) => {
    if (status.status === "connected") return theme.text.feedback.success.base
    if (status.status === "failed") return theme.text.feedback.error.base
    if (status.status === "needs_auth") return theme.text.feedback.warning.base
    return theme.text.muted
  }

  createEffect(() => {
    if (focused()) return
    const first = servers()[0]
    if (first) setFocused(first.name)
  })

  const options = createMemo(() => {
    const loadingMcp = loading()
    return servers().map((server) => {
      const pending = loadingMcp.has(server.name) || server.status.status === "pending"
      return {
        value: server.name,
        title: server.name,
        footer: <Status status={server.status} loading={pending} />,
        footerColor: pending ? theme.text.muted : statusColor(server.status),
        detail: server.status.status === "failed" ? mcpFailurePreview(server.status.error) : undefined,
      }
    })
  })

  const focusedServer = createMemo(() => servers().find((server) => server.name === focused()))

  const toggleTitle = createMemo(() => {
    const status = focusedServer()?.status.status
    if (status === "connected") return "disconnect"
    if (status === "failed") return "retry"
    if (status === "needs_auth") return "sign in"
    return "connect"
  })

  const focusedError = createMemo(() => {
    const server = focusedServer()
    // Enter starts sign-in for auth-gated integrations instead of showing the auth reason
    if (server?.status.status === "needs_auth" && server.integrationID) return undefined
    return server ? statusError(server.status) : undefined
  })

  const select = (name: string | undefined) => {
    const server = servers().find((entry) => entry.name === name)
    if (!server) return
    if (server.status.status === "needs_auth" && server.integrationID) {
      dialog.replace(() => <DialogIntegration integrationID={server.integrationID} autoConnect />)
      return
    }
    if (!statusError(server.status)) return
    setDetail(server)
  }

  // Auth-gated servers enter the integration flow; other inactive states retry the connection.
  // The mcp.status.changed event refreshes the list, so no manual sync is needed.
  const toggle = (name: string) => {
    if (loading().has(name)) return
    const server = servers().find((entry) => entry.name === name)
    if (!server || server.status.status === "pending") return
    if (server.status.status === "needs_auth" && server.integrationID) {
      select(name)
      return
    }
    setLoading((prev) => new Set(prev).add(name))
    const target = current()
    const input = { server: name, location: { directory: target.directory } }
    const call = server.status.status === "connected" ? client.api.experimental.mcp.disconnect(input) : client.api.experimental.mcp.connect(input)
    void call.catch(toast.error).finally(() =>
      setLoading((prev) => {
        const next = new Set(prev)
        next.delete(name)
        return next
      }),
    )
  }

  // File-based management is OnethyCode-only and uses the same persistence layer
  // as the existing CLI commands. It never launches an MCP itself.
  const manage = async (action: McpAction, name: string) => {
    if (saving()) return
    if (current().workspaceID) {
      toast.show({ variant: "warning", message: "Local MCP management is unavailable in a remote workspace." })
      return
    }
    setSaving(true)
    try {
      const directory = current().directory
      const globalRoot = process.env.OPENCODE_CONFIG_DIR || Global.Path.config
      const entries = await managedMcpList(directory, globalRoot)
      const entry = entries.find((item) => item.name === name)
      const global = action === "restore" ? true
        : action === "remove" ? entry?.location === "global"
        : false // Enabled/disabled status is scoped to this workspace.
      const message = await manageMcp({ action, name, cwd: directory, globalRoot, global })
      if (action === "remove") {
        setHidden((before) => new Set([...before, name]))
        await client.api.experimental.mcp.remove({
          server: name, location: { directory },
        }).catch(() => undefined)
      } else if (action === "enable") {
        await client.api.experimental.mcp.connect({
          server: name, location: { directory },
        }).catch(toast.error)
      } else if (action === "disable") {
        await client.api.experimental.mcp.disconnect({
          server: name, location: { directory },
        }).catch(toast.error)
      } else {
        setHidden(new Set())
      }
      toast.show({ variant: "success", message })
      void data.location.mcp.server.sync(current()).catch(() => undefined)
    } catch (error) {
      toast.error(error)
    } finally {
      setSaving(false)
    }
  }

  const confirmManage = (action: "remove" | "restore", name: string) => {
    const title = action === "remove" ? `Delete ${name}?` : "Restore all 8 built-in MCPs?"
    dialog.push(() => (
      <DialogSelect
        title={title}
        description={action === "remove"
          ? "This MCP configuration will be permanently deleted. Other MCPs will be preserved."
          : "All 8 built-in MCP configurations will be reset and disabled."}
        options={[
          { value: "cancel", title: "Cancel", category: "Confirmation" },
          { value: "confirm", title: action === "remove" ? "Yes, delete" : "Yes, restore", category: "Confirmation" },
        ]}
        onSelect={(option) => {
          dialog.pop()
          if (option.value !== "confirm") return
          if (action === "remove") {
            void manage("remove", name)
          } else {
            void manage("restore", "all")
          }
        }}
      />
    ))
  }

  return (
    <box>
      <Show
        when={detail()}
        fallback={
          <DialogSelect
            title="MCP servers"
            searchInTitle
            titlePlaceholder="Search MCP servers"
            options={options()}
            preserveSelection
            onMove={(option) => setFocused(option.value as string)}
            onSelect={(option) => select(option.value as string)}
            actions={[
              {
                title: toggleTitle(),
                command: "dialog.mcp.toggle",
                onTrigger: (option) => {
                  setFocused(option.value as string)
                  toggle(option.value as string)
                },
              },
              ...(process.env.OMNICODE_ACTIVE === "1" ? [
                {
                  title: "enable",
                  command: "onethy.mcp.enable",
                  bind: "ctrl+e",
                  onTrigger: (option: { value: string }) => void manage("enable", option.value),
                },
                {
                  title: "disable",
                  command: "onethy.mcp.disable",
                  bind: "ctrl+d",
                  onTrigger: (option: { value: string }) => void manage("disable", option.value),
                },
                {
                  title: "delete",
                  command: "onethy.mcp.delete",
                  bind: "ctrl+x",
                  onTrigger: (option: { value: string }) => confirmManage("remove", option.value),
                },
                {
                  title: "restore all 8",
                  command: "onethy.mcp.restore",
                  bind: "ctrl+r",
                  selection: "none" as const,
                  onTrigger: () => confirmManage("restore", "all"),
                },
              ] : []),
            ]}
            footerHints={focusedError() ? [{ title: "view error", label: "enter", group: "primary" }] : []}
          />
        }
      >
        {(server) => (
          <DialogErrorDetails
            title={`MCP server: ${server().name}`}
            error={server().status.status === "failed"
              ? `${mcpFailureHelp(server().status.error)}\n\n${server().status.error}`
              : statusError(server().status) ?? "Unknown MCP connection error"}
            context={`Status: ${server().status.status}\nConfiguration: mcp.servers.${server().name}${
              server().integrationID ? `\nIntegration: ${server().integrationID}` : ""
            }`}
            onBack={() => {
              setDetail(undefined)
              dialog.setSize(process.env.OMNICODE_ACTIVE === "1" ? "large" : "medium")
            }}
          />
        )}
      </Show>
    </box>
  )
}
