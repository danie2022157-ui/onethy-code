import { createMemo, createSignal } from "solid-js"
import fs from "fs"
import path from "path"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useTuiPaths } from "../context/runtime"
import { useToast } from "../ui/toast"
import { openEditor } from "../editor"

interface MemoryBankFile {
  name: string
  label: string
  description: string
  exists: boolean
  size: number
  path: string
}

const MEMORY_FILES = [
  {
    name: "activeContext.md",
    label: "Contexto Ativo (activeContext.md)",
    description: "Foco atual da sprint, decisões recentes e próximos passos imediatos",
  },
  {
    name: "projectbrief.md",
    label: "Brief do Projeto (projectbrief.md)",
    description: "Visão geral, objetivos essenciais e requisitos fundamentais",
  },
  {
    name: "systemPatterns.md",
    label: "Padrões de Sistema (systemPatterns.md)",
    description: "Arquitetura, convenções de código e decisões estruturais",
  },
  {
    name: "techContext.md",
    label: "Contexto Tecnológico (techContext.md)",
    description: "Linguagens, frameworks, versões e restrições de ambiente",
  },
  {
    name: "memory.md",
    label: "Notas Globais de Memória (memory.md)",
    description: "Registro persistente de preferências e decisões históricas",
  },
]

export function DialogMemoryBank() {
  const dialog = useDialog()
  const paths = useTuiPaths()
  const toast = useToast()
  const [version, setVersion] = createSignal(0)

  const dir = () => {
    const root = paths.cwd ?? process.cwd()
    return path.join(root, ".omnicode", "memory-bank")
  }

  const rootMemoryPath = () => {
    const root = paths.cwd ?? process.cwd()
    return path.join(root, ".omnicode", "memory.md")
  }

  const files = createMemo<MemoryBankFile[]>(() => {
    version() // dependência para recarregar
    const folder = dir()
    const memoryRoot = rootMemoryPath()

    return MEMORY_FILES.map((def) => {
      const filePath = def.name === "memory.md" ? memoryRoot : path.join(folder, def.name)
      try {
        if (fs.existsSync(filePath)) {
          const stat = fs.statSync(filePath)
          return {
            name: def.name,
            label: def.label,
            description: def.description,
            exists: true,
            size: stat.size,
            path: filePath,
          }
        }
      } catch {
        // ignora
      }
      return {
        name: def.name,
        label: def.label,
        description: def.description,
        exists: false,
        size: 0,
        path: filePath,
      }
    })
  })

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const list: DialogSelectOption<string>[] = []
    const bank = files()
    const totalExists = bank.filter((f) => f.exists).length

    list.push({
      value: "__init__",
      title: `⚡ Inicializar / Atualizar Todos os Arquivos (${totalExists}/${bank.length} prontos)`,
      description: "Garante que a estrutura .omnicode/memory-bank/ esteja completa e persistida",
      onSelect: () => {
        try {
          const folder = dir()
          if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true })
          }
          for (const item of MEMORY_FILES) {
            const target = item.name === "memory.md" ? rootMemoryPath() : path.join(folder, item.name)
            if (!fs.existsSync(target)) {
              fs.writeFileSync(
                target,
                `# ${item.label}\n\n${item.description}.\n\n*Inicializado pelo OmniCode Memory Bank.*\n`,
                "utf8",
              )
            }
          }
          setVersion((v) => v + 1)
          toast.show({
            variant: "info",
            title: "🧠 Memory Bank Inicializado",
            message: "Todos os arquivos do banco de memória persistente foram criados em .omnicode/memory-bank/",
          })
        } catch {
          toast.show({
            variant: "warning",
            title: "Erro ao inicializar",
            message: "Não foi possível criar os arquivos do Memory Bank.",
          })
        }
      },
    })

    for (const f of bank) {
      const statusIcon = f.exists ? (f.size > 0 ? "●" : "○") : "×"
      const statusLabel = f.exists
        ? f.size > 0
          ? `${(f.size / 1024).toFixed(1)} KB`
          : "Vazio (0 KB)"
        : "Não criado"

      list.push({
        value: f.path,
        title: `${statusIcon} ${f.label} [${statusLabel}]`,
        description: f.description,
        onSelect: () => {
          if (!f.exists) {
            try {
              const folder = path.dirname(f.path)
              if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true })
              fs.writeFileSync(
                f.path,
                `# ${f.label}\n\n${f.description}.\n\n*Inicializado pelo OmniCode Memory Bank.*\n`,
                "utf8",
              )
              setVersion((v) => v + 1)
              toast.show({
                variant: "info",
                title: "Arquivo Criado",
                message: `${f.name} criado com sucesso.`,
              })
            } catch {
              // fallback
            }
          } else {
            dialog.clear()
            // open file path in editor
            void openEditor({ value: f.path, renderer: null as any, cwd: paths.cwd })
          }
        },
      })
    }

    return list
  })

  return (
    <DialogSelect
      title="🧠 OmniCode — Banco de Memória Persistente (Memory Bank)"
      placeholder="Pesquisar arquivos de memória..."
      options={options()}
    />
  )
}

