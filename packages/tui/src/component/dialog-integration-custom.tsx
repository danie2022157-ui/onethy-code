import type { ConfigEntry } from "@opencode/client"
import { applyEdits, modify, parse } from "jsonc-parser"
import path from "path"
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

export function isLikelyImageModel(id: string, name?: string): boolean {
  const target = `${id} ${name ?? ""}`.toLowerCase()
  return (
    /dall-?e|flux|stable-diffusion|\bsdxl\b|\bsd3\b|\bsd-|\bimagen\b|midjourney|ideogram|recraft|kandinsky|playground-v|bfl\/|lumina|kolors|cogview|aurora|wanx|text-to-image|image-generation/i.test(
      target,
    )
  )
}

export interface CustomProviderRecord {
  readonly id: string
  readonly name: string
  readonly baseURL?: string
  readonly apiKey?: string
  readonly modelCount: number
  readonly imageModelCount: number
  readonly filePath: string
  readonly models: Record<string, { readonly name?: string; readonly type?: string }>
}

export function targetConfigFile(entries: readonly ConfigEntry[] = []): string {
  const docs = entries.flatMap((entry) =>
    entry.type === "document" && entry.path && /\.jsonc?$/i.test(entry.path) ? [entry.path] : [],
  )
  if (docs.length > 0) return docs[docs.length - 1]

  const home = process.env.USERPROFILE || process.env.HOME || ""
  const configDir = process.env.XDG_CONFIG_HOME || (home ? path.join(home, ".config") : "")
  return path.join(configDir, "opencode", "opencode.json")
}

export function extractCustomProviders(entries: readonly ConfigEntry[] = []): CustomProviderRecord[] {
  const list: CustomProviderRecord[] = []
  for (const entry of entries) {
    if (entry.type !== "document" || !entry.path || !entry.info.providers) continue
    for (const [id, prov] of Object.entries(entry.info.providers)) {
      if (list.some((item) => item.id === id)) continue
      const provModels = (prov.models ?? {}) as Record<string, { readonly name?: string; readonly type?: string }>
      const modelKeys = Object.keys(provModels)
      const imageCount = modelKeys.filter((k) => provModels[k]?.type === "image").length
      list.push({
        id,
        name: prov.name || id,
        baseURL: typeof prov.settings?.baseURL === "string" ? prov.settings.baseURL : undefined,
        apiKey: typeof prov.settings?.apiKey === "string" ? prov.settings.apiKey : undefined,
        modelCount: modelKeys.length,
        imageModelCount: imageCount,
        filePath: entry.path,
        models: provModels,
      })
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
    const type = (typeof item === "object" && item !== null && (item as Record<string, unknown>).type === "image") || isLikelyImageModel(id, name)
      ? "image"
      : undefined
    result.push({ id, name, type })
  }
  return result
}

export async function saveCustomProviderToConfig(
  filePath: string,
  providerID: string,
  providerInfo: {
    readonly name: string
    readonly package: string
    readonly settings: {
      readonly baseURL: string
      readonly apiKey?: string
    }
    readonly models: Record<string, { readonly name?: string; readonly type?: "chat" | "image" }>
  },
) {
  const file = Bun.file(filePath)
  const exists = await file.exists()
  const content = exists ? await file.text() : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n'
  const edits = modify(content, ["providers", providerID], providerInfo, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  const updated = applyEdits(content, edits)
  await Bun.write(filePath, updated.endsWith("\n") ? updated : `${updated}\n`)
}

export async function removeCustomProviderFromConfig(filePath: string, providerID: string) {
  const file = Bun.file(filePath)
  const exists = await file.exists()
  if (!exists) return
  const content = await file.text()
  const edits = modify(content, ["providers", providerID], undefined, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  const updated = applyEdits(content, edits)
  await Bun.write(filePath, updated.endsWith("\n") ? updated : `${updated}\n`)
}

export function promptAddCustomProvider(
  dialog: ReturnType<typeof useDialog>,
  entries: readonly ConfigEntry[],
  toast: ReturnType<typeof useToast>,
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
        promptProviderBaseURL(id, name, dialog, entries, toast)
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
) {
  dialog.replace(() => (
    <DialogPrompt
      title={`Endpoint / Base URL (${name}) (2/3)`}
      subtitle="URL base da API (OpenAI-compatible). Ex: https://api.cosmospro.dev/v1"
      placeholder="https://api.cosmospro.dev/v1"
      onCancel={() => promptAddCustomProvider(dialog, entries, toast)}
      onConfirm={(urlVal) => {
        const rawUrl = urlVal.trim().replace(/\/+$/, "")
        if (!rawUrl) return
        promptProviderApiKey(id, name, rawUrl, dialog, entries, toast)
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
) {
  dialog.replace(() => (
    <DialogPrompt
      title={`API Key (${name}) (3/3)`}
      subtitle="Chave de autenticação (deixe vazio se o endpoint for local/sem auth)"
      placeholder="sk-... (opcional)"
      onCancel={() => promptProviderBaseURL(id, name, dialog, entries, toast)}
      onConfirm={(keyVal) => {
        const apiKey = keyVal.trim() || undefined
        void fetchAndConfirmModels(id, name, baseURL, apiKey, dialog, entries, toast)
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
) {
  dialog.replace(() => (
    <DialogPrompt
      title={`Buscando modelos em ${name}...`}
      subtitle={`Consultando endpoint ${baseURL} para listar modelos disponíveis...`}
      busy={true}
      busyText="Buscando modelos disponíveis..."
      placeholder=""
    />
  ))

  const models = await fetchModelsFromEndpoint(baseURL, apiKey).catch((err: Error) => err)

  if (models instanceof Error) {
    const errorMsg = errorMessage(models)
    dialog.replace(() => (
      <DialogPrompt
        title="Não foi possível buscar modelos automaticamente"
        subtitle={`Erro: ${errorMsg}. Digite os IDs dos modelos manualmente (separados por vírgula):`}
        placeholder="gpt-4o, claude-3-5-sonnet, deepseek-chat"
        onCancel={() => dialog.clear()}
        onConfirm={async (manualVal) => {
          const ids = manualVal
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
          if (!ids.length) return
          const targetFile = targetConfigFile(entries)
          const modelEntries: Record<string, { readonly name?: string; readonly type?: "chat" | "image" }> = {}
          for (const mId of ids) {
            const isImg = isLikelyImageModel(mId)
            modelEntries[mId] = isImg ? { name: mId, type: "image" } : { name: mId }
          }
          await saveCustomProviderToConfig(targetFile, id, {
            name,
            package: "@opencode/ai/providers/openai-compatible",
            settings: {
              baseURL,
              ...(apiKey ? { apiKey } : {}),
            },
            models: modelEntries,
          })
          const imgCount = Object.values(modelEntries).filter((m) => m.type === "image").length
          toast.show({
            variant: "success",
            message: `Provedor "${name}" salvo com ${ids.length} modelos${imgCount > 0 ? ` (${imgCount} de imagem)` : ""} em ${path.basename(targetFile)}!`,
          })
          dialog.clear()
        }}
      />
    ))
    return
  }

  const detectedImages = models.filter((m) => m.type === "image").length

  dialog.replace(() => (
    <DialogSelect
      title={`✓ ${models.length} modelos encontrados no endpoint!`}
      renderFilter={false}
      options={[
        {
          title: `✓ Importar todos os ${models.length} modelos`,
          value: "import_all",
          description: detectedImages > 0
            ? `Salvar provedor "${name}" (${detectedImages} modelo(s) de imagem detectados automaticamente)`
            : `Salvar provedor "${name}" com todos os modelos puxados`,
          onSelect: async () => {
            const targetFile = targetConfigFile(entries)
            const modelEntries: Record<string, { readonly name?: string; readonly type?: "chat" | "image" }> = {}
            for (const m of models) {
              modelEntries[m.id] = m.type === "image" ? { name: m.name || m.id, type: "image" } : { name: m.name || m.id }
            }
            await saveCustomProviderToConfig(targetFile, id, {
              name,
              package: "@opencode/ai/providers/openai-compatible",
              settings: {
                baseURL,
                ...(apiKey ? { apiKey } : {}),
              },
              models: modelEntries,
            })
            toast.show({
              variant: "success",
              message: `Provedor "${name}" salvo com ${models.length} modelos${detectedImages > 0 ? ` (${detectedImages} de imagem)` : ""} em ${path.basename(targetFile)}!`,
            })
            dialog.clear()
          },
        },
        {
          title: `Modelos: ${models.slice(0, 6).map((m) => (m.type === "image" ? `🎨 ${m.id}` : m.id)).join(", ")}${models.length > 6 ? "..." : ""}`,
          value: "preview",
          disabled: true,
          description: detectedImages > 0 ? `${detectedImages} modelo(s) de imagem identificados automaticamente` : "Lista de modelos obtida automaticamente",
          onSelect: () => { },
        },
        {
          title: "Voltar / Cancelar",
          value: "cancel",
          onSelect: () => dialog.clear(),
        },
      ]}
    />
  ))
}

export function manageCustomProvider(
  provider: CustomProviderRecord,
  dialog: ReturnType<typeof useDialog>,
  toast: ReturnType<typeof useToast>,
) {
  dialog.replace(() => (
    <DialogSelect
      title={`Provedor Personalizado: ${provider.name}`}
      options={[
        {
          title: "🔄 Atualizar modelos do endpoint",
          value: "refresh",
          description: provider.baseURL
            ? `Re-consultar ${provider.baseURL} para atualizar modelos`
            : "Re-consultar endpoint",
          onSelect: () => {
            const baseURL = provider.baseURL
            if (!baseURL) {
              toast.error("O provedor não tem baseURL configurada.")
              return
            }
            void (async () => {
              dialog.replace(() => (
                <DialogPrompt
                  title={`Atualizando modelos de ${provider.name}...`}
                  subtitle={`Consultando endpoint ${baseURL}...`}
                  busy={true}
                  busyText="Atualizando modelos..."
                  placeholder=""
                />
              ))
              const models = await fetchModelsFromEndpoint(baseURL, provider.apiKey).catch(
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
              await saveCustomProviderToConfig(provider.filePath, provider.id, {
                name: provider.name,
                package: "@opencode/ai/providers/openai-compatible",
                settings: {
                  baseURL,
                  ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
                },
                models: modelEntries,
              })
              const imgCount = Object.values(modelEntries).filter((m) => m.type === "image").length
              toast.show({
                variant: "success",
                message: `Modelos atualizados: ${models.length} modelos importados para "${provider.name}"${imgCount > 0 ? ` (${imgCount} de imagem)` : ""}!`,
              })
              dialog.clear()
            })()
          },
        },
        {
          title: `🎨 Modelos de Imagem (${provider.imageModelCount} configurados)`,
          value: "manage_images",
          description: "Marcar modelos como geradores de imagem ou cadastrar novos",
          onSelect: () => void promptManageImageModels(provider, dialog, toast),
        },
        {
          title: "🔑 Alterar API Key",
          value: "change_key",
          description: "Atualizar a chave de autenticação do provedor",
          onSelect: () => {
            dialog.replace(() => (
              <DialogPrompt
                title={`Alterar API Key (${provider.name})`}
                subtitle="Digite a nova chave de autenticação (ou deixe vazio)"
                value={provider.apiKey ?? ""}
                placeholder="sk-..."
                onConfirm={async (keyVal) => {
                  const apiKey = keyVal.trim() || undefined
                  const targetFile = provider.filePath
                  const file = Bun.file(targetFile)
                  const content = await file.text()
                  const edits = modify(content, ["providers", provider.id, "settings", "apiKey"], apiKey, {
                    formattingOptions: { tabSize: 2, insertSpaces: true },
                  })
                  const updated = applyEdits(content, edits)
                  await Bun.write(targetFile, updated.endsWith("\n") ? updated : `${updated}\n`)
                  toast.show({ variant: "success", message: `API Key de "${provider.name}" atualizada!` })
                  dialog.clear()
                }}
              />
            ))
          },
        },
        {
          title: "🌐 Alterar Endpoint / Base URL",
          value: "change_url",
          description: `Atual (${provider.baseURL ?? "não definido"})`,
          onSelect: () => {
            dialog.replace(() => (
              <DialogPrompt
                title={`Alterar Base URL (${provider.name})`}
                subtitle="URL base da API (OpenAI-compatible)"
                value={provider.baseURL ?? ""}
                placeholder="https://..."
                onConfirm={async (urlVal) => {
                  const rawUrl = urlVal.trim().replace(/\/+$/, "")
                  if (!rawUrl) return
                  const targetFile = provider.filePath
                  const file = Bun.file(targetFile)
                  const content = await file.text()
                  const edits = modify(content, ["providers", provider.id, "settings", "baseURL"], rawUrl, {
                    formattingOptions: { tabSize: 2, insertSpaces: true },
                  })
                  const updated = applyEdits(content, edits)
                  await Bun.write(targetFile, updated.endsWith("\n") ? updated : `${updated}\n`)
                  toast.show({ variant: "success", message: `Base URL de "${provider.name}" atualizada!` })
                  dialog.clear()
                }}
              />
            ))
          },
        },
        {
          title: "🗑 Remover provedor personalizado",
          value: "remove",
          description: `Remover "${provider.name}" e seus modelos da configuração`,
          onSelect: () => {
            dialog.replace(() => (
              <DialogSelect
                title={`Remover provedor "${provider.name}"?`}
                options={[
                  {
                    title: `Sim, remover "${provider.name}"`,
                    value: "confirm",
                    onSelect: async () => {
                      await removeCustomProviderFromConfig(provider.filePath, provider.id)
                      toast.show({ variant: "success", message: `Provedor "${provider.name}" removido!` })
                      dialog.clear()
                    },
                  },
                  {
                    title: "Cancelar",
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

async function promptManageImageModels(
  provider: CustomProviderRecord,
  dialog: ReturnType<typeof useDialog>,
  toast: ReturnType<typeof useToast>,
) {
  const models = provider.models ?? {}
  const entries = Object.entries(models)
  const targetFile = provider.filePath
  const file = Bun.file(targetFile)
  const content = await file.text()
  const parsed = (parse(content) ?? {}) as {
    readonly experimental?: {
      readonly image_generate?: string | { readonly model?: string }
    }
  }
  const rawDefault = parsed.experimental?.image_generate
  const currentDefaultModel = typeof rawDefault === "string" ? rawDefault : typeof rawDefault === "object" ? rawDefault?.model : undefined

  const setDefaultImageModel = async (modelID: string) => {
    const freshFile = Bun.file(targetFile)
    const freshContent = await freshFile.text()
    const fullRef = `${provider.id}/${modelID}`
    const edits = modify(freshContent, ["experimental", "image_generate", "model"], fullRef, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    const updated = applyEdits(freshContent, edits)
    await Bun.write(targetFile, updated.endsWith("\n") ? updated : `${updated}\n`)
    toast.show({
      variant: "success",
      message: `⭐ "${fullRef}" agora é o Modelo Padrão de Geração de Imagem! 🎨`,
    })
    dialog.clear()
  }

  const toggleModelType = async (modelID: string, currentType?: string, alsoSetDefault?: boolean) => {
    const newType = currentType === "image" ? undefined : "image"
    const freshFile = Bun.file(targetFile)
    const freshContent = await freshFile.text()
    let edits = modify(freshContent, ["providers", provider.id, "models", modelID, "type"], newType, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    let updated = applyEdits(freshContent, edits)
    if (alsoSetDefault && newType === "image") {
      const fullRef = `${provider.id}/${modelID}`
      edits = modify(updated, ["experimental", "image_generate", "model"], fullRef, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      })
      updated = applyEdits(updated, edits)
    }
    await Bun.write(targetFile, updated.endsWith("\n") ? updated : `${updated}\n`)
    toast.show({
      variant: "success",
      message:
        newType === "image"
          ? alsoSetDefault
            ? `✓ Modelo "${modelID}" configurado como Gerador de Imagem E padrão do sistema! ⭐🎨`
            : `✓ Modelo "${modelID}" configurado como Gerador de Imagem! 🎨`
          : `✓ Modelo "${modelID}" configurado como Modelo de Chat padrão.`,
    })
    dialog.clear()
  }

  const removeModel = async (modelID: string) => {
    const freshFile = Bun.file(targetFile)
    const freshContent = await freshFile.text()
    const edits = modify(freshContent, ["providers", provider.id, "models", modelID], undefined, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    const updated = applyEdits(freshContent, edits)
    await Bun.write(targetFile, updated.endsWith("\n") ? updated : `${updated}\n`)
    toast.show({
      variant: "success",
      message: `Modelo "${modelID}" removido de "${provider.name}".`,
    })
    dialog.clear()
  }

  const addImageModel = () => {
    dialog.replace(() => (
      <DialogPrompt
        title={`Adicionar Modelo de Imagem (${provider.name})`}
        subtitle="Digite o ID do modelo de imagem (ex: dall-e-3, flux-1-schnell, sdxl)"
        placeholder="Ex: dall-e-3"
        onCancel={() => void promptManageImageModels(provider, dialog, toast)}
        onConfirm={async (val) => {
          const modelID = val.trim()
          if (!modelID) return
          const freshFile = Bun.file(targetFile)
          const freshContent = await freshFile.text()
          const edits1 = modify(
            freshContent,
            ["providers", provider.id, "models", modelID],
            { name: modelID, type: "image" },
            { formattingOptions: { tabSize: 2, insertSpaces: true } },
          )
          let updated = applyEdits(freshContent, edits1)
          const fullRef = `${provider.id}/${modelID}`
          const edits2 = modify(
            updated,
            ["experimental", "image_generate", "model"],
            fullRef,
            { formattingOptions: { tabSize: 2, insertSpaces: true } },
          )
          updated = applyEdits(updated, edits2)
          await Bun.write(targetFile, updated.endsWith("\n") ? updated : `${updated}\n`)
          toast.show({
            variant: "success",
            message: `Modelo de imagem "${modelID}" adicionado e definido como PADRÃO de imagem! ⭐🎨`,
          })
          dialog.clear()
        }}
      />
    ))
  }

  const openModelActionDialog = (mId: string, mInfo?: { readonly name?: string; readonly type?: string }) => {
    const isImg = mInfo?.type === "image"
    const isDefault = currentDefaultModel === `${provider.id}/${mId}`

    if (isImg) {
      dialog.replace(() => (
        <DialogSelect
          title={`Gerenciar Modelo de Imagem: ${mId}`}
          options={[
            ...(isDefault
              ? [
                  {
                    title: "⭐ Modelo Padrão Ativo do Sistema",
                    value: "already_default",
                    description: "Este modelo já é o gerador padrão usado quando nenhuma opção é especificada.",
                    onSelect: () => void promptManageImageModels(provider, dialog, toast),
                  },
                ]
              : [
                  {
                    title: "⭐ Definir como Modelo Padrão de Geração de Imagem",
                    value: "set_default",
                    description: `Configura ${provider.id}/${mId} como gerador padrão ativo em experimental.image_generate`,
                    onSelect: () => void setDefaultImageModel(mId),
                  },
                ]),
            {
              title: "💬 Alternar para Modelo de Chat comum",
              value: "to_chat",
              description: "Volta este modelo para a lista normal de conversação / chat",
              onSelect: () => void toggleModelType(mId, "image"),
            },
            {
              title: "❌ Remover Modelo",
              value: "remove",
              description: "Excluir este modelo do provedor",
              onSelect: () => void removeModel(mId),
            },
            {
              title: "↩️ Voltar",
              value: "back",
              description: "Voltar para a lista de modelos",
              onSelect: () => void promptManageImageModels(provider, dialog, toast),
            },
          ]}
        />
      ))
      return
    }

    dialog.replace(() => (
      <DialogSelect
        title={`Gerenciar Modelo: ${mId}`}
        options={[
          {
            title: "🎨 Transformar em Modelo de Imagem",
            value: "to_image",
            description: "Marca este modelo como gerador de imagem (não aparecerá no chat de texto)",
            onSelect: () => void toggleModelType(mId, undefined, false),
          },
          {
            title: "⭐ Transformar em Modelo de Imagem E definir como Padrão",
            value: "to_image_default",
            description: "Marca como imagem e define imediatamente como o gerador de imagem padrão do sistema",
            onSelect: () => void toggleModelType(mId, undefined, true),
          },
          {
            title: "❌ Remover Modelo",
            value: "remove",
            description: "Excluir este modelo do provedor",
            onSelect: () => void removeModel(mId),
          },
          {
            title: "↩️ Voltar",
            value: "back",
            description: "Voltar para a lista de modelos",
            onSelect: () => void promptManageImageModels(provider, dialog, toast),
          },
        ]}
      />
    ))
  }

  const options = [
    {
      title: "➕ Adicionar modelo de imagem manualmente",
      value: "__add_image_model__",
      description: "Cadastrar modelo pelo ID (ex: dall-e-3, flux-1-schnell, sdxl) e definir como padrão",
      onSelect: addImageModel,
    },
    ...entries.map(([mId, mInfo]) => {
      const isImg = mInfo?.type === "image"
      const isDefault = currentDefaultModel === `${provider.id}/${mId}`
      const prefix = isDefault ? "⭐ [PADRÃO] " : isImg ? "🎨 [IMAGEM] " : "💬 [CHAT] "
      return {
        title: `${prefix}${mInfo?.name ?? mId}`,
        value: mId,
        description: isDefault
          ? `ID: ${mId} • Modelo padrão do sistema ativo para geração de imagens`
          : isImg
            ? `ID: ${mId} • Modelo de imagem configurado (clique para opções / tornar padrão)`
            : `ID: ${mId} • Modelo de chat (clique para transformar em modelo de imagem)`,
        onSelect: () => openModelActionDialog(mId, mInfo),
      }
    }),
  ]

  dialog.replace(() => (
    <DialogSelect
      title={`Modelos de Imagem (${provider.name})`}
      titlePlaceholder="Buscar modelo para gerenciar..."
      options={options}
    />
  ))
}
