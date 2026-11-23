import { Component, createEffect, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { showToast } from "@/shell/notifications/toast"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { useServerSDK } from "@/runtime/server/client"
import {
  getMemoryFiles,
  type MemoryFileInfo,
  type MemoryScope,
} from "@opencode/client/memory-bank"

export const DialogMemoryBank: Component<{
  directory?: string
  onClose: () => void
}> = (props) => {
  const { tr } = useOnethyI18n()
  const serverSdk = useServerSDK()
  const [scope, setScope] = createSignal<MemoryScope>("project")
  const [selectedFile, setSelectedFile] = createSignal<string>("active-context.md")

  const fileLabel = (file: MemoryFileInfo) => {
    if (file.id === "active-context.md") return tr(file.label, "Contexto Ativo")
    if (file.id === "project-brief.md") return tr(file.label, "Resumo do Projeto")
    if (file.id === "system-patterns.md") return tr(file.label, "Padrões do Sistema")
    if (file.id === "tech-context.md") return tr(file.label, "Contexto Técnico")
    if (file.id === "preferences.md") return tr(file.label, "Preferências do Usuário")
    if (file.id === "rules.md") return tr(file.label, "Regras Globais")
    if (file.id === "knowledge.md") return tr(file.label, "Conhecimento Global")
    return file.label
  }

  const fileDescription = (file: MemoryFileInfo) => {
    if (file.id === "active-context.md") {
      return tr(file.description, "Sprint atual, objetivos imediatos, decisões ativas e próximos passos.")
    }
    if (file.id === "project-brief.md") {
      return tr(file.description, "Visão principal, escopo de alto nível, requisitos-chave e público-alvo.")
    }
    if (file.id === "system-patterns.md") {
      return tr(file.description, "Padrões arquiteturais, convenções principais, fluxo de dados e estrutura do código.")
    }
    if (file.id === "tech-context.md") {
      return tr(file.description, "Stack tecnológica, dependências, ambientes de execução e comandos de desenvolvimento.")
    }
    if (file.id === "preferences.md") {
      return tr(file.description, "Preferências de estilo de código, ferramentas favoritas e convenções globais.")
    }
    if (file.id === "rules.md") {
      return tr(file.description, "Regras globais de segurança e comportamento aplicadas a todos os projetos.")
    }
    if (file.id === "knowledge.md") {
      return tr(file.description, "Base de conhecimento entre projetos, dicas e padrões reutilizáveis.")
    }
    return file.description
  }

  const [state, setState] = createStore<{
    loading: boolean
    saving: boolean
    initializing: boolean
    contents: Record<string, string>
    modified: Record<string, boolean>
    exists: Record<string, boolean>
  }>({
    loading: false,
    saving: false,
    initializing: false,
    contents: {},
    modified: {},
    exists: {},
  })

  const files = () => getMemoryFiles(scope())
  const activeFile = () => files().find((f) => f.id === selectedFile()) ?? files()[0]

  createEffect(() => {
    const list = files()

    if (!list.some((f) => f.id === selectedFile())) {
      setSelectedFile(list[0]?.id ?? "")
    }
  })

  createEffect(() => {
    const file = activeFile()

    if (!file) return

    const key = `${scope()}:${file.id}`

    if (state.contents[key] !== undefined) return

    void loadFileContent(file)
  })

  const loadFileContent = async (file: MemoryFileInfo) => {
    const key = `${scope()}:${file.id}`
    setState("loading", true)

    try {
      const location = props.directory ? { directory: props.directory } : undefined
      const response = await serverSdk.api.file.read({
        path: file.relativePath,
        location,
      })

      const text = typeof response === "string" ? response : new TextDecoder().decode(response)

      setState("contents", key, text || file.defaultContent)
      setState("exists", key, true)
      setState("modified", key, false)
    } catch {
      setState("contents", key, file.defaultContent)
      setState("exists", key, false)
      setState("modified", key, false)
    } finally {
      setState("loading", false)
    }
  }

  const currentKey = () => {
    const file = activeFile()

    return file ? `${scope()}:${file.id}` : ""
  }

  const currentContent = () => {
    const file = activeFile()

    if (!file) return ""

    const key = `${scope()}:${file.id}`

    return state.contents[key] ?? file.defaultContent
  }

  const handleContentChange = (value: string) => {
    const file = activeFile()

    if (!file) return

    const key = `${scope()}:${file.id}`
    setState("contents", key, value)
    setState("modified", key, true)
  }

  const handleSave = async () => {
    const file = activeFile()

    if (!file) return

    const key = `${scope()}:${file.id}`
    const content = state.contents[key] ?? file.defaultContent
    setState("saving", true)

    try {
      const location = props.directory ? { directory: props.directory } : undefined
      const payload = new TextEncoder().encode(content)

      await serverSdk.api.experimental.file.write({
        path: file.relativePath,
        location,
        payload,
      })

      setState("exists", key, true)
      setState("modified", key, false)
      showToast({
        title: tr("Memory saved successfully", "Memória salva com sucesso"),
        description: file.relativePath,
        variant: "success",
      })
    } catch (err) {
      showToast({
        title: tr("Error saving memory", "Erro ao salvar memória"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    } finally {
      setState("saving", false)
    }
  }

  const handleInitializeAll = async () => {
    setState("initializing", true)

    try {
      const location = props.directory ? { directory: props.directory } : undefined
      const encoder = new TextEncoder()
      let created = 0

      for (const file of files()) {
        const key = `${scope()}:${file.id}`
        let exists = state.exists[key]

        if (exists === undefined) {
          try {
            await serverSdk.api.file.read({ path: file.relativePath, location })
            exists = true
          } catch {
            exists = false
          }
        }

        if (!exists) {
          await serverSdk.api.experimental.file.write({
            path: file.relativePath,
            location,
            payload: encoder.encode(state.contents[key] ?? file.defaultContent),
          })
          setState("contents", key, state.contents[key] ?? file.defaultContent)
          setState("exists", key, true)
          setState("modified", key, false)
          created++
        }
      }

      showToast({
        title:
          created > 0
            ? tr("{{count}} file(s) initialized!", "{{count}} arquivo(s) inicializados!", { count: created })
            : tr("All files already exist", "Todos os arquivos já existem"),
        description:
          scope() === "global"
            ? tr("Global Scope", "Escopo Global")
            : tr("Current Project Scope", "Escopo do Projeto Atual"),
        variant: "success",
      })
    } catch (err) {
      showToast({
        title: tr("Error initializing Memory Bank", "Erro ao inicializar Memory Bank"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    } finally {
      setState("initializing", false)
    }
  }

  const handleReset = () => {
    const file = activeFile()

    if (!file) return

    const key = `${scope()}:${file.id}`
    setState("contents", key, file.defaultContent)
    setState("modified", key, true)
  }

  const canSave = () => {
    const key = currentKey()

    return !!state.modified[key] || state.exists[key] === false
  }

  return (
    <Dialog
      size="x-large"
      containerClass="!w-[min(calc(100vw_-_32px),880px)] !h-[min(calc(100vh_-_48px),640px)] !rounded-[12px] !bg-v2-background-bg-base"
      class="[font-family:var(--v2-font-family-sans)]"
    >
      <DialogHeader closeLabel={tr("Close", "Fechar")}>
        <div class="flex items-start gap-2.5 min-w-0">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-v2-surface-surface-raised border border-v2-border-border-base text-v2-icon-icon-base mt-0.5">
            <Icon name="outline-brain" size="small" />
          </div>
          <DialogTitleGroup
            title={tr(
              "Persistent Memory Bank (.omnicode/memory-bank/)",
              "Memory Bank Persistente (.omnicode/memory-bank/)",
            )}
            description={tr(
              "Edit and persist architectural memory and preferences shared across sessions and agents",
              "Edite e persista a memória arquitetural e as preferências compartilhadas entre sessões e agentes",
            )}
          />
        </div>
      </DialogHeader>

      <DialogBody class="px-5 py-2 flex flex-col flex-1 min-h-0 gap-3 overflow-hidden">
        {/* Top Controls: Scope Toggle + Actions */}
        <div class="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-v2-border-border-base shrink-0">
          <div class="flex items-center gap-1 p-0.5 rounded-lg bg-v2-surface-surface-raised border border-v2-border-border-base">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer"
              classList={{
                "bg-v2-overlay-simple-overlay-hover text-v2-text-text-base shadow-sm": scope() === "project",
                "text-v2-text-text-muted hover:text-v2-text-text-base": scope() !== "project",
              }}
              onClick={() => setScope("project")}
            >
              <Icon name="folder" size="small" />
              <span>{tr("Current Project", "Projeto Atual")}</span>
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer"
              classList={{
                "bg-v2-overlay-simple-overlay-hover text-v2-text-text-base shadow-sm": scope() === "global",
                "text-v2-text-text-muted hover:text-v2-text-text-base": scope() !== "global",
              }}
              onClick={() => setScope("global")}
            >
              <Icon name="outline-globe" size="small" />
              <span>{tr("Global (All Projects)", "Global (Todos os Projetos)")}</span>
            </button>
          </div>

          <div class="flex items-center gap-2">
            <Button size="small" variant="neutral" onClick={() => void handleInitializeAll()} disabled={state.initializing}>
              <span class="inline-flex items-center gap-1.5">
                <Icon name="plus" size="small" />
                <span>
                  {state.initializing
                    ? tr("Initializing...", "Inicializando...")
                    : tr("Initialize All", "Inicializar Todos")}
                </span>
              </span>
            </Button>
            <Button size="small" variant="ghost" onClick={handleReset} disabled={state.saving}>
              <span class="inline-flex items-center gap-1.5">
                <Icon name="outline-reset" size="small" />
                <span>{tr("Reset Template", "Restaurar Modelo")}</span>
              </span>
            </Button>
          </div>
        </div>

        {/* Main Content: Sidebar File Tabs + Editor */}
        <div class="flex flex-1 min-h-0 gap-3 overflow-hidden">
          {/* File List */}
          <div class="w-52 shrink-0 flex flex-col gap-1 overflow-y-auto pr-2 border-r border-v2-border-border-base">
            <For each={files()}>
              {(file) => {
                const key = () => `${scope()}:${file.id}`
                const isSelected = () => selectedFile() === file.id
                const isDirty = () => state.modified[key()]
                const isMissing = () => state.exists[key()] === false

                return (
                  <button
                    type="button"
                    class="flex flex-col items-start px-2.5 py-2 rounded-md text-left text-xs transition-colors cursor-pointer"
                    classList={{
                      "bg-v2-overlay-simple-overlay-hover font-semibold text-v2-text-text-base": isSelected(),
                      "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                        !isSelected(),
                    }}
                    onClick={() => setSelectedFile(file.id)}
                  >
                    <div class="flex items-center justify-between w-full gap-1.5">
                      <span class="truncate">{fileLabel(file)}</span>
                      <Show when={isDirty()}>
                        <span
                          class="size-2 rounded-full bg-blue-500 shrink-0"
                          title={tr("Unsaved changes", "Alterações não salvas")}
                        />
                      </Show>
                      <Show when={!isDirty() && isMissing()}>
                        <span class="text-[9px] px-1 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                          {tr("new", "novo")}
                        </span>
                      </Show>
                    </div>
                    <span class="text-[10px] text-v2-text-text-faint truncate w-full font-mono">{file.name}</span>
                  </button>
                )
              }}
            </For>
          </div>

          {/* Editor Area */}
          <div class="flex flex-col flex-1 min-h-0 min-w-0">
            <div class="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-v2-border-border-faint text-xs shrink-0">
              <span class="text-v2-text-text-muted truncate">
                {tr("File:", "Arquivo:")} <code class="font-mono text-v2-text-text-base">{activeFile()?.relativePath}</code>
              </span>
              <span class="text-[11px] text-v2-text-text-faint truncate">
                <Show when={activeFile()}>{(file) => fileDescription(file())}</Show>
              </span>
            </div>

            <Show
              when={!state.loading}
              fallback={
                <div class="flex flex-1 items-center justify-center">
                  <Loader class="size-6" />
                </div>
              }
            >
              <textarea
                class="flex-1 w-full min-h-0 p-3 rounded-lg font-mono text-xs bg-v2-surface-surface-raised border border-v2-border-border-base text-v2-text-text-base focus:border-v2-border-border-strong focus:outline-none resize-none leading-relaxed"
                value={currentContent()}
                onInput={(e) => handleContentChange(e.currentTarget.value)}
                placeholder={tr(
                  "Enter architecture notes and persistent context...",
                  "Insira as notas de arquitetura e contexto persistente...",
                )}
              />
            </Show>
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <div class="flex items-center justify-between w-full gap-3">
          <span class="text-[11px] text-v2-text-text-faint">
            <Show
              when={state.exists[currentKey()] !== false}
              fallback={tr(
                "File not yet saved to disk — click Save to create.",
                "Arquivo ainda não salvo no disco — clique em Salvar para criar.",
              )}
            >
              {state.modified[currentKey()]
                ? tr("Pending unsaved changes.", "Alterações pendentes de salvamento.")
                : tr("Synced with disk.", "Sincronizado com o disco.")}
            </Show>
          </span>
          <div class="flex items-center gap-2">
            <Button variant="ghost" onClick={props.onClose}>
              {tr("Close", "Fechar")}
            </Button>
            <Button variant="submit" onClick={() => void handleSave()} disabled={state.saving || !canSave()}>
              <Show when={state.saving} fallback={tr("Save Changes", "Salvar Alterações")}>
                <Loader class="size-3.5 inline mr-1" /> {tr("Saving...", "Salvando...")}
              </Show>
            </Button>
          </div>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
