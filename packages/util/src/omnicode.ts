import path from "node:path"

type Input = {
  readonly platform: NodeJS.Platform
  readonly home: string
  readonly env: Readonly<Record<string, string | undefined>>
}

/** Pure path resolution: importing or validating configuration must not create files. */
export function paths(input: Input) {
  const api = input.platform === "win32" ? path.win32 : path.posix
  const home = absolute(input.home, api)
  const base = input.platform === "win32"
    ? {
        config: api.join(absolute(input.env.APPDATA || api.join(home, "AppData", "Roaming"), api), "omnicode"),
        data: api.join(absolute(input.env.LOCALAPPDATA || api.join(home, "AppData", "Local"), api), "omnicode", "data"),
        cache: api.join(absolute(input.env.LOCALAPPDATA || api.join(home, "AppData", "Local"), api), "omnicode", "cache"),
        state: api.join(absolute(input.env.LOCALAPPDATA || api.join(home, "AppData", "Local"), api), "omnicode", "state"),
      }
    : {
        config: api.join(absolute(input.env.XDG_CONFIG_HOME || api.join(home, ".config"), api), "omnicode"),
        data: api.join(absolute(input.env.XDG_DATA_HOME || api.join(home, ".local", "share"), api), "omnicode"),
        cache: api.join(absolute(input.env.XDG_CACHE_HOME || api.join(home, ".cache"), api), "omnicode"),
        state: api.join(absolute(input.env.XDG_STATE_HOME || api.join(home, ".local", "state"), api), "omnicode"),
      }
  const config = absolute(input.env.OMNICODE_CONFIG_DIR || base.config, api)
  const data = absolute(input.env.OMNICODE_DATA_DIR || base.data, api)
  const cache = absolute(input.env.OMNICODE_CACHE_DIR || base.cache, api)
  const state = absolute(input.env.OMNICODE_STATE_DIR || base.state, api)
  return {
    home,
    config,
    data,
    cache,
    state,
    tmp: api.join(cache, "tmp"),
    bin: api.join(cache, "bin"),
    log: api.join(data, "log"),
    repos: api.join(data, "repos"),
  }
}

/** Do not attach a new product to a user's existing OpenCode service or database. */
export function environment(input: Input): Record<string, string | undefined> {
  const resolved = paths(input)
  const api = input.platform === "win32" ? path.win32 : path.posix
  return {
    ...Object.fromEntries(Object.entries(input.env).filter((entry) => !entry[0].startsWith("OPENCODE_"))),
    OMNICODE_ACTIVE: "1",
    OPENCODE_CONFIG_DIR: resolved.config,
    OPENCODE_DB: api.join(resolved.data, "omnicode.db"),
  }
}

function absolute(value: string, api: typeof path) {
  if (!api.isAbsolute(value)) throw new Error("OmniCode directories must be absolute paths")
  return api.normalize(value)
}

export * as OmniCode from "./omnicode.js"
