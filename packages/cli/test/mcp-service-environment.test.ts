import { describe, expect, test } from "bun:test"
import { ServiceConfig } from "../src/services/service-config"

describe("Onethy managed service environment", () => {
  test("preserves product identity after service restart", () => {
    expect(ServiceConfig.processEnv(undefined, { ONETHY_ACTIVE: "1" })).toMatchObject({
      ONETHY_ACTIVE: "1",
      OMNICODE_ACTIVE: "1",
      OPENCODE_CLI_NAME: "onethy",
    })
  })

  test("keeps custom environment but excludes state relocation", () => {
    expect(ServiceConfig.processEnv(
      { CUSTOM: "value", XDG_STATE_HOME: "should-not-migrate" },
      { OMNICODE_ACTIVE: "1" },
    )).toEqual({
      CUSTOM: "value",
      ONETHY_ACTIVE: "1",
      OMNICODE_ACTIVE: "1",
      OPENCODE_CLI_NAME: "onethy",
    })
  })

  test("keeps plain OpenCode behavior unchanged", () => {
    expect(ServiceConfig.processEnv(undefined, {})).toBeUndefined()
    expect(ServiceConfig.processEnv({ CUSTOM: "value" }, {})).toEqual({ CUSTOM: "value" })
  })
})
