import { describe, expect, test } from "bun:test"
import { OmniCode } from "../src/omnicode.js"

describe("OmniCode private namespace", () => {
  test("uses Windows roaming config and local data without touching OpenCode paths", () => {
    const result = OmniCode.paths({
      platform: "win32",
      home: "C:\\Users\\Test",
      env: { APPDATA: "C:\\Roaming", LOCALAPPDATA: "C:\\Local" },
    })
    expect(result.config).toBe("C:\\Roaming\\omnicode")
    expect(result.data).toBe("C:\\Local\\omnicode\\data")
    expect(result.cache).toBe("C:\\Local\\omnicode\\cache")
    expect(result.state).toBe("C:\\Local\\omnicode\\state")
  })

  test("uses XDG directories on Linux and macOS", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const result = OmniCode.paths({
        platform,
        home: "/home/test",
        env: { XDG_CONFIG_HOME: "/config", XDG_DATA_HOME: "/data", XDG_CACHE_HOME: "/cache" },
      })
      expect(result.config).toBe("/config/omnicode")
      expect(result.data).toBe("/data/omnicode")
      expect(result.cache).toBe("/cache/omnicode")
    }
  })

  test("defaults to private home directories without reading global process state", () => {
    const result = OmniCode.paths({ platform: "linux", home: "/home/test", env: {} })
    expect(result.config).toBe("/home/test/.config/omnicode")
    expect(result.data).toBe("/home/test/.local/share/omnicode")
    expect(result.cache).toBe("/home/test/.cache/omnicode")
  })

  test("rejects relative overrides and relative XDG roots", () => {
    expect(() => OmniCode.paths({ platform: "linux", home: "/home/test", env: { OMNICODE_CONFIG_DIR: "../other" } })).toThrow()
    expect(() => OmniCode.paths({ platform: "linux", home: "/home/test", env: { XDG_DATA_HOME: "relative" } })).toThrow()
    expect(() => OmniCode.paths({ platform: "win32", home: "C:\\Test", env: { OMNICODE_DATA_DIR: "C:relative" } })).toThrow()
  })

  test("honors explicit OmniCode overrides without inheriting OpenCode overrides", () => {
    const result = OmniCode.paths({
      platform: "linux",
      home: "/home/test",
      env: { OMNICODE_DATA_DIR: "/private/data", OPENCODE_CONFIG_DIR: "/opencode/config", OPENCODE_DB: "/opencode/live.db" },
    })
    expect(result.data).toBe("/private/data")
    expect(result.config).toBe("/home/test/.config/omnicode")
  })

  test("prepares a fresh child environment, retaining provider keys but not OpenCode runtime state", () => {
    const env = { PATH: "/bin", OPENAI_API_KEY: "fixture-only", OPENCODE_CONFIG_DIR: "/live/config", OPENCODE_SERVER: "http://live" }
    const result = OmniCode.environment({ platform: "linux", home: "/home/test", env })
    expect(result.OMNICODE_ACTIVE).toBe("1")
    expect(result.OPENCODE_CONFIG_DIR).toBe("/home/test/.config/omnicode")
    expect(result.OPENCODE_DB).toBe("/home/test/.local/share/omnicode/omnicode.db")
    expect(result.OPENCODE_SERVER).toBeUndefined()
    expect(result.OPENAI_API_KEY).toBe("fixture-only")
    expect(env.OPENCODE_CONFIG_DIR).toBe("/live/config")
  })
})
