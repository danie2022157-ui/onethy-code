import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export function findBun(env = process.env) {
  const home = env.USERPROFILE || os.homedir()
  const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local")
  const executable = process.platform === "win32" ? "bun.exe" : "bun"
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH")
  const candidates = [
    env.BUN_BIN,
    path.join(localAppData, "omnicode", "bin", executable),
    path.join(home, ".bun", "bin", executable),
    ...((pathKey && env[pathKey]) || "")
      .split(path.delimiter)
      .filter((directory) => path.isAbsolute(directory))
      .map((directory) => path.join(directory, executable)),
  ]

  return candidates.find((candidate) => candidate && path.isAbsolute(candidate) && isBun(candidate))
}

export function makeOmniEnvironment(env, bunBin) {
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") || "PATH"
  return {
    ...Object.fromEntries(Object.entries(env).filter(([key]) => !key.toUpperCase().startsWith("OPENCODE_"))),
    OMNICODE_ACTIVE: "1",
    OPENCODE_CLI_NAME: "omnicode",
    BUN_BIN: bunBin,
    [pathKey]: [path.dirname(bunBin), env[pathKey]].filter(Boolean).join(path.delimiter),
  }
}

function isBun(file) {
  try {
    if (process.platform === "win32" && [".bat", ".cmd"].includes(path.extname(file).toLowerCase())) return false
    if (!fs.statSync(file).isFile()) return false
    if (process.platform !== "win32") fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}
