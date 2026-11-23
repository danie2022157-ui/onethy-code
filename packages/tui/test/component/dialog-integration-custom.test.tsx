import { expect, test } from "bun:test"
import type { ConfigEntry } from "@opencode/client"
import {
  extractCustomProviders,
  fetchModelsFromEndpoint,
  normalizeProviderBaseURL,
  removeCustomProvider,
  saveCustomProvider,
  updateCustomProviderApiKey,
  updateCustomProviderBaseURL,
} from "../../src/component/dialog-integration-custom"
import { createApi, createFetch } from "../fixture/tui-client"

test("normalizeProviderBaseURL adds protocol and strips endpoint suffixes", () => {
  expect(normalizeProviderBaseURL("api.cosmospro.dev/v1/chat/completions")).toBe("https://api.cosmospro.dev/v1")
  expect(normalizeProviderBaseURL(' "https://api.cosmospro.dev/v1/models" ')).toBe("https://api.cosmospro.dev/v1")
  expect(normalizeProviderBaseURL("localhost:11434/v1/")).toBe("http://localhost:11434/v1")
  expect(normalizeProviderBaseURL(" /// ")).toBe("")
})

test("fetchModelsFromEndpoint discovers models and preserves 401 message over fallback 404", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/v1/models") {
        const auth = req.headers.get("authorization")
        const xApiKey = req.headers.get("x-api-key")
        // Simulate strict server that rejects simultaneous Authorization + x-api-key, or requires valid key
        if (auth === "Bearer valid-key" && !xApiKey) {
          return Response.json({
            data: [{ id: "claude-opus-5-5", name: "Claude Opus 5.5" }, { id: "claude-sonnet-5-5" }],
          })
        }
        return Response.json(
          { error: { message: "Authentication Error, Key is blocked." } },
          { status: 401 },
        )
      }
      return new Response("Not Found", { status: 404 })
    },
  })

  try {
    const models = await fetchModelsFromEndpoint(`127.0.0.1:${server.port}/v1/chat/completions`, "Bearer valid-key")
    expect(models).toEqual([
      { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", name: "claude-sonnet-5-5" },
    ])

    await expect(fetchModelsFromEndpoint(`127.0.0.1:${server.port}`, "blocked-key")).rejects.toThrow(
      "HTTP 401: Authentication Error, Key is blocked.",
    )
  } finally {
    await server.stop(true)
  }
})

test("saveCustomProvider writes non-secret config and stores apiKey in SQLite credentials", async () => {
  const requests: { method: string; path: string; body?: unknown }[] = []
  const calls = createFetch(async (url, request) => {
    const body = request.method === "GET" || request.method === "DELETE" ? undefined : await request.json()
    requests.push({ method: request.method, path: url.pathname, body })
    if (url.pathname === "/api/credential" && request.method === "GET") {
      return Response.json({ data: [] })
    }
    if (url.pathname === "/api/credential" && request.method === "POST") {
      return Response.json({
        data: { id: "cred_1", integrationID: "my-provider", label: "My Provider", active: true, value: { type: "key", key: "secret" } },
      })
    }
    return new Response(null, { status: 204 })
  })
  const api = createApi(calls.fetch)

  await saveCustomProvider(api, {
    id: "my-provider",
    name: "My Provider",
    baseURL: "https://api.example/v1",
    apiKey: "secret",
    models: { "model-a": { name: "Model A" } },
  })

  expect(requests).toEqual([
    {
      method: "PATCH",
      path: "/api/experimental/config",
      body: {
        providers: {
          "my-provider": {
            name: "My Provider",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: "https://api.example/v1" },
            models: { "model-a": { name: "Model A" } },
          },
        },
      },
    },
    { method: "GET", path: "/api/credential", body: undefined },
    {
      method: "POST",
      path: "/api/credential",
      body: {
        integrationID: "my-provider",
        label: "My Provider",
        value: { type: "key", key: "secret" },
      },
    },
  ])
})

test("updateCustomProviderBaseURL omits apiKey from config and migrates legacy apiKey to SQLite", async () => {
  const requests: { method: string; path: string; body?: unknown }[] = []
  const calls = createFetch(async (url, request) => {
    const body = request.method === "GET" || request.method === "DELETE" ? undefined : await request.json()
    requests.push({ method: request.method, path: url.pathname, body })
    if (url.pathname === "/api/credential" && request.method === "GET") {
      return Response.json({ data: [] })
    }
    if (url.pathname === "/api/credential" && request.method === "POST") {
      return Response.json({
        data: { id: "cred_1", integrationID: "my-provider", label: "My Provider", active: true, value: { type: "key", key: "secret" } },
      })
    }
    return new Response(null, { status: 204 })
  })
  const api = createApi(calls.fetch)

  await updateCustomProviderBaseURL(
    api,
    {
      id: "my-provider",
      name: "My Provider",
      baseURL: "https://old.example/v1",
      apiKey: "secret",
      modelCount: 1,
      models: { "model-a": { name: "Model A" } },
    },
    " https://new.example/v1/// ",
  )

  expect(requests).toEqual([
    { method: "GET", path: "/api/credential", body: undefined },
    {
      method: "POST",
      path: "/api/credential",
      body: {
        integrationID: "my-provider",
        label: "My Provider",
        value: { type: "key", key: "secret" },
      },
    },
    {
      method: "PATCH",
      path: "/api/experimental/config",
      body: {
        providers: {
          "my-provider": {
            name: "My Provider",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: "https://new.example/v1" },
            models: { "model-a": { name: "Model A" } },
          },
        },
      },
    },
  ])
})

test("updateCustomProviderApiKey replaces SQLite credential without writing apiKey to config", async () => {
  const requests: { method: string; path: string; body?: unknown }[] = []
  const calls = createFetch(async (url, request) => {
    const body = request.method === "GET" || request.method === "DELETE" ? undefined : await request.json()
    requests.push({ method: request.method, path: url.pathname, body })
    if (url.pathname === "/api/credential" && request.method === "GET") {
      return Response.json({
        data: [
          { id: "cred_old", integrationID: "my-provider", label: "My Provider", active: true, value: { type: "key", key: "old" } },
        ],
      })
    }
    if (url.pathname === "/api/credential" && request.method === "POST") {
      return Response.json({
        data: { id: "cred_new", integrationID: "my-provider", label: "My Provider", active: true, value: { type: "key", key: "new-secret" } },
      })
    }
    return new Response(null, { status: 204 })
  })
  const api = createApi(calls.fetch)

  await updateCustomProviderApiKey(
    api,
    {
      id: "my-provider",
      name: "My Provider",
      baseURL: "https://api.example/v1",
      modelCount: 1,
      models: { "model-a": { name: "Model A" } },
    },
    "new-secret",
  )

  expect(requests).toEqual([
    { method: "GET", path: "/api/credential", body: undefined },
    { method: "DELETE", path: "/api/credential/cred_old", body: undefined },
    {
      method: "POST",
      path: "/api/credential",
      body: {
        integrationID: "my-provider",
        label: "My Provider",
        value: { type: "key", key: "new-secret" },
      },
    },
  ])
})

test("removeCustomProvider removes both SQLite credentials and config entry", async () => {
  const requests: { method: string; path: string; body?: unknown }[] = []
  const calls = createFetch(async (url, request) => {
    const body = request.method === "GET" || request.method === "DELETE" ? undefined : await request.json()
    requests.push({ method: request.method, path: url.pathname, body })
    if (url.pathname === "/api/credential" && request.method === "GET") {
      return Response.json({
        data: [
          { id: "cred_1", integrationID: "my-provider", label: "My Provider", active: true, value: { type: "key", key: "secret" } },
        ],
      })
    }
    return new Response(null, { status: 204 })
  })
  const api = createApi(calls.fetch)

  await removeCustomProvider(api, {
    id: "my-provider",
    name: "My Provider",
    baseURL: "https://api.example/v1",
    modelCount: 0,
    models: {},
  })

  expect(requests).toEqual([
    { method: "GET", path: "/api/credential", body: undefined },
    { method: "DELETE", path: "/api/credential/cred_1", body: undefined },
    { method: "PATCH", path: "/api/experimental/config", body: { providers: { "my-provider": null } } },
  ])
})

test("updateCustomProviderBaseURL ignores an empty URL", async () => {
  const requests: Request[] = []
  const calls = createFetch(async (_url, request) => {
    requests.push(request)
    return new Response(null, { status: 204 })
  })
  const api = createApi(calls.fetch)

  await updateCustomProviderBaseURL(
    api,
    { id: "my-provider", name: "My Provider", modelCount: 0, models: {} },
    " /// ",
  )

  expect(requests).toHaveLength(0)
})

test("extractCustomProviders resolves duplicate provider IDs by last-wins precedence", () => {
  const entries: ConfigEntry[] = [
    {
      type: "document",
      path: "/project/.opencode/opencode.json",
      info: {
        providers: {
          "my-provider": {
            name: "First",
            settings: { baseURL: "https://first.example/v1" },
            models: { "model-a": { name: "Model A" } },
          },
        },
      },
    },
    {
      type: "document",
      path: "/home/.config/opencode/opencode.jsonc",
      info: {
        providers: {
          "my-provider": {
            name: "Second",
            settings: { baseURL: "https://second.example/v1" },
            models: { "model-b": { name: "Model B" } },
          },
        },
      },
    },
  ]

  const providers = extractCustomProviders(entries)

  expect(providers).toHaveLength(1)
  expect(providers[0].id).toBe("my-provider")
  expect(providers[0].name).toBe("Second")
  expect(providers[0].baseURL).toBe("https://second.example/v1")
  expect(providers[0].models).toEqual({ "model-b": { name: "Model B" } })
})
