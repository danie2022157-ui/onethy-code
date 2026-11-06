import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { openMcpUsage, prioritizeMcp, usageFile } from "../src/mcp/usage"

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})
const fixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "onethy-mcp-learn-"))
  dirs.push(root)
  return root
}

describe("Onethy automatic MCP learning", () => {
  test("learns user-installed MCP usage and prioritizes it after a restart", async () => {
    const root = await fixture()
    const usage = await openMcpUsage(root, root)
    await usage.record("custom-user-github", true, 75)
    await usage.record("custom-user-github", true, 180)
    await usage.record("custom-user-github", false, 50)
    const restored = await openMcpUsage(root, root)
    const order = restored.prioritize(["filesystem", "custom-user-github", "unused-extra", "another-extra"])
    expect(order[0]?.name).toBe("custom-user-github")
    expect(order[0]?.tier).toBe("warm")
    expect(order[0]?.calls7d).toBe(3)
    expect(order.find((entry) => entry.name === "unused-extra")?.tier).toBe("standby")
    const content = await fs.readFile(usageFile(root, root), "utf8")
    expect(content).not.toContain("75ms")
    expect(JSON.parse(content).servers[0].days).toBeDefined()
  })

  test("treats all installed servers equally and starts conservatively with no history", () => {
    const items = prioritizeMcp(["first", "second", "third", "fourth"], [], Date.now())
    expect(items.map((item) => item.tier)).toEqual(["warm", "warm", "standby", "standby"])
    expect(items.map((item) => item.name)).toEqual(["first", "second", "third", "fourth"])
  })

  test("does not give stale historical usage infinite priority", () => {
    const now = Date.now()
    const old = new Date(now - 90 * 86_400_000).toISOString().slice(0, 10)
    const date = new Date(now).toISOString().slice(0, 10)
    const plan = prioritizeMcp(["old", "recent"], [
      { name: "old", lastUsedAt: now - 90 * 86_400_000, days: { [old]: { calls: 1000, successes: 1000, failures: 0, totalLatencyMs: 0 } } },
      { name: "recent", lastUsedAt: now, days: { [date]: { calls: 4, successes: 4, failures: 0, totalLatencyMs: 0 } } },
    ], now)
    expect(plan[0]?.name).toBe("recent")
    expect(plan.find((entry) => entry.name === "old")?.calls7d).toBe(0)
  })

  test("isolates workspaces and ignores corrupt telemetry", async () => {
    const root = await fixture()
    const one = await openMcpUsage(path.join(root, "workspace-one"), root)
    await one.record("github", true, 30)
    const other = await openMcpUsage(path.join(root, "workspace-two"), root)
    expect(other.snapshot()).toEqual([])
    await fs.writeFile(usageFile(path.join(root, "workspace-one"), root), "bad json")
    expect((await openMcpUsage(path.join(root, "workspace-one"), root)).snapshot()).toEqual([])
  })

  test("only persists names and aggregate statistics, not tool input or results", async () => {
    const root = await fixture()
    const usage = await openMcpUsage(root, root)
    await usage.record("user-installed-playwright", true, 25)
    const data = JSON.parse(await fs.readFile(usageFile(root, root), "utf8"))
    expect(Object.keys(data)).toEqual(["version", "servers"])
    expect(Object.keys(data.servers[0])).toEqual(["name", "lastUsedAt", "days"])
    expect(Object.keys(data.servers[0].days[Object.keys(data.servers[0].days)[0]])).toEqual([
      "calls", "successes", "failures", "totalLatencyMs",
    ])
  })
})
