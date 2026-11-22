export * as WebSearchDuckDuckGo from "./duckduckgo.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Scope } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { WebSearch } from "@opencode/schema/websearch"

export const endpoint = "https://html.duckduckgo.com/html/"

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.duckduckgo",
  effect: Effect.fn("WebSearchDuckDuckGo.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: "duckduckgo",
        name: "DuckDuckGo",
        execute: (input) =>
          Effect.gen(function* () {
            const url = new URL(endpoint)
            url.searchParams.set("q", input.query)
            const request = HttpClientRequest.get(url.toString()).pipe(
              HttpClientRequest.setHeaders({
                "User-Agent": "Mozilla/5.0 (compatible; OnethyCode/1.0)",
                Accept: "text/html,application/xhtml+xml",
              }),
            )
            const html = yield* HttpClient.withScope(HttpClient.filterStatusOk(http))
              .execute(request)
              .pipe(
                Effect.flatMap((response) => response.text),
                Effect.scoped,
                Effect.timeoutOrElse({
                  duration: Duration.seconds(15),
                  orElse: () => Effect.fail(new Error("DuckDuckGo search timed out")),
                }),
              )
            return parseDuckDuckGoHtml(html)
          }),
      })
    })
  }),
})

export function parseDuckDuckGoHtml(html: string, limit = 8): readonly WebSearch.Result[] {
  const results: WebSearch.Result[] = []
  const seen = new Set<string>()
  const blocks = html.split(/class="result\s+results_links/i).slice(1)
  for (const block of blocks) {
    if (results.length >= limit) break
    const linkMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!linkMatch) continue
    const url = unwrapDuckDuckGoUrl(decodeHtmlEntities(linkMatch[1]))
    if (!url || seen.has(url)) continue
    seen.add(url)
    const title = stripTags(linkMatch[2])
    const snippetMatch = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i)
    const content = snippetMatch ? stripTags(snippetMatch[1]) : undefined
    results.push({
      url,
      ...(title ? { title } : {}),
      ...(content ? { content } : {}),
      time: {},
    })
  }
  return results
}

function unwrapDuckDuckGoUrl(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const full = trimmed.startsWith("//")
    ? `https:${trimmed}`
    : trimmed.startsWith("/")
      ? `https://duckduckgo.com${trimmed}`
      : trimmed
  const parsed = parseUrlSafe(full)
  if (!parsed) return undefined
  const target = parsed.searchParams.get("uddg")
  if (target && /^https?:\/\//i.test(target)) return target
  if (/^https?:$/.test(parsed.protocol)) return parsed.href
  return undefined
}

function parseUrlSafe(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}
