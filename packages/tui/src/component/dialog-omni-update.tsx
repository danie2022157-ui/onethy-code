import { createSignal, For, Match, onMount, Switch } from "solid-js"
import { useDialog, DialogLayout, DialogHeader } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { useClient } from "../context/client"
import { useLocal } from "../context/local"
import { useExit } from "../context/exit"
import { Keymap } from "../context/keymap"
import { openUrl } from "@opencode/util/open"
import { Spinner } from "./spinner"
import { RGBA, TextAttributes } from "@opentui/core"
import { exec } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

function findOnethyRoot(): string {
  try {
    let curr = path.dirname(fileURLToPath(import.meta.url))
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(curr, ".git")) && fs.existsSync(path.join(curr, "package.json"))) {
        return curr
      }
      const parent = path.dirname(curr)
      if (parent === curr) break
      curr = parent
    }
  } catch {
    // ignore
  }
  return process.cwd()
}

function findBunBin(): string | undefined {
  if (process.env.BUN_BIN && fs.existsSync(process.env.BUN_BIN)) return process.env.BUN_BIN
  const home = process.env.USERPROFILE || os.homedir()
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
  const executable = process.platform === "win32" ? "bun.exe" : "bun"
  const candidates = [
    path.join(localAppData, "omnicode", "bin", executable),
    path.join(home, ".bun", "bin", executable),
  ]
  return candidates.find((c) => fs.existsSync(c))
}

function runGit(cmd: string, cwd: string, timeoutMs = 45000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    exec(cmd, { cwd, encoding: "utf8", timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({
        stdout: (stdout || "").trim(),
        stderr: (stderr || "").trim(),
        code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
      })
    })
  })
}

type UpdateStep = "checking" | "available" | "up-to-date" | "updating" | "success" | "error"

export function DialogOmniUpdate() {
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const client = useClient()
  const local = useLocal()
  const exit = useExit()
  const repoUrl = "https://github.com/danie2022157-ui/onethy-code"

  const [step, setStep] = createSignal<UpdateStep>("checking")
  const [statusMessage, setStatusMessage] = createSignal("Checking for updates on GitHub...")
  const [localSha, setLocalSha] = createSignal("")
  const [remoteSha, setRemoteSha] = createSignal("")
  const [branch, setBranch] = createBranchSignal()
  const [pendingCommits, setPendingCommits] = createSignal<string[]>([])
  const [errorMessage, setErrorMessage] = createSignal("")
  const [lastCommitMsg, setLastCommitMsg] = createSignal("")

  function createBranchSignal() {
    return createSignal("main")
  }

  dialog.setCentered(true)

  const checkUpdates = async () => {
    setStep("checking")
    setStatusMessage("Connecting to official repository...")
    const root = findOnethyRoot()

    try {
      // 1. Detect local commit & branch
      const curBranchRes = await runGit("git branch --show-current", root)
      const curBranch = curBranchRes.stdout || "main"
      setBranch(curBranch)

      const localShaRes = await runGit("git rev-parse --short HEAD", root)
      const currentSha = localShaRes.stdout || "head"
      setLocalSha(currentSha)

      // 2. Fetch origin
      setStatusMessage(`Fetching latest from origin/${curBranch}...`)
      await runGit(`git fetch origin ${curBranch}`, root)

      // 3. Check pending commits
      const logRes = await runGit(`git log HEAD..origin/${curBranch} --oneline -n 6`, root)
      const commits = logRes.stdout.split("\n").filter((l) => l.trim().length > 0)
      setPendingCommits(commits)

      if (commits.length > 0) {
        const remoteShaRes = await runGit(`git rev-parse --short origin/${curBranch}`, root)
        setRemoteSha(remoteShaRes.stdout || "latest")
        setStep("available")
      } else {
        const lastMsgRes = await runGit("git log -1 --pretty=%s", root)
        setLastCommitMsg(lastMsgRes.stdout || "Latest version")
        setStep("up-to-date")
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "Could not verify repository.")
      setStep("error")
    }
  }

  const applyUpdate = async (force = false) => {
    setStep("updating")
    const root = findOnethyRoot()
    const curBranch = branch()

    try {
      setStatusMessage("Checking status of local files...")
      const statusRes = await runGit("git status --porcelain", root)
      const isDirty = statusRes.stdout.length > 0
      let stashed = false

      if (isDirty) {
        setStatusMessage("Stashing local changes (safe stash)...")
        const stashRes = await runGit('git stash save "onethy-auto-update"', root)
        stashed = stashRes.code === 0 && !stashRes.stdout.includes("No local changes")
      }

      setStatusMessage(`Downloading updates (git pull origin ${curBranch})...`)
      const pullRes = await runGit(`git pull origin ${curBranch}`, root)

      if (pullRes.code !== 0 && !force) {
        if (stashed) await runGit("git stash pop", root)
        throw new Error(pullRes.stderr || pullRes.stdout || "Git pull failed.")
      }

      if (stashed) {
        setStatusMessage("Restoring local files...")
        await runGit("git stash pop", root)
      }

      // Check if Bun is available to sync dependencies
      const bun = findBunBin()
      if (bun) {
        setStatusMessage("Syncing OnethyCode dependencies...")
        await runGit(`"${bun}" install`, root, 60000)
      }

      const newShaRes = await runGit("git rev-parse --short HEAD", root)
      setRemoteSha(newShaRes.stdout || localSha())

      const lastMsgRes = await runGit("git log -1 --pretty=%s", root)
      setLastCommitMsg(lastMsgRes.stdout || "Update completed")

      setStep("success")
      toast.show({
        variant: "success",
        title: "OnethyCode Updated!",
        message: `Version ${newShaRes.stdout}: ${lastMsgRes.stdout.slice(0, 50)}`,
        duration: 5000,
      })
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to download update.")
      setStep("error")
    }
  }

  onMount(() => {
    void checkUpdates()
  })

  const restartApp = async () => {
    if (client.restart) {
      toast.show({ variant: "info", message: "Restarting OnethyCode service...", duration: 25000 })
      dialog.clear()
      await client.restart().catch(toast.error)
    } else {
      dialog.clear()
      exit()
    }
  }

  const repairSessionAndCache = () => {
    local.model.auto.clearCooldowns()
    const decision = local.model.auto.routeForPrompt("")
    toast.show({
      variant: "success",
      message: decision
        ? `Session & cache repaired! Active model: ${decision.modelName} (${decision.providerID})`
        : "Rate-limit cache (429) and session state repaired!",
      duration: 3800,
    })
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: "Confirm Action",
        group: "Dialog",
        run: () => {
          const s = step()
          if (s === "available") void applyUpdate(false)
          else if (s === "up-to-date") void applyUpdate(true)
          else if (s === "success") void restartApp()
          else if (s === "error") void checkUpdates()
        },
      },
      {
        bind: "d",
        title: "Repair Session and Cache",
        group: "Dialog",
        run: () => repairSessionAndCache(),
      },
      {
        bind: "escape",
        title: "Close",
        group: "Dialog",
        run: () => dialog.clear(),
      },
    ],
  }))

  return (
    <DialogLayout
      header={
        <DialogHeader
          title={
            <text fg={RGBA.fromHex("#00F5FF")} attributes={TextAttributes.BOLD}>
              OnethyCode Updater
            </text>
          }
          description="Sync with official GitHub repository"
          onClose={() => dialog.clear()}
        />
      }
      legacyFooter={
        <box flexDirection="row" justifyContent="flex-end" gap={1} paddingTop={1}>
          <Switch>
            <Match when={step() === "available"}>
              <box
                paddingLeft={2}
                paddingRight={2}
                backgroundColor={RGBA.fromHex("#00F5FF")}
                onMouseUp={() => void applyUpdate(false)}
              >
                <text fg={RGBA.fromHex("#0A0F1D")} attributes={TextAttributes.BOLD} selectable={false}>
                  Update Now [Enter]
                </text>
              </box>
              <box paddingLeft={1} paddingRight={1} onMouseUp={() => dialog.clear()}>
                <text fg={theme.text.muted} selectable={false}>
                  Skip [Esc]
                </text>
              </box>
            </Match>
            <Match when={step() === "up-to-date"}>
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={RGBA.fromInts(56, 189, 248, 45)}
                onMouseUp={() => repairSessionAndCache()}
              >
                <text fg={RGBA.fromHex("#38BDF8")} attributes={TextAttributes.BOLD} selectable={false}>
                  Repair Session & Cache [D]
                </text>
              </box>
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={RGBA.fromHex("#10B981")}
                onMouseUp={() => void applyUpdate(true)}
              >
                <text fg={RGBA.fromHex("#FFFFFF")} attributes={TextAttributes.BOLD} selectable={false}>
                  Force Sync [Enter]
                </text>
              </box>
              <box paddingLeft={1} paddingRight={1} onMouseUp={() => dialog.clear()}>
                <text fg={theme.text.muted} selectable={false}>
                  Close [Esc]
                </text>
              </box>
            </Match>
            <Match when={step() === "success"}>
              <box
                paddingLeft={2}
                paddingRight={2}
                backgroundColor={RGBA.fromHex("#10B981")}
                onMouseUp={() => void restartApp()}
              >
                <text fg={RGBA.fromHex("#FFFFFF")} attributes={TextAttributes.BOLD} selectable={false}>
                  Restart OnethyCode [Enter]
                </text>
              </box>
              <box paddingLeft={1} paddingRight={1} onMouseUp={() => dialog.clear()}>
                <text fg={theme.text.muted} selectable={false}>
                  Later [Esc]
                </text>
              </box>
            </Match>
            <Match when={step() === "error"}>
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={RGBA.fromHex("#F43F5E")}
                onMouseUp={() => void checkUpdates()}
              >
                <text fg={RGBA.fromHex("#FFFFFF")} attributes={TextAttributes.BOLD} selectable={false}>
                  Try Again [Enter]
                </text>
              </box>
              <box paddingLeft={1} paddingRight={1} onMouseUp={() => dialog.clear()}>
                <text fg={theme.text.muted} selectable={false}>
                  Close [Esc]
                </text>
              </box>
            </Match>
          </Switch>
        </box>
      }
    >
      <Switch>
        <Match when={step() === "checking"}>
          <box flexDirection="column" gap={1} paddingBottom={1}>
            <Spinner shimmer={theme.text.base}>{statusMessage()}</Spinner>
            <text fg={theme.text.muted}>
              Repository: danie2022157-ui/onethy-code · Branch: {branch()}
            </text>
          </box>
        </Match>

        <Match when={step() === "available"}>
          <box flexDirection="column" gap={1} paddingBottom={1}>
            <box flexDirection="row" gap={1}>
              <text fg={RGBA.fromHex("#10B981")} attributes={TextAttributes.BOLD}>
                ✦ New update available!
              </text>
              <text fg={theme.text.muted}>
                ({localSha()} → {remoteSha()})
              </text>
            </box>
            <text fg={theme.text.base}>
              New commits available in <b>origin/{branch()}</b>:
            </text>
            <box
              flexDirection="column"
              paddingLeft={1}
              backgroundColor={RGBA.fromInts(0, 0, 0, 100)}
              gap={0}
            >
              <For each={pendingCommits()}>
                {(commit) => (
                  <text fg={RGBA.fromHex("#38BDF8")} wrapMode="none">
                    • {commit}
                  </text>
                )}
              </For>
            </box>
            <text fg={theme.text.muted}>
              Press <b>Enter</b> to apply updates automatically via git pull.
            </text>
          </box>
        </Match>

        <Match when={step() === "up-to-date"}>
          <box flexDirection="column" gap={1} paddingBottom={1}>
            <box flexDirection="row" gap={1}>
              <text fg={RGBA.fromHex("#10B981")} attributes={TextAttributes.BOLD}>
                ✓ OnethyCode is up to date!
              </text>
            </box>
            <text fg={theme.text.muted}>
              Active commit: <text fg={RGBA.fromHex("#00F5FF")}>{localSha()}</text> — {lastCommitMsg()}
            </text>
            <text fg={theme.text.muted}>
              Branch: {branch()} · Synced with origin/main.
            </text>
            <box
              paddingTop={1}
              onMouseUp={() => void openUrl(repoUrl).catch(() => undefined)}
            >
              <text fg={RGBA.fromHex("#38BDF8")}>
                Open repository on GitHub: {repoUrl}
              </text>
            </box>
          </box>
        </Match>

        <Match when={step() === "updating"}>
          <box flexDirection="column" gap={1} paddingBottom={1}>
            <Spinner shimmer={RGBA.fromHex("#00F5FF")}>{statusMessage()}</Spinner>
            <text fg={theme.text.muted}>
              Please wait while files are safely updated...
            </text>
          </box>
        </Match>

        <Match when={step() === "success"}>
          <box flexDirection="column" gap={1} paddingBottom={1}>
            <text fg={RGBA.fromHex("#10B981")} attributes={TextAttributes.BOLD}>
              ✓ Update applied successfully!
            </text>
            <text fg={theme.text.base}>
              New active commit: <text fg={RGBA.fromHex("#00F5FF")}>{remoteSha() || localSha()}</text>
            </text>
            <text fg={theme.text.muted}>
              {lastCommitMsg()}
            </text>
            <text fg={RGBA.fromHex("#F59E0B")} attributes={TextAttributes.BOLD}>
              Restart OnethyCode to activate all new features in the terminal.
            </text>
          </box>
        </Match>

        <Match when={step() === "error"}>
          <box flexDirection="column" gap={1} paddingBottom={1}>
            <text fg={RGBA.fromHex("#F43F5E")} attributes={TextAttributes.BOLD}>
              ✕ Failed to sync updates
            </text>
            <text fg={theme.text.feedback.error.base} wrapMode="word">
              {errorMessage()}
            </text>
            <text fg={theme.text.muted}>
              Check your internet connection or run 'git pull' manually in terminal.
            </text>
          </box>
        </Match>
      </Switch>
    </DialogLayout>
  )
}
