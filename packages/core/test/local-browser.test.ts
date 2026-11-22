import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LocalBrowser } from "@opencode/core/local-browser"
import { WebSearchDuckDuckGo } from "@opencode/core/plugin/websearch/duckduckgo"
import { WebSearchTool } from "@opencode/core/tool/plugin/websearch"
import { Agent } from "@opencode/core/agent"
import { AgentPlugin } from "@opencode/core/plugin/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { agentHost, host } from "./plugin/host"

describe("WebSearch domain & DuckDuckGo parser", () => {
  test("applyDomainFilter scopes query when domain is provided", () => {
    expect(WebSearchTool.applyDomainFilter("bun websocket", "bun.sh")).toBe("site:bun.sh bun websocket")
    expect(WebSearchTool.applyDomainFilter("bun websocket", "https://docs.python.org/3/")).toBe(
      "site:docs.python.org bun websocket",
    )
    expect(WebSearchTool.applyDomainFilter("site:bun.sh websocket", "docs.python.org")).toBe("site:bun.sh websocket")
    expect(WebSearchTool.applyDomainFilter("bun websocket")).toBe("bun websocket")
  })

  test("parseDuckDuckGoHtml extracts unwrapped URLs, titles, and snippets", () => {
    const html = `
      <div class="result results_links results_links_deep web-result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbun.sh%2Fdocs&amp;rut=abc">Bun &amp; Docs</a>
        <a class="result__snippet">Fast all-in-one <b>JavaScript</b> runtime.</a>
      </div>
      <div class="result results_links results_links_deep web-result">
        <a class="result__a" href="https://effect.website/docs">Effect Docs</a>
        <div class="result__snippet">Type-safe Effect system for TypeScript.</div>
      </div>
    `
    expect(WebSearchDuckDuckGo.parseDuckDuckGoHtml(html)).toEqual([
      {
        url: "https://bun.sh/docs",
        title: "Bun & Docs",
        content: "Fast all-in-one JavaScript runtime.",
        time: {},
      },
      {
        url: "https://effect.website/docs",
        title: "Effect Docs",
        content: "Type-safe Effect system for TypeScript.",
        time: {},
      },
    ])
  })
})

describe("LocalBrowser URL normalization", () => {
  test("normalizes valid http, https, localhost, and about:blank URLs", () => {
    expect(LocalBrowser.normalizeBrowserUrl("about:blank")).toBe("about:blank")
    expect(LocalBrowser.normalizeBrowserUrl("example.com")).toBe("https://example.com/")
    expect(LocalBrowser.normalizeBrowserUrl("localhost:3000/app")).toBe("http://localhost:3000/app")
    expect(LocalBrowser.normalizeBrowserUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080/")
  })

  test("rejects file paths, unsafe schemes, and embedded credentials", () => {
    expect(() => LocalBrowser.normalizeBrowserUrl("file:///etc/passwd")).toThrow()
    expect(() => LocalBrowser.normalizeBrowserUrl("javascript:alert(1)")).toThrow()
    expect(() => LocalBrowser.normalizeBrowserUrl("C:\\Windows\\system32")).toThrow()
    expect(() => LocalBrowser.normalizeBrowserUrl("https://user:pass@example.com")).toThrow()
  })
})

describe("Browser subagent registration", () => {
  const it = testEffect(AppNodeBuilder.build(LayerNode.group([Agent.node])))

  it.effect("registers built-in browser subagent with web_browser and websearch permissions", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* AgentPlugin.Plugin.effect(host({ agent: agentHost(agents) }))
      const browser = yield* agents.get(Agent.ID.make("browser"))
      expect(browser).toBeDefined()
      expect(browser?.mode).toBe("subagent")
      expect(browser?.permissions.some((rule) => rule.action === "web_browser" && rule.effect === "allow")).toBe(true)
      expect(browser?.permissions.some((rule) => rule.action === "websearch" && rule.effect === "allow")).toBe(true)
    }),
  )
})

describe("LocalBrowser live CDP integration", () => {
  test("opens a real local page, snapshots refs, fills input, clicks button, captures screenshot, and closes", async () => {
    const exe = await LocalBrowser.findBrowserExecutable()
    if (!exe) return

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          `<!doctype html>
          <html>
            <head><title>Onethy Browser Test</title></head>
            <body>
              <h1>Hello Browser</h1>
              <input id="name" placeholder="Your name" />
              <button id="go" onclick="document.getElementById('out').textContent = 'Hi ' + document.getElementById('name').value; console.log('clicked-ok')">Submit</button>
              <div id="out">Waiting</div>
            </body>
          </html>`,
          { headers: { "content-type": "text/html" } },
        )
      },
    })

    try {
      const opened = await LocalBrowser.execute({
        action: "open",
        url: `http://127.0.0.1:${server.port}/`,
        headless: true,
      })
      expect(opened.title).toBe("Onethy Browser Test")
      expect(opened.summary).toContain("Hello Browser")
      expect(opened.summary).toContain("[e1]")
      expect(opened.summary).toContain("[e2]")

      await LocalBrowser.execute({ action: "fill", ref: "e1", text: "Daniel" })
      await LocalBrowser.execute({ action: "click", ref: "e2" })

      const snap = await LocalBrowser.execute({ action: "snapshot" })
      expect(snap.summary).toContain("Hi Daniel")

      const logs = await LocalBrowser.execute({ action: "console" })
      expect(logs.summary).toContain("clicked-ok")

      const shot = await LocalBrowser.execute({ action: "screenshot" })
      expect(shot.screenshot?.bytes).toBeGreaterThan(100)
      expect(shot.screenshot?.path.endsWith(".png")).toBe(true)
      expect(await Bun.file(shot.screenshot!.path).exists()).toBe(true)
    } finally {
      await LocalBrowser.shutdown()
      server.stop(true)
    }
  })
})
