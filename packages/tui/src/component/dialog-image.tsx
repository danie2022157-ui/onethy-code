import { createMemo, createResource } from "solid-js"
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

export interface ImageModelOption {
  readonly id: string
  readonly name: string
  readonly providerID: string
  readonly providerName: string
  readonly isCustom: boolean
  readonly isDefault: boolean
  readonly canChat: boolean
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

  // Fetch full model list with image type from API
  const [apiModels] = createResource(
    () => location.ref,
    async (loc) => {
      try {
        const query = loc?.workspaceID ? { workspaceID: loc.workspaceID } : loc?.directory ? { directory: loc.directory } : undefined
        const res = await client.api.model.list({ location: query, types: ["image", "chat"] })
        return res.data ?? []
      } catch {
        return []
      }
    },
  )

  const targetFile = createMemo(() => targetConfigFile(entries()))

  // Read current default image model from config
  const [defaultImageModel, { refetch: refetchDefault }] = createResource(
    targetFile,
    async (file) => {
      try {
        const text = await Bun.file(file).text()
        const parsed = (parse(text) ?? {}) as {
          readonly experimental?: {
            readonly image_generate?: string | { readonly model?: string }
          }
        }
        const raw = parsed.experimental?.image_generate
        if (typeof raw === "string") return raw
        if (typeof raw === "object" && raw?.model) return raw.model
        return undefined
      } catch {
        return undefined
      }
    },
  )

  const allImageModels = createMemo<ImageModelOption[]>(() => {
    const list: ImageModelOption[] = []
    const seen = new Set<string>()
    const currentDefault = defaultImageModel()

    // 1. Check custom providers from config entries
    for (const prov of customProviders()) {
      const models = prov.models ?? {}
      for (const [mId, mInfo] of Object.entries(models)) {
        const isImg = mInfo?.type === "image"
        if (isImg) {
          const key = `${prov.id}/${mId}`
          seen.add(key)
          list.push({
            id: mId,
            name: mInfo?.name || mId,
            providerID: prov.id,
            providerName: prov.name,
            isCustom: true,
            isDefault: currentDefault === key,
            canChat: true,
            filePath: prov.filePath,
          })
        }
      }
    }

    // 2. Check API discovered models (official and custom loaded in engine)
    const engineModels = apiModels() ?? []
    for (const m of engineModels) {
      const isImg =
        m.type === "image" ||
        m.capabilities?.output?.some((o: string) => o.startsWith("image")) ||
        /dall-?e|flux|stable-diffusion|\bsdxl\b|\bimagen\b|midjourney/i.test(`${m.id} ${m.name}`)
      if (!isImg) continue
      const key = `${m.providerID}/${m.id}`
      if (seen.has(key)) continue
      seen.add(key)

      const prov = customProviders().find((p) => p.id === m.providerID)
      list.push({
        id: m.id,
        name: m.name || m.id,
        providerID: m.providerID,
        providerName: prov?.name || m.providerID,
        isCustom: !!prov,
        isDefault: currentDefault === key,
        canChat: m.type === "chat" || m.capabilities?.output?.some((o: string) => o.startsWith("text")),
        filePath: prov?.filePath,
      })
    }

    // Default fallback in opencode if nothing else
    if (!seen.has("opencode/grok-imagine-image-2.0")) {
      list.push({
        id: "grok-imagine-image-2.0",
        name: "Grok Imagine 2.0",
        providerID: "opencode",
        providerName: "OpenCode (Oficial)",
        isCustom: false,
        isDefault: currentDefault === "opencode/grok-imagine-image-2.0",
        canChat: false,
      })
    }

    return list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.providerName.localeCompare(b.providerName))
  })

  const setDefault = async (model: ImageModelOption) => {
    const file = model.filePath ?? targetFile()
    const content = await Bun.file(file).text()
    const fullRef = `${model.providerID}/${model.id}`
    const edits = modify(content, ["experimental", "image_generate", "model"], fullRef, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    const updated = applyEdits(content, edits)
    await Bun.write(file, updated.endsWith("\n") ? updated : `${updated}\n`)
    await refetchDefault()
    toast.show({
      variant: "success",
      message: `⭐ "${fullRef}" definido como Modelo Padrão de Geração de Imagem! 🎨`,
    })
    dialog.clear()
  }

  const promptGenerateImage = (chosenModel?: ImageModelOption) => {
    const defaultMod = allImageModels().find((m) => m.isDefault) ?? allImageModels()[0]
    const modelToUse = chosenModel ?? defaultMod
    const modelRef = modelToUse ? `${modelToUse.providerID}/${modelToUse.id}` : undefined

    dialog.replace(() => (
      <DialogPrompt
        title="🎨 Gerar Imagem Autônoma"
        subtitle={modelRef ? `Usando modelo: ${modelRef}` : "Digite o prompt da imagem"}
        placeholder="Descreva a imagem (ex: um dragão futurista em neon azul, 4k)"
        onCancel={() => dialog.clear()}
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

  const toggleChatVisibility = async (model: ImageModelOption) => {
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
    dialog.clear()
  }

  const openModelActionDialog = (model: ImageModelOption) => {
    dialog.replace(() => (
      <DialogSelect
        title={`Gerenciador de Modelo: ${model.providerName} / ${model.name}`}
        options={[
          {
            title: model.isDefault ? "⭐ [Modelo Padrão Ativo]" : "⭐ Definir como Modelo Padrão de Imagem",
            value: "set_default",
            description: model.isDefault
              ? "Este modelo já é a primeira escolha do sistema."
              : `Tornar ${model.providerID}/${model.id} o gerador padrão ativo em experimental.image_generate`,
            onSelect: () => void setDefault(model),
          },
          {
            title: "🎨 Gerar Imagem com este Modelo",
            value: "generate_now",
            description: `Abrir prompt para criar uma nova imagem usando ${model.id}`,
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

  const options = createMemo(() => {
    const active = allImageModels().find((m) => m.isDefault)

    return [
      {
        title: "🎨 Gerar Nova Imagem Agora",
        value: "__generate_new__",
        description: active
          ? `Modelo ativo: ${active.providerName} / ${active.name} (clique para digitar prompt)`
          : "Digitar descrição e gerar imagem via modelo padrão",
        onSelect: () => promptGenerateImage(),
      },
      ...allImageModels().map((m) => {
        const prefix = m.isDefault ? "⭐ [PADRÃO] " : "🎨 "
        const typeBadge = m.isCustom ? "[Personalizado]" : "[Oficial]"
        const chatBadge = m.hiddenFromChat ? "• Oculto do Chat" : "• Disponível no Chat"
        return {
          title: `${prefix}${m.name} (${m.providerName})`,
          value: `${m.providerID}/${m.id}`,
          description: `ID: ${m.providerID}/${m.id} ${typeBadge} ${chatBadge}`,
          onSelect: () => openModelActionDialog(m),
        }
      }),
    ]
  })

  return (
    <DialogSelect
      title="Gerenciador de Geração de Imagem (/image)"
      titlePlaceholder="Buscar modelos de imagem ou opções..."
      options={options()}
    />
  )
}
