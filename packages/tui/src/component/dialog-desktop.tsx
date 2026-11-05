import { createSignal } from "solid-js"
import { spawn } from "node:child_process"
import { buildDesktopInvocation, runAgentDesktop } from "@opencode/core/agent-desktop"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { desktopReportRows, type DesktopReportRow } from "./desktop-report"
import { DialogDesktopReport } from "./dialog-desktop-report"

const PACKAGE = "agent-desktop@1.2.0"

const usageRows: readonly DesktopReportRow[] = [
  { label: "Using the tool", value: "Ask an agent to inspect and operate a desktop application with desktop_control. It will request permission before reading windows or performing actions.", severity: "normal" },
  { label: "Where it runs", value: "Desktop control operates on the machine hosting the OnethyCode backend. It cannot automatically control a different computer.", severity: "normal" },
  { label: "Recommended workflow", value: "Check native runtime status, list windows, inspect a scoped accessibility snapshot, act on a qualified element reference, then verify with a new snapshot.", severity: "normal" },
  { label: "Privacy", value: "Never share private snapshots, credentials or diagnostic logs with other agents or repositories without authorization.", severity: "warning" },
]


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
        dialog.push(() => (
          <DialogDesktopReport
            title={action === "status" ? "Agent Desktop — Runtime status" : "Agent Desktop — OS permissions"}
            rows={desktopReportRows(result)}
          />
        ), undefined, { size: "large" })
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
        renderFilter={false}
        footer={<text wrapMode="word">{"Installs " + PACKAGE + " globally with npm. The official package downloads a platform-specific binary. Installation starts only after you select Yes, install."}</text>}
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
            <DialogDesktopReport title="Agent Desktop — Usage" rows={usageRows} />
          ), undefined, { size: "large" }),
        },
      ]}
    />
  )
}
