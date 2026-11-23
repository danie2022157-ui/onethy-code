import type { ConfigEntry } from "./promise/generated/types.js"
export { classifyModelBucket, type ModelBucket } from "./fusion.js"

export interface DiscoveredModel {
  readonly id: string
  readonly name: string
  readonly type?: "chat" | "image"
}

export interface CustomProviderRecord {
  readonly id: string
  readonly name: string
  readonly baseURL?: string
  readonly apiKey?: string
  readonly modelCount: number
  readonly models: Record<string, { readonly name?: string; readonly type?: string }>
}

export interface CustomProviderClientApi {
  readonly credential: {
    readonly list: () => Promise<
      readonly {
        readonly id: string
        readonly integrationID: string
        readonly label: string
        readonly active: boolean
        readonly value: { readonly type: string; readonly key?: string }
      }[]
    >
    readonly create: (input: {
      readonly integrationID: string
      readonly label: string
      readonly value: { readonly type: "key"; readonly key: string }
    }) => Promise<unknown>
    readonly remove: (input: { readonly credentialID: string }) => Promise<unknown>
  }
  readonly experimental: {
    readonly config: {
      readonly update: (input?: any, requestOptions?: any) => Promise<unknown>
    }
  }
}

export function extractCustomProviders(entries: readonly ConfigEntry[] = []): CustomProviderRecord[] {
  const list: CustomProviderRecord[] = []
  for (const entry of entries) {
    if (entry.type !== "document" || !entry.info.providers) continue
    for (const [id, rawProv] of Object.entries(entry.info.providers)) {
      const prov = (rawProv ?? {}) as {
        name?: string
        models?: Record<string, { readonly name?: string; readonly type?: string }>
        settings?: { baseURL?: string; apiKey?: string }
      }
      const index = list.findIndex((item) => item.id === id)
      const provModels = (prov.models ?? {}) as Record<string, { readonly name?: string; readonly type?: string }>
      const modelKeys = Object.keys(provModels)
      const record: CustomProviderRecord = {
        id,
        name: prov.name || id,
        baseURL: typeof prov.settings?.baseURL === "string" ? prov.settings.baseURL : undefined,
        apiKey: typeof prov.settings?.apiKey === "string" ? prov.settings.apiKey : undefined,
        modelCount: modelKeys.length,
        models: provModels,
      }
      if (index === -1) list.push(record)
      else list[index] = record
    }
  }
  return list
}

export function normalizeProviderBaseURL(baseURL: string): string {
  let normalized = baseURL
    .replace(/[\r\n\t]+/g, "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim()
    .replace(/\/+$/, "")
  if (!normalized) return ""
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(\/|$)/i.test(normalized)
      ? `http://${normalized}`
      : `https://${normalized}`
  }
  return normalized
    .replace(/\/(?:chat\/completions|completions|responses|messages|models)$/i, "")
    .replace(/\/+$/, "")
}

export async function fetchModelsFromEndpoint(baseURL: string, apiKey?: string): Promise<DiscoveredModel[]> {
  const rawCleaned = baseURL
    .replace(/[\r\n\t]+/g, "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim()
    .replace(/\/+$/, "")
  const normalized = normalizeProviderBaseURL(rawCleaned)
  if (!normalized) throw new Error("Empty endpoint URL")

  const baseWithoutV1 = normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized
  const candidates = normalized.endsWith("/v1")
    ? [
        `${normalized}/models`,
        `${baseWithoutV1}/models`,
        `${normalized}/model/info`,
        `${baseWithoutV1}/model/info`,
        `${baseWithoutV1}/api/tags`,
        `${normalized}/api/tags`,
      ]
    : [
        `${normalized}/v1/models`,
        `${normalized}/models`,
        `${normalized}/v1/model/info`,
        `${normalized}/model/info`,
        `${normalized}/api/tags`,
        `${normalized}/api/v1/models`,
      ]
  const directModelsUrl = /\/models$/i.test(rawCleaned)
    ? /^https?:\/\//i.test(rawCleaned)
      ? rawCleaned
      : `https://${rawCleaned}`
    : undefined
  const urls = [...new Set([directModelsUrl, ...candidates].filter((u): u is string => Boolean(u)))]

  const cleanKey = apiKey
    ?.replace(/[\r\n\t]+/g, "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim()

  const baseHeaders: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "OnethyCode/2.2.2",
  }

  const headerStrategies: Record<string, string>[] = cleanKey
    ? [
        { ...baseHeaders, Authorization: `Bearer ${cleanKey}` },
        { ...baseHeaders, "x-api-key": cleanKey, "anthropic-version": "2023-06-01" },
        { ...baseHeaders, Authorization: `Bearer ${cleanKey}`, "x-api-key": cleanKey, "api-key": cleanKey },
        { ...baseHeaders },
      ]
    : [{ ...baseHeaders }]

  let bestError: Error | undefined
  for (const url of urls) {
    for (let i = 0; i < headerStrategies.length; i++) {
      const headers = headerStrategies[i]
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10000),
      }).catch((e: Error) => {
        if (!bestError) bestError = e
        return undefined
      })

      if (!res) break
      if (!res.ok) {
        const errBody: unknown = await res.json().catch(() => undefined)
        const apiMsg =
          typeof errBody === "object" &&
          errBody !== null &&
          "error" in errBody &&
          typeof (errBody as { error?: unknown }).error === "object" &&
          (errBody as { error?: { message?: unknown } }).error !== null &&
          typeof (errBody as { error: { message?: unknown } }).error.message === "string"
            ? (errBody as { error: { message: string } }).error.message
            : typeof errBody === "object" &&
                errBody !== null &&
                "message" in errBody &&
                typeof (errBody as { message?: unknown }).message === "string"
              ? (errBody as { message: string }).message
              : typeof errBody === "object" &&
                  errBody !== null &&
                  "detail" in errBody &&
                  typeof (errBody as { detail?: unknown }).detail === "string"
                ? (errBody as { detail: string }).detail
                : undefined
        const statusError = new Error(
          apiMsg ? `HTTP ${res.status}: ${apiMsg}` : `HTTP ${res.status}: ${res.statusText || "Request failed"}`,
        )
        if (!bestError || res.status === 401 || res.status === 403 || res.status >= 500) {
          bestError = statusError
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          continue
        }
        break
      }

      const data: unknown = await res.json().catch((e: Error) => {
        if (!bestError) bestError = e
        return undefined
      })
      const models = parseModelsData(data)
      if (models.length > 0) return models
      break
    }
  }

  if (bestError) throw bestError
  throw new Error("No models were returned by the endpoint")
}

export function parseModelsData(data: unknown): DiscoveredModel[] {
  if (!data || typeof data !== "object") return []
  const obj = data as Record<string, unknown>
  const nestedData =
    typeof obj.data === "object" && obj.data !== null && !Array.isArray(obj.data)
      ? (obj.data as Record<string, unknown>)
      : undefined
  const items = Array.isArray(data)
    ? data
    : Array.isArray(obj.data)
      ? obj.data
      : Array.isArray(obj.models)
        ? obj.models
        : Array.isArray(obj.items)
          ? obj.items
          : Array.isArray(obj.result)
            ? obj.result
            : nestedData && Array.isArray(nestedData.models)
              ? nestedData.models
              : nestedData && Array.isArray(nestedData.data)
                ? nestedData.data
                : typeof obj.models === "object" && obj.models !== null
                  ? Object.entries(obj.models as Record<string, unknown>).map(([k, v]) =>
                      typeof v === "object" && v !== null ? { id: k, ...(v as Record<string, unknown>) } : k,
                    )
                  : []

  const result: DiscoveredModel[] = []
  const seen = new Set<string>()

  for (const item of items) {
    const rec = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : undefined
    const rawId =
      typeof item === "string"
        ? item
        : rec?.id ?? rec?.model_id ?? rec?.model_name ?? rec?.name ?? rec?.model ?? rec?.key
    const id = typeof rawId === "string" ? rawId.trim().replace(/^models\//, "") : ""
    if (!id || seen.has(id)) continue
    seen.add(id)
    const rawName = rec?.display_name ?? rec?.model_name ?? rec?.name ?? rec?.id
    const name = typeof rawName === "string" && rawName.trim() ? rawName.trim().replace(/^models\//, "") : id
    result.push({ id, name })
  }
  return result
}

export async function saveCustomProviderCredential(
  api: CustomProviderClientApi,
  providerID: string,
  label: string,
  apiKey: string | undefined,
) {
  const existing = await api.credential.list()
  for (const entry of existing) {
    if (entry.integrationID !== providerID) continue
    await api.credential.remove({ credentialID: entry.id })
  }
  if (!apiKey) return
  await api.credential.create({
    integrationID: providerID,
    label,
    value: { type: "key", key: apiKey },
  })
}

export async function migrateLegacyApiKey(api: CustomProviderClientApi, provider: CustomProviderRecord) {
  if (!provider.apiKey) return
  const existing = await api.credential.list()
  if (existing.some((entry) => entry.integrationID === provider.id)) return
  await api.credential.create({
    integrationID: provider.id,
    label: provider.name,
    value: { type: "key", key: provider.apiKey },
  })
}

export async function readCustomProviderApiKey(api: CustomProviderClientApi, provider: CustomProviderRecord) {
  const existing = await api.credential.list().catch(() => [])
  const match =
    existing.find((entry) => entry.integrationID === provider.id && entry.active && entry.value.type === "key") ??
    existing.find((entry) => entry.integrationID === provider.id && entry.value.type === "key")
  if (match?.value.type === "key") return match.value.key
  return provider.apiKey
}

export async function saveCustomProvider(
  api: CustomProviderClientApi,
  input: {
    readonly id: string
    readonly name: string
    readonly baseURL: string
    readonly apiKey?: string
    readonly models: Record<string, { readonly name?: string; readonly type?: "chat" | "image" }>
  },
) {
  const normalizedBaseURL = normalizeProviderBaseURL(input.baseURL) || input.baseURL
  await api.experimental.config.update({
    providers: {
      [input.id]: {
        name: input.name,
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: normalizedBaseURL },
        models: input.models,
      },
    },
  })
  if (input.apiKey !== undefined) {
    await saveCustomProviderCredential(api, input.id, input.name, input.apiKey)
  }
}

export async function updateCustomProviderApiKey(
  api: CustomProviderClientApi,
  provider: CustomProviderRecord,
  apiKey: string | undefined,
) {
  await saveCustomProviderCredential(api, provider.id, provider.name, apiKey)
  if (!provider.apiKey) return
  await api.experimental.config.update({
    providers: {
      [provider.id]: {
        name: provider.name,
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: provider.baseURL ?? "" },
        models: provider.models,
      },
    },
  })
}

export async function updateCustomProviderBaseURL(
  api: CustomProviderClientApi,
  provider: CustomProviderRecord,
  baseURL: string,
) {
  const rawUrl = normalizeProviderBaseURL(baseURL)
  if (!rawUrl) return
  await migrateLegacyApiKey(api, provider)
  await api.experimental.config.update({
    providers: {
      [provider.id]: {
        name: provider.name,
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: rawUrl },
        models: provider.models,
      },
    },
  })
}

export async function removeCustomProvider(api: CustomProviderClientApi, provider: CustomProviderRecord | string) {
  const id = typeof provider === "string" ? provider : provider.id
  const name = typeof provider === "string" ? provider : provider.name
  await saveCustomProviderCredential(api, id, name, undefined)
  await api.experimental.config.update({ providers: { [id]: null } })
}
