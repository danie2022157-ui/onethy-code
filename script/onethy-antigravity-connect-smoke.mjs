/**
 * Integration smoke: loads the real pinned third-party plugin in a disposable
 * OnethyCode server and verifies the Google OAuth registration exposed by
 * /connect. No Google login, tokens, API calls or user data are used.
 */
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sandbox = mkdtempSync(path.join(tmpdir(), "onethy-antigravity-connect-"))
const env = {
  ...process.env,
  ONETHY_ACTIVE: "1",
  OMNICODE_ACTIVE: "1",
  OPENCODE_CHANNEL: "local",
  XDG_CONFIG_HOME: path.join(sandbox, "config"),
  XDG_STATE_HOME: path.join(sandbox, "state"),
  XDG_CACHE_HOME: path.join(sandbox, "cache"),
  XDG_DATA_HOME: path.join(sandbox, "data"),
}

function command(args, timeout = 240_000) {
  // Match bin/onethy.js exactly: the CLI workspace's Bun config controls JSX import resolution.
  return spawnSync(process.execPath, ["run", "--cwd", path.join(root, "packages/cli"), "src/index.ts", ...args], {
    env, cwd: root, encoding: "utf8", timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  })
}

try {
  const result = command(["api", "get", "/api/integration"])
  if (result.error || result.status !== 0) {
    throw new Error("Integration discovery failed: " + String(result.error?.message ?? result.stderr).slice(0, 3000))
  }
  const parsed = JSON.parse(result.stdout)
  const items = Array.isArray(parsed) ? parsed : parsed.data
  if (!Array.isArray(items)) throw new Error("Expected integration list from API")
  const google = items.find((item) => item.id === "google")
  const methods = google?.methods ?? []
  if (!methods.some((method) => method.type === "oauth" && method.id === "antigravity-oauth")) {
    const check = command(["plugin", "check"], 60_000)
    const all = command(["plugin", "list", "--builtin"], 60_000)
    const location = new URLSearchParams({ "location[directory]": root }).toString()
    const scoped = command(["api", "get", "/api/plugin?" + location], 60_000)
    const native = command(["api", "get", "/api/integration?" + location], 60_000)
    const diagnostics = [
      "plugin check: " + String(check.stdout + "\n" + check.stderr),
      "plugin list: " + String(all.stdout + "\n" + all.stderr),
      "scoped plugin inventory: " + String(scoped.stdout + "\n" + scoped.stderr),
      "scoped google methods: " + (() => {
        try {
          const value = JSON.parse(native.stdout)
          const google = (Array.isArray(value) ? value : value.data)?.find((x) => x.id === "google")
          return JSON.stringify(google?.methods ?? null)
        } catch { return String(native.stderr).slice(0, 250) }
      })(),
      "runtime: ONETHY_ACTIVE=" + env.ONETHY_ACTIVE + " OMNICODE_ACTIVE=" + env.OMNICODE_ACTIVE,
    ].join("\n").slice(0, 6500)
    throw new Error("Antigravity OAuth method absent from Google /connect. " +
      "Methods: " + JSON.stringify(methods.map((item) => ({ id: item.id, type: item.type }))) +
      "\nPlugin diagnostics:\n" + diagnostics)
  }
  console.log("PASS: /connect -> Google -> OAuth with Google (Antigravity) registered")
} finally {
  command(["service", "stop"], 30_000)
  rmSync(sandbox, { recursive: true, force: true })
}
