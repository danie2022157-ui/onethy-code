import { createMemo, createSignal } from "solid-js"
import { useDialog, DialogHeader, DialogLayout } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import {
  fetchVerifiedTemplate,
  searchTemplates,
  stageTemplate,
  templateCatalog,
  type TemplateEntry,
} from "../util/aitmpl"

/** Native, offline-first discovery of the pinned AI Templates catalog.
 * Selecting an item NEVER activates code, installs dependencies, or connects an MCP.
 */
export function DialogAitmpl() {
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const location = useLocation()
  const data = useData()
  const [kind, setKind] = createSignal("all")

  const categories = [
    ["all", "Todas"],
    ["skills", "Skills"],
    ["agents", "Agentes"],
    ["commands", "Comandos"],
    ["settings", "Configurações"],
    ["hooks", "Hooks"],
    ["mcps", "MCPs"],
    ["mods", "Mods"],
    ["loops", "Loops"],
  ] as const

  function error(label: string, cause: unknown) {
    toast.show({
      variant: "error",
      title: label,
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }

  function preview(entry: TemplateEntry) {
    void fetchVerifiedTemplate(entry).then((content) =>
      dialog.push(() => (
        <DialogLayout header={<DialogHeader title={"Arquivo de origem: " + entry.name} />}>
          <box flexDirection="column" gap={1}>
            <text fg={theme.text.muted}>
              {entry.id} · Somente leitura · SHA fixado e verificado
            </text>
            <text fg={theme.text.base} wrapMode="word">
              {content.slice(0, 6000)}
              {content.length > 6000 ? "\n\n[Prévia limitada a 6.000 caracteres]" : ""}
            </text>
            <text fg={theme.text.muted}>Esc: voltar. A prévia não executa nem instala arquivos.</text>
          </box>
        </DialogLayout>
      )),
    ).catch((cause) => error("Não foi possível baixar a prévia", cause))
  }

  function confirmStage(entry: TemplateEntry) {
    dialog.push(() => (
      <DialogSelect
        title={"Baixar para revisão: " + entry.name}
        description={
          "Este arquivo será salvo em .omnicode/aitmpl-review, fora dos diretórios ativos. " +
          "Não inicia servidores, ativa hooks, registra agentes nem modifica configurações. " +
          "Skills e mods podem exigir arquivos auxiliares não incluídos nesta cópia."
        }
        skipFilter
        options={[
          { value: "cancel", title: "Cancelar", onSelect: () => dialog.pop() },
          {
            value: "stage",
            title: "Baixar cópia verificada (somente revisão)",
            onSelect: () => {
              const ref = location.ref ?? data.location.default()
              if (!ref?.directory) {
                toast.show({ variant: "warning", message: "Abra um projeto antes de baixar componentes." })
                return
              }
              void stageTemplate(entry, ref.directory).then((target) => {
                dialog.clear()
                toast.show({ variant: "success", title: "Arquivo salvo para revisão", message: target })
              }).catch((cause) => error("Importação não concluída", cause))
            },
          },
        ]}
      />
    ))
  }

  function detail(entry: TemplateEntry) {
    dialog.push(() => (
      <DialogSelect
        title={entry.name + " · " + entry.type}
        description={
          entry.id + "\n" +
          (entry.description || "Sem descrição.") + "\n" +
          "Origem fixada no GitHub · " + entry.size + " bytes · sem instalação automática"
        }
        skipFilter
        options={[
          { value: "preview", title: "Visualizar conteúdo verificado", onSelect: () => preview(entry) },
          { value: "stage", title: "Baixar arquivo para revisão (não ativa)", onSelect: () => confirmStage(entry) },
          { value: "back", title: "Voltar ao catálogo", onSelect: () => dialog.pop() },
        ]}
      />
    ))
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => [
    ...categories.map(([value, label]) => ({
      value: "filter:" + value,
      title: (kind() === value ? "● " : "○ ") + label,
      description: value === "all" ? "Todo o catálogo offline" : String(templateCatalog.counts[value as keyof typeof templateCatalog.counts] ?? 0) + " itens",
      category: "Categorias",
      onSelect: () => setKind(value),
    })),
    ...searchTemplates("", kind()).map((entry) => ({
      value: entry.id,
      title: entry.name,
      description: (entry.category + " · " + entry.description).slice(0, 190),
      category: entry.type,
      footer: "[Revisar]",
      onSelect: () => detail(entry),
    })),
  ])

  return (
    <DialogSelect
      title={"AI Templates · " + templateCatalog.entries.length + " entradas disponíveis"}
      titlePlaceholder="Pesquisar skills, agentes, comandos, MCPs e outros componentes..."
      searchInTitle
      options={options()}
      footerHints={[{ title: "selecionar", label: "enter" }, { title: "voltar", label: "esc" }]}
    />
  )
}
