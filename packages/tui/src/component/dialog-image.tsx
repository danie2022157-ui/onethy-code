import { createMemo, createResource, createSignal } from "solid-js"
import { applyEdits, modify, parse } from "jsonc-parser"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { useSessionTabs } from "../context/session-tabs"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import {
  extractCustomProviders,
  targetConfigFile,
} from "./dialog-integration-custom"

export interface AnyModelOption {
  readonly id: string
  readonly name: string
  readonly providerID: string
  readonly providerName: string
  readonly isCustom: boolean
  readonly isDefault: boolean
  readonly isSelected: boolean
  readonly isDedicatedImage: boolean
  readonly hiddenFromChat?: boolean
  readonly filePath?: string
}

export function DialogImage() {
  const data = useData()
  const location = useLocation()
  const client = useClient()
  const dialog = useDialog()
  const toast = useToast()
  const sessionTabs = useSessionTabs()

  const entries = createMemo(() => data.location.config.list(location.ref) ?? [])
  const customProviders = createMemo(() => extractCustomProviders(entries()))

  // Fetch full model list (all models: chat, image, etc.) from API
  const [apiModels] = createResource(
    () => location.ref,
    async (loc) => {
      try {
        const query = loc?.workspaceID ? { workspaceID: loc.workspaceID } : loc?.directory ? { directory: loc.directory } : undefined
        const res = await client.api.model.list({ location: query, types: ["chat", "image"] })
        return res.data ?? []
      } catch {
        return []
      }
    },
  )

  const targetFile = createMemo(() => targetConfigFile(entries()))

  // Read current default image model and pool of selected image models from config
  const [configState, { refetch: refetchConfig }] = createResource(
    targetFile,
    async (file) => {
      try {
        const text = await Bun.file(file).text()
        const parsed = (parse(text) ?? {}) as {
          readonly experimental?: {
            readonly image_generate?: string | {
              readonly model?: string
              readonly models?: readonly string[]
            }
          }
        }
        const raw = parsed.experimental?.image_generate
        let defaultModel: string | undefined
        let selectedPool: string[] = []

        if (typeof raw === "string") {
          defaultModel = raw
          selectedPool = [raw]
        } else if (typeof raw === "object" && raw !== null) {
          if (raw.model) defaultModel = raw.model
          if (Array.isArray(raw.models)) {
            selectedPool = [...raw.models]
          } else if (raw.model) {
            selectedPool = [raw.model]
          }
        }
        return { defaultModel, selectedPool }
      } catch {
        return { defaultModel: undefined, selectedPool: [] }
      }
    },
  )

  // Local optimistic override for fast interactive toggling
  const [optimisticPool, setOptimisticPool] = createSignal<string[] | null>(null)
  const [optimisticDefault, setOptimisticDefault] = createSignal<string | null>(null)

  const currentPool = () => optimisticPool() ?? configState()?.selectedPool ?? []
  const currentDefaultModel = () => optimisticDefault() ?? configState()?.defaultModel

  // Unified list of ALL models in the system (Chat + Dedicated Image + Custom + Official)
  const allModels = createMemo<AnyModelOption[]>(() => {
    const list: AnyModelOption[] = []
    const seen = new Set<string>()
    const pool = currentPool()
    const def = currentDefaultModel()

    // 1. All models from custom providers
    for (const prov of customProviders()) {
      const provModels = prov.models ?? {}
      for (const [mId, mInfo] of Object.entries(provModels)) {
        const fullKey = `${prov.id}/${mId}`
        seen.add(fullKey)
        const isDedImg =
          mInfo?.type === "image" ||
          /dall-?e|flux|stable-diffusion|\bsdxl\b|\bimagen\b|midjourney/i.test(`${mId} ${mInfo?.name ?? ""}`)
        list.push({
          id: mId,
          name: mInfo?.name || mId,
          providerID: prov.id,
          providerName: prov.name,
          isCustom: true,
          isDefault: def === fullKey,
          isSelected: pool.includes(fullKey) || def === fullKey,
          isDedicatedImage: isDedImg,
          filePath: prov.filePath,
        })
      }
    }

    // 2. All models from engine / API (official providers and discovered models)
    const engineModels = apiModels() ?? []
    for (const m of engineModels) {
      const fullKey = `${m.providerID}/${m.id}`
      if (seen.has(fullKey)) continue
      seen.add(fullKey)

      const prov = customProviders().find((p) => p.id === m.providerID)
      const isDedImg =
        m.type === "image" ||
        m.capabilities?.output?.some((o: string) => o.startsWith("image")) ||
        /dall-?e|flux|stable-diffusion|\bsdxl\b|\bimagen\b|midjourney/i.test(`${m.id} ${m.name}`)

      list.push({
        id: m.id,
        name: m.name || m.id,
        providerID: m.providerID,
        providerName: prov?.name || m.providerID,
        isCustom: !!prov,
        isDefault: def === fullKey,
        isSelected: pool.includes(fullKey) || def === fullKey,
        isDedicatedImage: isDedImg,
        filePath: prov?.filePath,
      })
    }

    // Sort order:
    // 1. Default model first
    // 2. Selected models next
    // 3. Dedicated image models
    // 4. Alphabetical by provider
    return list.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return Number(b.isDefault) - Number(a.isDefault)
      if (a.isSelected !== b.isSelected) return Number(b.isSelected) - Number(a.isSelected)
      if (a.isDedicatedImage !== b.isDedicatedImage) return Number(b.isDedicatedImage) - Number(a.isDedicatedImage)
      return a.providerName.localeCompare(b.providerName) || a.name.localeCompare(b.name)
    })
  })

  // Save changes to config file
  const saveImageConfig = async (newDefault: string | undefined, newPool: string[]) => {
    setOptimisticDefault(newDefault ?? null)
    setOptimisticPool(newPool)

    const file = targetFile()
    const content = await Bun.file(file).text()
    let edits = modify(content, ["experimental", "image_generate", "models"], newPool, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    let updated = applyEdits(content, edits)
    edits = modify(updated, ["experimental", "image_generate", "model"], newDefault, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    updated = applyEdits(updated, edits)
    await Bun.write(file, updated.endsWith("\n") ? updated : `${updated}\n`)
    await refetchConfig()
  }

  // Toggle selection of a model in the image pool
  const toggleModelSelection = async (model: AnyModelOption) => {
    const fullKey = `${model.providerID}/${model.id}`
    const pool = [...currentPool()]
    const idx = pool.indexOf(fullKey)
    let newDefault = currentDefaultModel()

    if (idx >= 0) {
      // Remove from pool
      pool.splice(idx, 1)
      if (newDefault === fullKey) {
        newDefault = pool[0] ?? undefined
      }
      toast.show({
        variant: "info",
        message: `Modelo "${model.name}" desmarcado do pool de imagem.`,
      })
    } else {
      // Add to pool
      pool.push(fullKey)
      if (!newDefault) {
        newDefault = fullKey
      }
      toast.show({
        variant: "success",
        message: `✓ Modelo "${model.name}" adicionado ao pool de imagem! [✓]`,
      })
    }

    await saveImageConfig(newDefault, pool)
  }

  // Set as primary default model
  const setAsPrimaryDefault = async (model: AnyModelOption) => {
    const fullKey = `${model.providerID}/${model.id}`
    const pool = [...currentPool()]
    if (!pool.includes(fullKey)) {
      pool.unshift(fullKey)
    }
    await saveImageConfig(fullKey, pool)
    toast.show({
      variant: "success",
      message: `⭐ "${model.name}" agora é o Modelo Padrão Principal de Imagem!`,
    })
  }

  const promptGenerateImage = (chosenModel?: AnyModelOption) => {
    const defaultMod = allModels().find((m) => m.isDefault) ?? allModels().find((m) => m.isSelected) ?? allModels()[0]
    const modelToUse = chosenModel ?? defaultMod
    const modelRef = modelToUse ? `${modelToUse.providerID}/${modelToUse.id}` : undefined

    dialog.replace(() => (
      <DialogPrompt
        title="🎨 Gerar Imagem Autônoma"
        subtitle={modelRef ? `Usando modelo: ${modelRef}` : "Digite a descrição da imagem"}
        placeholder="Descreva a imagem (ex: um dragão futurista em neon azul, 4k)"
        onCancel={() => dialog.replace(() => <DialogImage />)}
        onConfirm={async (prompt) => {
          const text = prompt.trim()
          if (!text) return
          dialog.clear()

          const curSessionID = sessionTabs.current()
          if (curSessionID) {
            toast.show({
              variant: "info",
              message: `Iniciando geração com ${modelRef ?? "modelo padrão"}... 🎨`,
            })
            void data.session.prompt({
              sessionID: curSessionID,
              text: `Por favor, gere uma imagem usando o modelo ${modelRef ?? "padrão"}: "${text}"`,
            })
          } else {
            toast.show({
              variant: "error",
              message: "Abra ou selecione uma sessão no chat para gerar a imagem.",
            })
          }
        }}
      />
    ))
  }

  const toggleChatVisibility = async (model: AnyModelOption) => {
    if (!model.filePath) {
      toast.show({
        variant: "info",
        message: "Visibilidade só pode ser alternada em provedores personalizados.",
      })
      return
    }
    const file = model.filePath
    const content = await Bun.file(file).text()
    const currentHide = model.hiddenFromChat ?? false
    const newHide = !currentHide ? true : undefined
    const edits = modify(content, ["providers", model.providerID, "models", model.id, "settings", "hideFromChat"], newHide, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    const updated = applyEdits(content, edits)
    await Bun.write(file, updated.endsWith("\n") ? updated : `${updated}\n`)
    toast.show({
      variant: "success",
      message: newHide
        ? `Modelo "${model.id}" ocultado do seletor de chat (/models).`
        : `Modelo "${model.id}" visível no seletor de chat (/models).`,
    })
    dialog.replace(() => <DialogImage />)
  }

  const openModelActionDialog = (model: AnyModelOption) => {
    dialog.replace(() => (
      <DialogSelect
        title={`Opções do Modelo: ${model.providerName} / ${model.name}`}
        options={[
          {
            title: model.isDefault ? "⭐ [Modelo Principal Atual]" : "⭐ Definir como Modelo Padrão Principal",
            value: "set_default",
            description: model.isDefault
              ? "Este modelo já é o primeiro da fila para gerar imagens."
              : `Tornar ${model.providerID}/${model.id} o modelo prioritário em experimental.image_generate`,
            onSelect: async () => {
              await setAsPrimaryDefault(model)
              dialog.replace(() => <DialogImage />)
            },
          },
          {
            title: model.isSelected ? "❌ Desmarcar do Pool de Imagem [ ]" : "✓ Marcar para o Pool de Imagem [✓]",
            value: "toggle_pool",
            description: model.isSelected
              ? "Remover este modelo do conjunto de modelos usados para gerar imagens"
              : "Habilitar este modelo para fazer parte da geração de imagens",
            onSelect: async () => {
              await toggleModelSelection(model)
              dialog.replace(() => <DialogImage />)
            },
          },
          {
            title: "🎨 Gerar Imagem com este Modelo Agora",
            value: "generate_now",
            description: `Criar uma nova imagem usando diretamente ${model.id}`,
            onSelect: () => promptGenerateImage(model),
          },
          ...(model.isCustom
            ? [
                {
                  title: model.hiddenFromChat
                    ? "💬 Mostrar este modelo no Chat (/models)"
                    : "👁️ Ocultar este modelo do Chat (Apenas Imagem)",
                  value: "toggle_chat",
                  description: model.hiddenFromChat
                    ? "Permitir conversar com este modelo normalmente no chat"
                    : "Remover este modelo do seletor /models mantendo ativo para imagens",
                  onSelect: () => void toggleChatVisibility(model),
                },
              ]
            : []),
          {
            title: "↩️ Voltar para a lista",
            value: "back",
            description: "Voltar para o gerenciador de imagens",
            onSelect: () => dialog.replace(() => <DialogImage />),
          },
        ]}
      />
    ))
  }

  const selectAll = async () => {
    const allKeys = allModels().map((m) => `${m.providerID}/${m.id}`)
    const def = currentDefaultModel() ?? allKeys[0]
    await saveImageConfig(def, allKeys)
    toast.show({
      variant: "success",
      message: `✓ Todos os ${allKeys.length} modelos foram selecionados no Pool de Imagem!`,
    })
  }

  const clearAll = async () => {
    await saveImageConfig(undefined, [])
    toast.show({
      variant: "info",
      message: "Pool de modelos de imagem desmarcado.",
    })
  }

  const options = createMemo(() => {
    const pool = currentPool()
    const active = allModels().find((m) => m.isDefault)

    return [
      {
        title: "🎨 Gerar Nova Imagem Agora",
        value: "__generate_new__",
        description: active
          ? `Modelo ativo: ${active.providerName} / ${active.name} • ${pool.length} modelo(s) no Pool`
          : `${pool.length} modelo(s) selecionados no Pool de Imagem`,
        onSelect: () => promptGenerateImage(),
      },
      {
        title: pool.length === allModels().length ? "✖️ Desmarcar Todos os Modelos" : "✓ Selecionar Todos os Modelos",
        value: "__toggle_all__",
        description: pool.length === allModels().length
          ? "Limpar a seleção múltipla do pool de modelos de imagem"
          : `Marcar todos os ${allModels().length} modelos para o Pool de Imagem`,
        onSelect: () => (pool.length === allModels().length ? clearAll() : selectAll()),
      },
      ...allModels().map((m) => {
        const check = m.isSelected ? "[✓] " : "[ ] "
        const star = m.isDefault ? "⭐ [PADRÃO] " : ""
        const kindIcon = m.isDedicatedImage ? "🎨 " : "💬 "
        const typeBadge = m.isCustom ? "[Personalizado]" : "[Oficial]"
        const kindLabel = m.isDedicatedImage ? "Imagem" : "Chat / Multimodal"

        return {
          title: `${check}${star}${kindIcon}${m.name} (${m.providerName})`,
          value: `${m.providerID}/${m.id}`,
          description: `ID: ${m.providerID}/${m.id} • ${typeBadge} • ${kindLabel} • Clique para alternar [✓]/[ ] ou opções`,
          onSelect: () => {
            // If already selected, open full action menu (allow making default or testing)
            // If not selected, toggle it on immediately!
            if (m.isSelected) {
              openModelActionDialog(m)
            } else {
              void toggleModelSelection(m)
            }
          },
        }
      }),
    ]
  })

  return (
    <DialogSelect
      title={`Gerenciador de Imagem: ${currentPool().length} selecionados (/image)`}
      titlePlaceholder="Buscar modelos (chat, imagem, personalizados, oficiais)..."
      options={options()}
    />
  )
}
