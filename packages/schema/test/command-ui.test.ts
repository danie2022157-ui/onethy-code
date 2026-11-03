import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { CommandUi } from "../src/command-ui.js"

describe("CommandUi.Descriptor", () => {
  test("decodes canonical command descriptors", () => {
    const decode = Schema.decodeUnknownSync(CommandUi.Descriptor)

    for (const cmd of CommandUi.CANONICAL_COMMANDS) {
      const decoded = decode(cmd)
      expect(decoded.id).toBe(cmd.id)
      expect(decoded.titleKey).toBe(cmd.titleKey)
    }
  })

  test("validates required id and titleKey", () => {
    const decode = Schema.decodeUnknownSync(CommandUi.Descriptor)
    expect(() => decode({ titleKey: "test" })).toThrow()
    expect(() => decode({ id: "test" })).toThrow()
  })

  test("accepts optional surface-specific mappings and shortcuts", () => {
    const decode = Schema.decodeUnknownSync(CommandUi.Descriptor)
    const custom = decode({
      id: "terminal.toggle",
      titleKey: "command.terminal.toggle",
      tuiId: "terminal.toggle",
      surfaces: ["tui"],
      shortcuts: { macos: "Ctrl+T", windows: "Ctrl+T" },
    })
    expect(custom.id).toBe("terminal.toggle")
    expect(custom.surfaces).toEqual(["tui"])
    expect(custom.shortcuts?.macos).toBe("Ctrl+T")
  })
})
