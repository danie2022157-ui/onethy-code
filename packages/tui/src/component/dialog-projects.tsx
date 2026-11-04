import { createMemo, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import fs from "node:fs"
import path from "node:path"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useDialog } from "../ui/dialog"
import { useData } from "../context/data"
import { useRoute } from "../context/route"
import { useLocation } from "../context/location"
import { useTuiPaths } from "../context/runtime"
import { useStorageOptional } from "../context/storage"
import { useToast } from "../ui/toast"
import {
  addProjectDirectory,
  createProjectDirectory,
  forgetProject,
  rememberProject,
  visibleProjectDirectories,
  type ProjectRegistry,
} from "../util/onethy-projects"

const INITIAL: ProjectRegistry = { registered: [], hidden: [], names: {} }

/** Projects are hidden from this manager, never deleted from disk or from existing sessions. */
export function DialogProjects() {
  const dialog = useDialog()
  const data = useData()
  const route = useRoute()
  const location = useLocation()
  const paths = useTuiPaths()
  const toast = useToast()
  const storage = useStorageOptional()
  const [temporary, updateTemporary] = createStore<ProjectRegistry>({ ...INITIAL })
  const saved = storage?.store<ProjectRegistry>("onethy-projects", { initial: INITIAL })
  const registry = saved?.[0] ?? temporary

  const change = (mutate: (value: ProjectRegistry) => void) =>
    saved ? saved[1](mutate) : Promise.resolve(updateTemporary(produce(mutate)))

  onMount(() => {
    void data.project.sync().catch(() => undefined)
  })

  const existing = createMemo(() => data.project.list().filter((project) => project.canonical !== "/"))
  const directories = createMemo(() =>
    visibleProjectDirectories(existing().map((project) => project.canonical), registry),
  )

  function showError(title: string, error: unknown) {
    toast.show({ variant: "error", title, message: error instanceof Error ? error.message : String(error) })
  }

  function open(directory: string) {
    try {
      addProjectDirectory(directory, paths.cwd)
      dialog.clear()
      const target = { directory }
      route.navigate({ type: "home", location: target })
      location.set(target)
    } catch (error) {
      showError("Não foi possível abrir o projeto", error)
    }
  }

  function promptCreate(existingFolder: boolean) {
    dialog.push(() => (
      <DialogPrompt
        title={existingFolder ? "Adicionar projeto existente" : "Criar novo projeto"}
        placeholder={existingFolder ? "Caminho da pasta existente" : "Nome ou caminho da nova pasta"}
        subtitle={existingFolder
          ? "A pasta precisa existir. Nenhum arquivo será alterado."
          : "Cria uma pasta vazia dentro do diretório indicado; não sobrescreve projetos."}
        onCancel={() => dialog.pop()}
        onConfirm={(input) => {
          void (async () => {
            try {
              const directory = existingFolder
                ? addProjectDirectory(input, paths.cwd)
                : createProjectDirectory(input, paths.cwd)
              await change((draft) => rememberProject(draft, directory))
              toast.show({ variant: "success", title: existingFolder ? "Projeto adicionado" : "Projeto criado", message: directory })
              open(directory)
            } catch (error) {
              showError("Falha no gerenciamento de projetos", error)
            }
          })()
        }}
      />
    ))
  }

  function rename(directory: string) {
    dialog.push(() => (
      <DialogPrompt
        title="Renomear projeto na lista"
        subtitle="Altera apenas o nome exibido no Onethy Code; a pasta permanece igual."
        value={registry.names[directory] ?? existing().find((item) => item.canonical === directory)?.name ?? path.basename(directory)}
        onCancel={() => dialog.pop()}
        onConfirm={(input) => {
          void (async () => {
            try {
              const name = input.trim()
              if (!name || name.length > 80) throw new Error("Informe um nome de até 80 caracteres.")
              await change((draft) => {
                draft.names[directory] = name
              })
              dialog.pop()
              toast.show({ variant: "success", title: "Projeto renomeado na lista", message: name })
            } catch (error) {
              showError("Não foi possível renomear", error)
            }
          })()
        }}
      />
    ))
  }

  function remove(directory: string) {
    dialog.push(() => (
      <DialogSelect
        title="Remover projeto da lista?"
        description={"Apenas a entrada será removida. Os arquivos e as sessões serão preservados: " + directory}
        skipFilter
        options={[
          { value: "cancel", title: "Cancelar", onSelect: () => dialog.pop() },
          {
            value: "confirm",
            title: "Confirmar remoção da lista",
            onSelect: () => {
              void (async () => {
                try {
                  await change((draft) => forgetProject(draft, directory))
                  dialog.pop()
                  toast.show({ variant: "success", title: "Projeto removido da lista", message: "Nenhum arquivo foi apagado." })
                } catch (error) {
                  showError("Não foi possível remover", error)
                }
              })()
            },
          },
        ]}
        footerHints={[{ title: "selecionar", label: "enter" }, { title: "voltar", label: "esc" }]}
      />
    ))
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => [
    {
      value: "__create",
      title: "＋ Criar novo projeto",
      description: "Criar pasta e abrir como projeto no Onethy Code",
      category: "Gerenciamento",
      onSelect: () => promptCreate(false),
    },
    {
      value: "__add",
      title: "＋ Adicionar pasta existente",
      description: "Registrar e abrir uma pasta do computador",
      category: "Gerenciamento",
      onSelect: () => promptCreate(true),
    },
    ...directories().map((directory) => {
      const project = existing().find((item) => item.canonical === directory)
      const name = registry.names[directory] ?? project?.name ?? path.basename(directory)
      const exists = fs.existsSync(directory)
      return {
        value: directory,
        title: (exists ? "📁 " : "⚠ ") + name,
        description: directory,
        category: "Projetos",
        footer: exists ? "Enter: abrir" : "Pasta não encontrada · Ctrl+D para remover da lista",
        onSelect: () => open(directory),
      }
    }),
  ])

  const isProject = (value: string | undefined) => Boolean(value && directories().includes(value))

  return (
    <DialogSelect
      title="📁 Onethy Code — Gerenciar projetos"
      placeholder="Buscar projetos..."
      options={options()}
      actions={[
        {
          command: "session.rename",
          title: "renomear",
          disabled: (option) => !isProject(option?.value),
          onTrigger: (option) => rename(option.value),
        },
        {
          command: "session.delete",
          title: "remover da lista",
          disabled: (option) => !isProject(option?.value),
          onTrigger: (option) => remove(option.value),
        },
      ]}
      footerHints={[{ title: "abrir / criar", label: "enter" }]}
    />
  )
}
