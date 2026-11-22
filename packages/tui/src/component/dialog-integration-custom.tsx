import type { ConfigEntry } from "@opencode/client"
import type { useClient } from "../context/client"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

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

export function extractCustomProviders(entries: readonly ConfigEntry[] = []): CustomProviderRecord[] {
  const list: CustomProviderRecord[] = []
  for (const entry of entries) {
    if (entry.type !== "document" || !entry.info.providers) continue
    for (const [id, prov] of Object.entries(entry.info.providers)) {
      const index = list.findIndex((item) => item.id === id)
      const provModels = (prov.models ?? {}) as Record<string, { readonly name?: string; readonly type?: string }>
      const modelKeys = Object.keys(provModels)
      const record = {
        id,
        name: prov.name || id,
        baseURL: typeof prov.settings?.baseURL === "string" ? prov.settings.baseURL : undefined,
        apiKey: typeof prov.settings?.apiKey === "string" ? prov.settings.apiKey : undefined,
        modelCount: modelKeys.length,
        models: provModels,
      }
      if (index === -1) list.push(record)
      else list[index] = record // last definition wins (effective/lowest-to-highest precedence)
    }
  }
  return list
}

export async function fetchModelsFromEndpoint(baseURL: string, apiKey?: string): Promise<DiscoveredModel[]> {
  const trimmed = baseURL.trim().replace(/\/+$/, "")
  const urls = trimmed.endsWith("/v1")
    ? [`${trimmed}/models`, `${trimmed.slice(0, -3)}/models`, `${trimmed}/api/tags`]
    : [`${trimmed}/v1/models`, `${trimmed}/models`, `${trimmed}/api/tags`]

  const headers: Record<string, string> = {
    Accept: "application/json",
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
    headers["x-api-key"] = apiKey
  }

  let lastError: Error | undefined
  for (const url of urls) {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(9000),
    }).catch((e: Error) => {
      lastError = e
      return undefined
    })

    if (!res) continue
    if (!res.ok) {
      lastError = new Error(`HTTP ${res.status}: ${res.statusText}`)
      continue
    }

    const data: unknown = await res.json().catch((e: Error) => {
      lastError = e
      return undefined
    })
    const models = parseModelsData(data)
    if (models.length > 0) return models
  }

  if (lastError) throw lastError
  throw new Error("Nenhum modelo foi retornado pelo endpoint")
}

function parseModelsData(data: unknown): DiscoveredModel[] {
  if (!data || typeof data !== "object") return []
  const obj = data as Record<string, unknown>
  const items = Array.isArray(data)
    ? data
    : Array.isArray(obj.data)
      ? obj.data
      : Array.isArray(obj.models)
        ? obj.models
        : []

  const result: DiscoveredModel[] = []
  const seen = new Set<string>()

  for (const item of items) {
    const rawId = typeof item === "string" ? item : (item as Record<string, unknown> | undefined)?.id ?? (item as Record<string, unknown> | undefined)?.name ?? (item as Record<string, unknown> | undefined)?.model
    const id = typeof rawId === "string" ? rawId.trim() : ""
    if (!id || seen.has(id)) continue
    seen.add(id)
    const rawName = typeof item === "object" && item !== null && "name" in item ? (item as Record<string, unknown>).name : undefined
    const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : id
    result.push({ id, name })
  }
  return result
}

export function promptAddCustomProvider(
  dialog: ReturnType<typeof useDialog>,
  entries: readonly ConfigEntry[],
  toast: ReturnType<typeof useToast>,
  api: ReturnType<typeof useClient>["api"],
) {
  dialog.replace(() => (
    <DialogPrompt
      title="Adicionar Provedor Personalizado (1/3)"
      subtitle="Digite o nome ou identificador do provedor (ex: Cosmos, OneAPI, Ollama)"
      placeholder="Ex: Cosmos"
      onConfirm={(nameVal) => {
        const name = nameVal.trim()
        if (!name) return
        const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-")
        promptProviderBaseURL(id, name, dialog, entries, toast, api)
      }}
    />
  ))
}

function promptProviderBaseURL(
  id: string,
  name: string,
  dialog: ReturnType<typeof useDialog>,
  entries: readonly ConfigEntry[],
  toast: ReturnType<typeof useToast>,
  api: ReturnType<typeof useClient>["api"],
) {
  dialog.replace(() => (
    <DialogPrompt
      title={`Endpoint / Base URL (${name}) (2/3)`}
      subtitle="URL base da API (OpenAI-compatible). Ex: https://api.cosmospro.dev/v1"
      placeholder="https://api.cosmospro.dev/v1"
      onCancel={() => promptAddCustomProvider(dialog, entries, toast, api)}
      onConfirm={(urlVal) => {
        const rawUrl = urlVal.trim().replace(/\/+$/, "")
        if (!rawUrl) return
        promptProviderApiKey(id, name, rawUrl, dialog, entries, toast, api)
      }}
    />
  ))
}

function promptProviderApiKey(
  id: string,
  name: string,
  baseURL: string,
  dialog: ReturnType<typeof useDialog>,
  entries: readonly ConfigEntry[],
  toast: ReturnType<typeof useToast>,
  api: ReturnType<typeof useClient>["api"],
) {
  dialog.replace(() => (
    <DialogPrompt
      title={`API Key (${name}) (3/3)`}
      subtitle="Authentication key (leave empty if local/no auth)"
      placeholder="sk-... (optional)"
      onCancel={() => promptProviderBaseURL(id, name, dialog, entries, toast, api)}
      onConfirm={(keyVal) => {
        const apiKey = keyVal.trim() || undefined
        void fetchAndConfirmModels(id, name, baseURL, apiKey, dialog, entries, toast, api)
      }}
    />
  ))
}

async function fetchAndConfirmModels(
  id: string,
  name: string,
  baseURL: string,
  apiKey: string | undefined,
  dialog: ReturnType<typeof useDialog>,
  entries: readonly ConfigEntry[],
  toast: ReturnType<typeof useToast>,
  api: ReturnType<typeof useClient>["api"],
) {
  dialog.replace(() => (
    <DialogPrompt
      title={`Fetching models from ${name}...`}
      subtitle={`Querying endpoint ${baseURL} to list available models...`}
      busy={true}
      busyText="Fetching available models..."
      placeholder=""
    />
  ))

  const models = await fetchModelsFromEndpoint(baseURL, apiKey).catch((err: Error) => err)

  if (models instanceof Error) {
    const errorMsg = errorMessage(models)
    dialog.replace(() => (
      <DialogPrompt
        title="Could not fetch models automatically"
        subtitle={`Error: ${errorMsg}. Enter model IDs manually (comma-separated):`}
        placeholder="gpt-4o, claude-3-5-sonnet, deepseek-chat"
        onCancel={() => dialog.clear()}
        onConfirm={async (manualVal) => {
          const ids = manualVal
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
          if (!ids.length) return
          const modelEntries: Record<string, { readonly name?: string }> = {}
          for (const mId of ids) modelEntries[mId] = { name: mId }
          await saveCustomProvider(api, { id, name, baseURL, apiKey, models: modelEntries })
          toast.show({ variant: "success", message: `Provider "${name}" saved globally with ${ids.length} models (API key in SQLite)!` })
          dialog.clear()
        }}
      />
    ))
    return
  }

  dialog.replace(() => (
    <DialogSelect
      title={`✓ Found ${models.length} models on endpoint!`}
      renderFilter={false}
      options={[
        {
          title: `✓ Import all ${models.length} models`,
          value: "import_all",
          description: `Save provider "${name}" with all retrieved models`,
          onSelect: async () => {
            const modelEntries: Record<string, { readonly name?: string }> = {}
            for (const m of models) {
              modelEntries[m.id] = { name: m.name || m.id }
            }
            await saveCustomProvider(api, { id, name, baseURL, apiKey, models: modelEntries })
            toast.show({ variant: "success", message: `Provider "${name}" saved globally with ${models.length} models (API key in SQLite)!` })
            dialog.clear()
          },
        },
        {
          title: `Models: ${models.slice(0, 6).map((m) => m.name || m.id).join(", ")}${models.length > 6 ? "..." : ""}`,
          value: "preview",
          disabled: true,
          description: "Retrieved model list",
          onSelect: () => {},
        },
        {
          title: "Back / Cancel",
          value: "cancel",
          onSelect: () => dialog.clear(),
        },
      ]}
    />
  ))
}

type ClientApi = ReturnType<typeof useClient>["api"]

export async function saveCustomProviderCredential(
  api: ClientApi,
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

async function migrateLegacyApiKey(api: ClientApi, provider: CustomProviderRecord) {
  if (!provider.apiKey) return
  const existing = await api.credential.list()
  if (existing.some((entry) => entry.integrationID === provider.id)) return
  await api.credential.create({
    integrationID: provider.id,
    label: provider.name,
    value: { type: "key", key: provider.apiKey },
  })
}

async function readCustomProviderApiKey(api: ClientApi, provider: CustomProviderRecord) {
  const existing = await api.credential.list().catch(() => [])
  const match =
    existing.find((entry) => entry.integrationID === provider.id && entry.active && entry.value.type === "key") ??
    existing.find((entry) => entry.integrationID === provider.id && entry.value.type === "key")
  if (match?.value.type === "key") return match.value.key
  return provider.apiKey
}

export async function saveCustomProvider(
  api: ClientApi,
  input: {
    readonly id: string
    readonly name: string
    readonly baseURL: string
    readonly apiKey?: string
    readonly models: Record<string, { readonly name?: string; readonly type?: "chat" | "image" }>
  },
) {
  await api.experimental.config.update({
    providers: {
      [input.id]: {
        name: input.name,
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: input.baseURL },
        models: input.models,
      },
    },
  })
  if (input.apiKey !== undefined) {
    await saveCustomProviderCredential(api, input.id, input.name, input.apiKey)
  }
}

export async function updateCustomProviderApiKey(
  api: ClientApi,
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
  api: ClientApi,
  provider: CustomProviderRecord,
  baseURL: string,
) {
  const rawUrl = baseURL.trim().replace(/\/+$/, "")
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

export async function removeCustomProvider(api: ClientApi, provider: CustomProviderRecord) {
  await saveCustomProviderCredential(api, provider.id, provider.name, undefined)
  await api.experimental.config.update({ providers: { [provider.id]: null } })
}

export function manageCustomProvider(
  provider: CustomProviderRecord,
  dialog: ReturnType<typeof useDialog>,
  toast: ReturnType<typeof useToast>,
  api: ClientApi,
) {
  dialog.replace(() => (
    <DialogSelect
      title={`Custom Provider: ${provider.name}`}
      options={[
        {
          title: "🔄 Refresh models from endpoint",
          value: "refresh",
          description: provider.baseURL
            ? `Query ${provider.baseURL} to update models`
            : "Query endpoint",
          onSelect: () => {
            const baseURL = provider.baseURL
            if (!baseURL) {
              toast.error("Provider has no configured baseURL.")
              return
            }
            void (async () => {
              dialog.replace(() => (
                <DialogPrompt
                  title={`Refreshing models for ${provider.name}...`}
                  subtitle={`Querying endpoint ${baseURL}...`}
                  busy={true}
                  busyText="Refreshing models..."
                  placeholder=""
                />
              ))
              const apiKey = await readCustomProviderApiKey(api, provider)
              const models = await fetchModelsFromEndpoint(baseURL, apiKey).catch(
                (err: Error) => err,
              )
              if (models instanceof Error) {
                toast.error(models)
                dialog.clear()
                return
              }
              const modelEntries: Record<string, { readonly name?: string; readonly type?: "chat" | "image" }> = {}
              for (const m of models) {
                modelEntries[m.id] = m.type === "image" ? { name: m.name || m.id, type: "image" } : { name: m.name || m.id }
              }
              await migrateLegacyApiKey(api, provider)
              await api.experimental.config.update({ providers: { [provider.id]: {
                name: provider.name,
                package: "@opencode/ai/providers/openai-compatible",
                settings: { baseURL },
                models: modelEntries,
              } } })
              toast.show({
                variant: "success",
                message: `Models updated: ${models.length} models imported for "${provider.name}"!`,
              })
              dialog.clear()
            })()
          },
        },
        {
          title: "🔑 Change API Key",
          value: "change_key",
          description: "Update the provider authentication key (stored in local SQLite)",
          onSelect: () => {
            dialog.replace(() => (
              <DialogPrompt
                title={`Change API Key (${provider.name})`}
                subtitle="Enter new authentication key (stored in local SQLite; leave empty to remove)"
                placeholder="sk-..."
                onConfirm={async (keyVal) => {
                  const apiKey = keyVal.trim() || undefined
                  await updateCustomProviderApiKey(api, provider, apiKey)
                  toast.show({ variant: "success", message: `API Key for "${provider.name}" saved in local SQLite!` })
                  dialog.clear()
                }}
              />
            ))
          },
        },
        {
          title: "🌐 Change Endpoint / Base URL",
          value: "change_url",
          description: `Current (${provider.baseURL ?? "not set"})`,
          onSelect: () => {
            dialog.replace(() => (
              <DialogPrompt
                title={`Change Base URL (${provider.name})`}
                subtitle="API Base URL (OpenAI-compatible)"
                value={provider.baseURL ?? ""}
                placeholder="https://..."
                onConfirm={async (urlVal) => {
                  const rawUrl = urlVal.trim().replace(/\/+$/, "")
                  if (!rawUrl) return
                  await updateCustomProviderBaseURL(api, provider, rawUrl)
                  toast.show({
                    variant: "success",
                    message: `Base URL for "${provider.name}" updated globally on this server!`,
                  })
                  dialog.clear()
                }}
              />
            ))
          },
        },
        {
          title: "🗑 Remove Custom Provider",
          value: "remove",
          description: `Remove "${provider.name}", its models, and its SQLite credential`,
          onSelect: () => {
            dialog.replace(() => (
              <DialogSelect
                title={`Remove provider "${provider.name}"?`}
                options={[
                  {
                    title: `Yes, remove "${provider.name}"`,
                    value: "confirm",
                    onSelect: async () => {
                      await removeCustomProvider(api, provider)
                      toast.show({ variant: "success", message: `Provider "${provider.name}" removed from config and local SQLite!` })
                      dialog.clear()
                    },
                  },
                  {
                    title: "Cancel",
                    value: "cancel",
                    onSelect: () => dialog.clear(),
                  },
                ]}
              />
            ))
          },
        },
      ]}
    />
  ))
}
