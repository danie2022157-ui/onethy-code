import { describe, expect, test } from "bun:test"
import {
  clampBottomHeight,
  clampSidebarWidth,
  DEFAULT_WORKBENCH_STATE,
  parseWorkbenchState,
} from "./state"

describe("workbench state persistence", () => {
  test("returns defaults for empty or malformed storage values", () => {
    expect(parseWorkbenchState(null)).toEqual(DEFAULT_WORKBENCH_STATE)
    expect(parseWorkbenchState("")).toEqual(DEFAULT_WORKBENCH_STATE)
    expect(parseWorkbenchState("{invalid json")).toEqual(DEFAULT_WORKBENCH_STATE)
    expect(parseWorkbenchState("null")).toEqual(DEFAULT_WORKBENCH_STATE)
  })

  test("restores valid persisted fields and clamps bounds", () => {
    const parsed = parseWorkbenchState(
      JSON.stringify({
        activity: "git",
        sidebarOpen: false,
        sidebarWidth: 999,
        layoutMode: "editor",
        bottomOpen: true,
        bottomTab: "logs",
        bottomHeight: 40,
      }),
    )

    expect(parsed.activity).toBe("git")
    expect(parsed.sidebarOpen).toBe(false)
    expect(parsed.sidebarWidth).toBe(clampSidebarWidth(999))
    expect(parsed.layoutMode).toBe("editor")
    expect(parsed.bottomOpen).toBe(true)
    expect(parsed.bottomTab).toBe("logs")
    expect(parsed.bottomHeight).toBe(clampBottomHeight(40))
  })

  test("falls back per-field when enum values are unknown", () => {
    const parsed = parseWorkbenchState(
      JSON.stringify({
        activity: "nonexistent",
        layoutMode: "invalid",
        bottomTab: "unknown",
        sidebarOpen: true,
        sidebarWidth: 300,
      }),
    )

    expect(parsed.activity).toBe(DEFAULT_WORKBENCH_STATE.activity)
    expect(parsed.layoutMode).toBe(DEFAULT_WORKBENCH_STATE.layoutMode)
    expect(parsed.bottomTab).toBe(DEFAULT_WORKBENCH_STATE.bottomTab)
    expect(parsed.sidebarWidth).toBe(300)
  })
})
