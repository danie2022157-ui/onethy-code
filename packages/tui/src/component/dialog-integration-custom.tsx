import {
  type ConfigEntry,
  type CustomProviderRecord,
  type DiscoveredModel,
  extractCustomProviders,
  fetchModelsFromEndpoint,
  normalizeProviderBaseURL,
  parseModelsData,
  saveCustomProvider,
  updateCustomProviderApiKey,
  updateCustomProviderBaseURL,
  removeCustomProvider,
  saveCustomProviderCredential,
  migrateLegacyApiKey,
  readCustomProviderApiKey,
} from "@opencode/client"
import type { useClient } from "../context/client"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

export {
  type CustomProviderRecord,
  type DiscoveredModel,
  extractCustomProviders,
  fetchModelsFromEndpoint,
  normalizeProviderBaseURL,
  parseModelsData,
  saveCustomProvider,
  updateCustomProviderApiKey,
  updateCustomProviderBaseURL,
  removeCustomProvider,
  saveCustomProviderCredential,
  migrateLegacyApiKey,
  readCustomProviderApiKey,
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
        const rawUrl = normalizeProviderBaseURL(urlVal)
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
        const apiKey =
          keyVal
            .replace(/[\r\n\t]+/g, "")
            .trim()
            .replace(/^["']+|["']+$/g, "")
            .trim()
            .replace(/^Bearer\s+/i, "")
            .trim() || undefined
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
        value="claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5, claude-fable-5-1"
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
