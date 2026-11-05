import { createSignal } from "solid-js"
import { spawn } from "node:child_process"
import { buildDesktopInvocation, runAgentDesktop } from "@opencode/core/agent-desktop"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"

const PACKAGE = "agent-desktop@1.2.0"

/** OnethyCode's native, English-language desktop integration manager. */
export function DialogDesktop() {
  const dialog = useDialog()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)

  const inspect = (action: "status" | "permissions") => {
    if (busy()) return
    setBusy(true)
    void runAgentDesktop(buildDesktopInvocation({ action }))
      .then((result) => {
        const details = JSON.stringify(result.data ?? result).slice(0, 900)
        dialog.push(() => (
          <DialogSelect
            title={action === "status" ? "Agent Desktop — Runtime status" : "Agent Desktop — OS permissions"}
            description={details}
            skipFilter
            options={[{ value: "back", title: "Back", onSelect: () => dialog.pop() }]}
          />
        ))
      })
      .catch((error) => toast.show({
        variant: "error",
        title: "Agent Desktop unavailable",
        message: String(error).slice(0, 900),
      }))
      .finally(() => setBusy(false))
  }

  const install = () => {
    if (busy()) return
    // Only a direct TUI confirmation starts installation; never from an agent call.
    setBusy(true)
    const windows = process.platform === "win32"
    const executable = windows ? "cmd.exe" : "npm"
    const args = windows
      ? ["/d", "/s", "/c", "npm install -g " + PACKAGE]
      : ["install", "-g", PACKAGE]
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let log = ""
    let done = false
    const record = (chunk: string) => { log = (log + chunk).slice(-1400) }
    child.stdout.setEncoding("utf8").on("data", record)
    child.stderr.setEncoding("utf8").on("data", record)
    const finish = (error?: string) => {
      if (done) return
      done = true
      clearTimeout(timer)
      setBusy(false)
      toast.show({
        variant: error ? "error" : "success",
        title: error ? "Agent Desktop installation failed" : "Agent Desktop installed",
        message: error ?? "Native runtime installed. Restart OnethyCode if the command is not immediately available.",
      })
    }
    const timer = setTimeout(() => {
      child.kill()
      finish("Installation timed out. Check npm and network access.")
    }, 180_000)
    child.on("error", (error) => finish(error.message))
    child.on("close", (code) => finish(code === 0 ? undefined : "npm exited with code " + code + ". " + log))
    toast.show({ variant: "info", message: "Installing the pinned Agent Desktop native runtime…" })
  }

  const confirmInstall = () => {
    dialog.push(() => (
      <DialogSelect
        title="Install Agent Desktop locally?"
        description={"Installs " + PACKAGE + " globally with npm. The official package downloads a platform-specific binary. No install is started without your confirmation."}
        skipFilter
        options={[
          { value: "cancel", title: "Cancel", onSelect: () => dialog.pop() },
          { value: "install", title: "Yes, install", onSelect: () => { dialog.pop(); install() } },
        ]}
      />
    ))
  }

  return (
    <DialogSelect
      title="Agent Desktop — Native computer use"
      placeholder="Search desktop actions..."
      options={[
        {
          value: "status",
          title: "Check native runtime status",
          description: "Detect platform support and accessibility connection",
          category: "Diagnostics",
          onSelect: () => inspect("status"),
        },
        {
          value: "permissions",
          title: "Check OS accessibility permissions",
          description: "Show the permissions required by this operating system",
          category: "Diagnostics",
          onSelect: () => inspect("permissions"),
        },
        {
          value: "install",
          title: "Install native runtime",
          description: "Explicitly install the official agent-desktop package on this machine",
          category: "Setup",
          onSelect: confirmInstall,
        },
        {
          value: "usage",
          title: "How to use desktop control",
          description: "Agents use desktop_control for snapshots, clicks, typing and window management",
          category: "Guide",
          onSelect: () => dialog.push(() => (
            <DialogSelect
              title="Agent Desktop — Usage"
              description={"Ask your agent to inspect and operate a desktop app. It will use desktop_control and ask for required permissions. Desktop access operates on the machine hosting the OnethyCode server, not a remote client. Do not share sensitive snapshots or logs."}
              skipFilter
              options={[{ value: "back", title: "Back", onSelect: () => dialog.pop() }]}
            />
          )),
        },
      ]}
    />
  )
}
