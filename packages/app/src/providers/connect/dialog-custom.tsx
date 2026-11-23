import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Loader } from "@opencode/ui/loader"
import { TextInput } from "@opencode/ui/text-input"
import { showToast } from "@/shell/notifications/toast"
import {
  type CustomProviderRecord,
  type DiscoveredModel,
  fetchModelsFromEndpoint,
  normalizeProviderBaseURL,
  readCustomProviderApiKey,
  removeCustomProvider,
  saveCustomProvider,
  updateCustomProviderApiKey,
  updateCustomProviderBaseURL,
} from "@opencode/client/custom-provider"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { Component, createSignal, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"

function useSyncLocationData(directory: () => string | undefined) {
  const data = useData()

  return async () => {
    const location = directory() ? { directory: directory()! } : undefined

    await Promise.allSettled([
      data.location.config.sync(location),
      data.location.provider.sync(location),
      data.location.model.sync(location),
      data.location.integration.sync(location),
    ])
  }
}

export const DialogAddCustomProvider: Component<{
  directory?: string
  initial?: CustomProviderRecord
  onClose: () => void
  onSaved?: (providerID: string) => void
}> = (props) => {
  const { tr } = useOnethyI18n()
  const serverSdk = useServerSDK()
  const syncLocationData = useSyncLocationData(() => props.directory)
  const isEditing = () => !!props.initial
  const [showKey, setShowKey] = createSignal(false)

  const initialManual = () => {
    const models = props.initial?.models

    if (models && Object.keys(models).length > 0) return Object.keys(models).join(", ")

    return "claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5, claude-fable-5-1"
  }

  const [form, setForm] = createStore<{
    name: string
    baseURL: string
    apiKey: string
    manualModels: string
    step: "input" | "fetching" | "models" | "error"
    errorMsg: string
    discovered: DiscoveredModel[]
    isSaving: boolean
  }>({
    name: props.initial?.name ?? "",
    baseURL: props.initial?.baseURL ?? "https://api.cosmospro.dev/v1",
    apiKey: "",
    manualModels: initialManual(),
    step: "input",
    errorMsg: "",
    discovered: [],
    isSaving: false,
  })

  onMount(() => {
    const existing = props.initial

    if (!existing) return

    void readCustomProviderApiKey(serverSdk.api, existing)
      .then((key) => {
        if (key) setForm("apiKey", key)
      })
      .catch(() => undefined)
  })

  const handleFetch = async () => {
    const cleanUrl = normalizeProviderBaseURL(form.baseURL)

    if (!cleanUrl) {
      showToast({ title: tr("Enter a valid URL", "Informe uma URL válida"), variant: "error" })

      return
    }

    setForm("step", "fetching")

    try {
      const models = await fetchModelsFromEndpoint(cleanUrl, form.apiKey.trim() || undefined)

      if (models.length > 0) {
        setForm({ discovered: models, step: "models" })

        return
      }

      setForm({
        step: "error",
        errorMsg: "",
      })
    } catch (err) {
      setForm({
        step: "error",
        errorMsg: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleSave = async (modelsToSave?: Record<string, { readonly name?: string }>) => {
    const rawName = form.name.trim()
    const name = rawName || props.initial?.name || "Custom"

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")

    const id = props.initial?.id ?? (slug || "custom")
    const cleanUrl = normalizeProviderBaseURL(form.baseURL)

    if (!cleanUrl) {
      showToast({ title: tr("Enter a valid URL", "Informe uma URL válida"), variant: "error" })

      return
    }

    const apiKey = form.apiKey.trim() || undefined
    setForm("isSaving", true)

    try {
      const modelsRecord: Record<string, { readonly name?: string }> = {}

      if (modelsToSave && Object.keys(modelsToSave).length > 0) {
        Object.assign(modelsRecord, modelsToSave)
      } else if (form.discovered.length > 0) {
        for (const m of form.discovered) modelsRecord[m.id] = { name: m.name || m.id }
      } else {
        const ids = form.manualModels
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)

        for (const mId of ids) modelsRecord[mId] = { name: mId }
      }

      await saveCustomProvider(serverSdk.api, {
        id,
        name,
        baseURL: cleanUrl,
        apiKey,
        models: modelsRecord,
      })

      await syncLocationData()

      showToast({
        title: isEditing()
          ? tr("Provider updated", "Provedor atualizado")
          : tr("Custom provider saved", "Provedor personalizado salvo"),
        description: tr(
          'Provider "{{name}}" configured with {{count}} models.',
          'Provedor "{{name}}" com {{count}} modelos configurado.',
          { name, count: Object.keys(modelsRecord).length },
        ),
        variant: "success",
      })
      props.onSaved?.(id)
      props.onClose()
    } catch (err) {
      showToast({
        title: tr("Error saving provider", "Erro ao salvar provedor"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    } finally {
      setForm("isSaving", false)
    }
  }

  return (
    <Dialog
      fit
      containerClass="!w-[min(calc(100vw_-_32px),560px)] !max-h-[min(calc(100vh_-_48px),680px)] !rounded-[12px] !bg-v2-background-bg-base"
      class="[font-family:var(--v2-font-family-sans)]"
    >
      <DialogHeader closeLabel={tr("Close", "Fechar")}>
        <div class="flex items-start gap-2.5 min-w-0">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-v2-surface-surface-raised border border-v2-border-border-base text-v2-icon-icon-base mt-0.5">
            <Icon name="outline-globe-plus" size="small" />
          </div>
          <DialogTitleGroup
            title={
              isEditing()
                ? tr("Edit Provider: {{name}}", "Editar Provedor: {{name}}", { name: props.initial?.name ?? "" })
                : tr("Add Custom Provider", "Adicionar Provedor Personalizado")
            }
            description={tr(
              "Connect an OpenAI-compatible endpoint (Cosmos, LiteLLM, Ollama, vLLM, OneAPI, etc.)",
              "Conectar endpoint OpenAI-compatible (Cosmos, LiteLLM, Ollama, vLLM, OneAPI, etc.)",
            )}
          />
        </div>
      </DialogHeader>

      <DialogBody class="px-5 py-2 flex flex-col gap-4 overflow-y-auto">
        <Show when={form.step === "input"}>
          <div class="flex flex-col gap-3.5 w-full">
            <div class="flex flex-col gap-1.5 w-full">
              <label class="text-[13px] font-medium text-v2-text-text-base">
                {tr("Name / Identifier", "Nome / Identificador")}
              </label>
              <TextInput
                class="!w-full"
                value={form.name}
                disabled={isEditing()}
                onInput={(e) => setForm("name", e.currentTarget.value)}
                placeholder={tr("e.g., Cosmos, LiteLLM, MyServer", "Ex: Cosmos, LiteLLM, MeuServidor")}
              />
            </div>

            <div class="flex flex-col gap-1.5 w-full">
              <label class="text-[13px] font-medium text-v2-text-text-base">
                {tr("Endpoint Base URL", "Base URL do Endpoint")}
              </label>
              <TextInput
                class="!w-full"
                value={form.baseURL}
                onInput={(e) => setForm("baseURL", e.currentTarget.value)}
                placeholder="https://api.cosmospro.dev/v1"
              />
              <span class="text-[11px] leading-4 text-v2-text-text-faint">
                {tr(
                  "URLs without a protocol automatically receive https://. Suffixes such as /chat/completions are stripped.",
                  "URLs sem protocolo recebem https:// automaticamente. Sufixos como /chat/completions são limpos.",
                )}
              </span>
            </div>

            <div class="flex flex-col gap-1.5 w-full">
              <label class="text-[13px] font-medium text-v2-text-text-base">
                {tr("API Key (Optional)", "API Key (Opcional)")}
              </label>
              <div class="flex items-center gap-1.5 w-full">
                <TextInput
                  class="!w-full flex-1"
                  type={showKey() ? "text" : "password"}
                  value={form.apiKey}
                  onInput={(e) => setForm("apiKey", e.currentTarget.value)}
                  placeholder={tr(
                    "sk-... (stored securely in local SQLite)",
                    "sk-... (armazenada com segurança no SQLite local)",
                  )}
                />
                <IconButton
                  type="button"
                  variant="ghost-muted"
                  icon={<Icon name={showKey() ? "outline-eye-slash" : "outline-eye"} size="small" />}
                  aria-label={showKey() ? tr("Hide API Key", "Ocultar API Key") : tr("Show API Key", "Mostrar API Key")}
                  onClick={() => setShowKey((v) => !v)}
                />
              </div>
            </div>
          </div>
        </Show>

        <Show when={form.step === "fetching"}>
          <div class="flex flex-col items-center justify-center gap-3 py-10 w-full">
            <Loader class="size-6" />
            <span class="text-[14px] text-v2-text-text-base font-medium">
              {tr("Fetching models from endpoint...", "Buscando modelos no endpoint...")}
            </span>
            <span class="text-[12px] text-v2-text-text-muted font-mono break-all text-center">{form.baseURL}</span>
          </div>
        </Show>

        <Show when={form.step === "models"}>
          <div class="flex flex-col gap-3 w-full">
            <div class="flex items-center gap-2">
              <Icon name="circle-check" size="small" class="text-emerald-500 shrink-0" />
              <span class="text-[13px] font-medium text-v2-text-text-base">
                {tr(
                  "Found {{count}} model(s) on endpoint:",
                  "Encontrados {{count}} modelo(s) no endpoint:",
                  { count: form.discovered.length },
                )}
              </span>
            </div>
            <div class="max-h-56 overflow-y-auto rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised p-2.5 flex flex-wrap gap-1.5">
              <For each={form.discovered}>
                {(m) => (
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-v2-overlay-simple-overlay-hover text-v2-text-text-base border border-v2-border-border-faint">
                    {m.name || m.id}
                  </span>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={form.step === "error"}>
          <div class="flex flex-col gap-3.5 w-full">
            <div class="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-[12px] text-red-500 dark:text-red-400">
              <span class="font-semibold block mb-0.5">
                {tr("Could not fetch models automatically:", "Não foi possível buscar os modelos automaticamente:")}
              </span>
              <span class="break-words">
                {form.errorMsg ||
                  tr("No models were returned by the endpoint.", "Nenhum modelo foi retornado pelo endpoint.")}
              </span>
            </div>
            <div class="flex flex-col gap-1.5 w-full">
              <label class="text-[13px] font-medium text-v2-text-text-base">
                {tr(
                  "Enter model IDs manually (comma-separated):",
                  "Inserir IDs dos modelos manualmente (separados por vírgula):",
                )}
              </label>
              <TextInput
                class="!w-full"
                value={form.manualModels}
                onInput={(e) => setForm("manualModels", e.currentTarget.value)}
                placeholder="claude-opus-5-5, claude-sonnet-5-5, gpt-4o"
              />
            </div>
          </div>
        </Show>
      </DialogBody>

      <DialogFooter>
        <Show when={form.step === "input"}>
          <Button variant="ghost" onClick={props.onClose}>
            {tr("Cancel", "Cancelar")}
          </Button>
          <Show when={isEditing()}>
            <Button variant="neutral" disabled={form.isSaving} onClick={() => void handleSave(props.initial?.models)}>
              {form.isSaving ? tr("Saving...", "Salvando...") : tr("Save Changes", "Salvar Alterações")}
            </Button>
          </Show>
          <Button variant="submit" onClick={() => void handleFetch()}>
            {tr("Fetch Models & Connect", "Puxar Modelos & Conectar")}
          </Button>
        </Show>

        <Show when={form.step === "fetching"}>
          <Button variant="ghost" onClick={() => setForm("step", "input")}>
            {tr("Cancel", "Cancelar")}
          </Button>
        </Show>

        <Show when={form.step === "models"}>
          <Button variant="ghost" onClick={() => setForm("step", "input")}>
            {tr("Back", "Voltar")}
          </Button>
          <Button variant="submit" disabled={form.isSaving} onClick={() => void handleSave()}>
            {form.isSaving
              ? tr("Saving...", "Salvando...")
              : tr("Import all {{count}} models", "Importar todos os {{count}} modelos", {
                  count: form.discovered.length,
                })}
          </Button>
        </Show>

        <Show when={form.step === "error"}>
          <Button variant="ghost" onClick={() => setForm("step", "input")}>
            {tr("Back", "Voltar")}
          </Button>
          <Button variant="submit" disabled={form.isSaving} onClick={() => void handleSave()}>
            {form.isSaving
              ? tr("Saving...", "Salvando...")
              : tr("Save Provider with These Models", "Salvar Provedor com estes Modelos")}
          </Button>
        </Show>
      </DialogFooter>
    </Dialog>
  )
}

export const DialogManageCustomProvider: Component<{
  provider: CustomProviderRecord
  directory?: string
  onClose: () => void
}> = (props) => {
  const { tr } = useOnethyI18n()
  const serverSdk = useServerSDK()
  const syncLocationData = useSyncLocationData(() => props.directory)

  const [showKey, setShowKey] = createSignal(false)
  const [confirmRemove, setConfirmRemove] = createSignal(false)

  const [state, setState] = createStore<{
    baseURL: string
    apiKey: string
    manualModels: string
    currentModels: Record<string, { readonly name?: string; readonly type?: string }>
    busy: "url" | "key" | "fetch" | "models" | "remove" | undefined
    fetchError?: { readonly kind: "empty" } | { readonly kind: "message"; readonly text: string }
  }>({
    baseURL: props.provider.baseURL ?? "",
    apiKey: "",
    manualModels: Object.keys(props.provider.models).join(", "),
    currentModels: { ...props.provider.models },
    busy: undefined,
  })

  onMount(() => {
    void readCustomProviderApiKey(serverSdk.api, props.provider)
      .then((key) => {
        if (key) setState("apiKey", key)
      })
      .catch(() => undefined)
  })

  const currentRecord = (): CustomProviderRecord => ({
    ...props.provider,
    baseURL: normalizeProviderBaseURL(state.baseURL) || props.provider.baseURL,
    models: state.currentModels,
    modelCount: Object.keys(state.currentModels).length,
  })

  const handleSaveURL = async () => {
    const cleanUrl = normalizeProviderBaseURL(state.baseURL)

    if (!cleanUrl) {
      showToast({ title: tr("Enter a valid URL", "Informe uma URL válida"), variant: "error" })

      return
    }

    setState("busy", "url")

    try {
      await updateCustomProviderBaseURL(serverSdk.api, currentRecord(), cleanUrl)
      setState("baseURL", cleanUrl)
      await syncLocationData()
      showToast({
        title: tr("Base URL updated", "Base URL atualizada"),
        description: cleanUrl,
        variant: "success",
      })
    } catch (err) {
      showToast({
        title: tr("Error updating Base URL", "Erro ao atualizar Base URL"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    } finally {
      setState("busy", undefined)
    }
  }

  const handleSaveApiKey = async (clear = false) => {
    setState("busy", "key")

    try {
      const nextKey = clear ? undefined : state.apiKey.trim() || undefined
      await updateCustomProviderApiKey(serverSdk.api, currentRecord(), nextKey)

      if (clear) setState("apiKey", "")

      await syncLocationData()
      showToast({
        title: clear ? tr("API Key removed", "API Key removida") : tr("API Key updated", "API Key atualizada"),
        description: clear
          ? tr("The local credential was deleted from SQLite.", "A credencial local foi apagada do SQLite.")
          : tr("Credential saved securely in local SQLite.", "Credencial salva com segurança no SQLite local."),
        variant: "success",
      })
    } catch (err) {
      showToast({
        title: tr("Error updating API Key", "Erro ao atualizar API Key"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    } finally {
      setState("busy", undefined)
    }
  }

  const handleFetchModels = async () => {
    const cleanUrl = normalizeProviderBaseURL(state.baseURL)

    if (!cleanUrl) {
      showToast({
        title: tr("Enter a valid Base URL first", "Informe uma Base URL válida primeiro"),
        variant: "error",
      })

      return
    }

    setState({ busy: "fetch", fetchError: undefined })

    try {
      const key = state.apiKey.trim() || (await readCustomProviderApiKey(serverSdk.api, props.provider))
      const models = await fetchModelsFromEndpoint(cleanUrl, key)

      if (models.length === 0) {
        setState("fetchError", { kind: "empty" })

        return
      }

      const nextModels: Record<string, { readonly name?: string; readonly type?: "chat" | "image" }> = {}

      for (const m of models) nextModels[m.id] = { name: m.name || m.id, type: m.type }

      await saveCustomProvider(serverSdk.api, {
        id: props.provider.id,
        name: props.provider.name,
        baseURL: cleanUrl,
        apiKey: state.apiKey.trim() || undefined,
        models: nextModels,
      })

      setState({
        baseURL: cleanUrl,
        currentModels: nextModels,
        manualModels: Object.keys(nextModels).join(", "),
      })
      await syncLocationData()
      showToast({
        title: tr("Fetched {{count}} model(s) from {{name}}", "{{count}} modelo(s) puxados de {{name}}", {
          count: models.length,
          name: props.provider.name,
        }),
        variant: "success",
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState("fetchError", { kind: "message", text: message })
      showToast({
        title: tr("Error fetching models", "Erro ao puxar modelos"),
        description: message,
        variant: "error",
      })
    } finally {
      setState("busy", undefined)
    }
  }

  const handleSaveManualModels = async () => {
    const cleanUrl = normalizeProviderBaseURL(state.baseURL) || props.provider.baseURL || ""
    const ids = state.manualModels
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)

    if (ids.length === 0) {
      showToast({ title: tr("Enter at least one model ID", "Informe pelo menos um ID de modelo"), variant: "error" })

      return
    }

    setState("busy", "models")

    try {
      const nextModels: Record<string, { readonly name?: string }> = {}

      for (const id of ids) nextModels[id] = { name: id }

      await saveCustomProvider(serverSdk.api, {
        id: props.provider.id,
        name: props.provider.name,
        baseURL: cleanUrl,
        models: nextModels,
      })

      setState("currentModels", nextModels)
      await syncLocationData()
      showToast({
        title: tr("{{count}} model(s) saved manually", "{{count}} modelo(s) salvos manualmente", {
          count: ids.length,
        }),
        variant: "success",
      })
    } catch (err) {
      showToast({
        title: tr("Error saving models", "Erro ao salvar modelos"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    } finally {
      setState("busy", undefined)
    }
  }

  const handleRemoveProvider = async () => {
    setState("busy", "remove")

    try {
      await removeCustomProvider(serverSdk.api, props.provider)
      await syncLocationData()
      showToast({
        title: tr('Provider "{{name}}" removed', 'Provedor "{{name}}" removido', { name: props.provider.name }),
        description: tr(
          "Configuration and local credentials removed.",
          "Configuração e credenciais locais removidas.",
        ),
        variant: "success",
      })
      props.onClose()
    } catch (err) {
      showToast({
        title: tr("Error removing provider", "Erro ao remover provedor"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    } finally {
      setState("busy", undefined)
    }
  }

  const modelEntries = () => Object.entries(state.currentModels)

  const fetchErrorText = () => {
    const current = state.fetchError
    if (!current) return undefined
    if (current.kind === "empty") {
      return tr(
        "The endpoint responded, but returned no models.",
        "O endpoint respondeu, mas não retornou nenhum modelo.",
      )
    }
    return current.text
  }

  return (
    <Dialog
      size="large"
      containerClass="!w-[min(calc(100vw_-_32px),640px)] !h-[min(calc(100vh_-_48px),620px)] !rounded-[12px] !bg-v2-background-bg-base"
      class="[font-family:var(--v2-font-family-sans)]"
    >
      <DialogHeader closeLabel={tr("Close", "Fechar")}>
        <div class="flex items-start gap-2.5 min-w-0">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-v2-surface-surface-raised border border-v2-border-border-base text-v2-icon-icon-base mt-0.5">
            <Icon name="outline-globe" size="small" />
          </div>
          <DialogTitleGroup
            title={tr("Manage Provider: {{name}}", "Gerenciar Provedor: {{name}}", { name: props.provider.name })}
            description={tr(
              "Update Base URL, API Key, fetch new models from the endpoint, or remove the provider",
              "Atualize Base URL, API Key, puxe novos modelos do endpoint ou remova o provedor",
            )}
          />
        </div>
      </DialogHeader>

      <DialogBody class="px-5 py-2 flex flex-col flex-1 min-h-0 gap-4 overflow-y-auto">
        {/* Base URL Section */}
        <div class="flex flex-col gap-2 p-3 rounded-lg bg-v2-surface-surface-raised border border-v2-border-border-base">
          <div class="flex items-center gap-1.5 text-xs font-semibold text-v2-text-text-base">
            <Icon name="outline-globe" size="small" class="text-v2-icon-icon-muted" />
            <span>{tr("Endpoint Base URL", "Base URL do Endpoint")}</span>
          </div>
          <div class="flex items-center gap-2">
            <TextInput
              class="!w-full flex-1"
              value={state.baseURL}
              onInput={(e) => setState("baseURL", e.currentTarget.value)}
              placeholder={tr("https://api.example.com/v1", "https://api.exemplo.com/v1")}
            />
            <Button
              size="normal"
              variant="neutral"
              disabled={state.busy !== undefined}
              onClick={() => void handleSaveURL()}
            >
              {state.busy === "url" ? tr("Saving...", "Salvando...") : tr("Save URL", "Salvar URL")}
            </Button>
          </div>
        </div>

        {/* API Key Section */}
        <div class="flex flex-col gap-2 p-3 rounded-lg bg-v2-surface-surface-raised border border-v2-border-border-base">
          <div class="flex items-center gap-1.5 text-xs font-semibold text-v2-text-text-base">
            <Icon name="lock" size="small" class="text-v2-icon-icon-muted" />
            <span>{tr("API Key (stored in local SQLite)", "API Key (armazenada no SQLite local)")}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <TextInput
              class="!w-full flex-1"
              type={showKey() ? "text" : "password"}
              value={state.apiKey}
              onInput={(e) => setState("apiKey", e.currentTarget.value)}
              placeholder="sk-..."
            />
            <IconButton
              type="button"
              variant="ghost-muted"
              icon={<Icon name={showKey() ? "outline-eye-slash" : "outline-eye"} size="small" />}
              aria-label={showKey() ? tr("Hide API Key", "Ocultar API Key") : tr("Show API Key", "Mostrar API Key")}
              onClick={() => setShowKey((v) => !v)}
            />
            <Button
              size="normal"
              variant="neutral"
              disabled={state.busy !== undefined}
              onClick={() => void handleSaveApiKey(false)}
            >
              {state.busy === "key" ? tr("Saving...", "Salvando...") : tr("Save Key", "Salvar Key")}
            </Button>
            <Button
              size="normal"
              variant="ghost-muted"
              disabled={state.busy !== undefined || !state.apiKey}
              onClick={() => void handleSaveApiKey(true)}
            >
              {tr("Clear", "Limpar")}
            </Button>
          </div>
        </div>

        {/* Models Section */}
        <div class="flex flex-col gap-2.5 p-3 rounded-lg bg-v2-surface-surface-raised border border-v2-border-border-base">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <Icon name="models" size="small" class="text-v2-icon-icon-muted" />
              <span class="text-xs font-semibold text-v2-text-text-base">
                {tr("Available Models", "Modelos Disponíveis")}
              </span>
              <Badge>{modelEntries().length}</Badge>
            </div>
            <Button
              size="small"
              variant="submit"
              disabled={state.busy !== undefined}
              onClick={() => void handleFetchModels()}
            >
              <Show
                when={state.busy === "fetch"}
                fallback={
                  <span class="inline-flex items-center gap-1.5">
                    <Icon name="outline-rotate-clockwise" size="small" />
                    <span>{tr("Fetch Models from Endpoint", "Puxar Modelos do Endpoint")}</span>
                  </span>
                }
              >
                <span class="inline-flex items-center gap-1.5">
                  <Loader class="size-3.5" />
                  <span>{tr("Fetching...", "Buscando...")}</span>
                </span>
              </Show>
            </Button>
          </div>

          <Show when={fetchErrorText()}>
            {(err) => (
              <div class="rounded-md bg-red-500/10 border border-red-500/20 p-2.5 text-[11px] text-red-500 dark:text-red-400 break-words">
                {err()}
              </div>
            )}
          </Show>

          <Show when={modelEntries().length > 0}>
            <div class="max-h-28 overflow-y-auto rounded border border-v2-border-border-faint bg-v2-background-bg-base p-2 flex flex-wrap gap-1">
              <For each={modelEntries()}>
                {([id, info]) => (
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-v2-overlay-simple-overlay-hover text-v2-text-text-base">
                    {info.name || id}
                  </span>
                )}
              </For>
            </div>
          </Show>

          <div class="flex flex-col gap-1.5 pt-1">
            <label class="text-[11px] text-v2-text-text-muted">
              {tr("Manual list of IDs (comma-separated):", "Lista manual de IDs (separados por vírgula):")}
            </label>
            <div class="flex items-center gap-2">
              <TextInput
                class="!w-full flex-1"
                value={state.manualModels}
                onInput={(e) => setState("manualModels", e.currentTarget.value)}
                placeholder="claude-opus-5-5, gpt-4o"
              />
              <Button
                size="normal"
                variant="neutral"
                disabled={state.busy !== undefined}
                onClick={() => void handleSaveManualModels()}
              >
                {state.busy === "models" ? tr("Saving...", "Salvando...") : tr("Save List", "Salvar Lista")}
              </Button>
            </div>
          </div>
        </div>

        {/* Danger Zone: Remove Provider */}
        <div class="flex items-center justify-between gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
          <div class="flex flex-col min-w-0">
            <span class="text-xs font-semibold text-red-600 dark:text-red-400">
              {tr("Remove Custom Provider", "Remover Provedor Personalizado")}
            </span>
            <span class="text-[11px] text-v2-text-text-muted">
              {tr(
                "Removes this provider, its models, and its local API Key from SQLite.",
                "Remove este provedor, seus modelos e sua API Key local do SQLite.",
              )}
            </span>
          </div>
          <Show
            when={confirmRemove()}
            fallback={
              <Button
                size="normal"
                variant="ghost-danger"
                disabled={state.busy !== undefined}
                onClick={() => setConfirmRemove(true)}
              >
                <span class="inline-flex items-center gap-1.5">
                  <Icon name="outline-trash" size="small" />
                  <span>{tr("Remove", "Remover")}</span>
                </span>
              </Button>
            }
          >
            <div class="flex items-center gap-1.5 shrink-0">
              <Button size="small" variant="ghost" onClick={() => setConfirmRemove(false)}>
                {tr("Cancel", "Cancelar")}
              </Button>
              <Button
                size="small"
                variant="danger"
                disabled={state.busy !== undefined}
                onClick={() => void handleRemoveProvider()}
              >
                {state.busy === "remove"
                  ? tr("Removing...", "Removendo...")
                  : tr("Confirm Removal", "Confirmar Remoção")}
              </Button>
            </div>
          </Show>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="submit" onClick={props.onClose}>
          {tr("Done", "Concluir")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
