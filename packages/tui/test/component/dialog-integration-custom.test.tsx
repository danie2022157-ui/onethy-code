import { expect, test } from "bun:test"
import type { ConfigEntry } from "@opencode/client"
import { extractCustomProviders, updateCustomProviderBaseURL } from "../../src/component/dialog-integration-custom"
import { createApi, createFetch } from "../fixture/tui-client"

test("updateCustomProviderBaseURL updates the server config and preserves provider fields", async () => {
  const requests: { url: URL; request: Request }[] = []
  const calls = createFetch(async (url, request) => {
    requests.push({ url, request })
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

  expect(requests).toHaveLength(1)
  expect(requests[0].url.pathname).toBe("/api/experimental/config")
  expect(requests[0].request.method).toBe("PATCH")
  expect(await requests[0].request.json()).toEqual({
    providers: {
      "my-provider": {
        name: "My Provider",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: "https://new.example/v1", apiKey: "secret" },
        models: { "model-a": { name: "Model A" } },
      },
    },
  })
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
