import { createMemo, createSignal } from "solid-js"
import fs from "fs"
import path from "path"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useTuiPaths } from "../context/runtime"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { openEditor } from "../editor"

interface MemoryBankFile {
  name: string
  label: string
  description: string
  exists: boolean
  size: number
  path: string
}

const STANDARD_FILES = [
  {
    names: ["active-context.md", "activeContext.md"],
    label: "Contexto Ativo (active-context.md)",
    description: "Foco atual da sprint, decisões recentes e próximos passos imediatos",
    template: [
      "# Active Context",
      "",
      "## 1. Foco Atual",
      "- Funcionalidade ou refatoração sendo desenvolvida no momento.",
      "",
      "## 2. Tarefas e Próximos Passos",
      "- [ ] Próxima tarefa imediata.",
      "",
      "## 3. Descobertas e Decisões Recentes",
      "- Notas para os próximos subagentes e sessões futuras.",
    ].join("\n"),
  },
  {
    names: ["project-brief.md", "projectbrief.md"],
    label: "Brief do Projeto (project-brief.md)",
    description: "Visão geral, objetivos essenciais e requisitos fundamentais",
    template: [
      "# Project Brief",
      "",
      "## 1. Visão Geral e Objetivos",
      "- Propósito central do projeto.",
      "- Problemas que resolve e valor para os usuários.",
      "",
      "## 2. Requisitos e Escopo",
      "- Funcionalidades essenciais.",
      "- O que está explicitamente FORA de escopo.",
      "",
      "## 3. Critérios de Sucesso",
      "- Estabilidade, cobertura de testes e aderência aos requisitos.",
    ].join("\n"),
  },
  {
    names: ["system-patterns.md", "systemPatterns.md"],
    label: "Padrões de Sistema (system-patterns.md)",
    description: "Arquitetura, convenções de código e decisões estruturais",
    template: [
      "# System Patterns & Arquitetura",
      "",
      "## 1. Arquitetura Geral",
      "- Camadas do sistema e separação de responsabilidades.",
      "- Direção de dependências e regras de importação.",
      "",
      "## 2. Padrões de Código e Convenções",
      "- Nomenclatura, tratamento de erros e convenções de estilo.",
      "- Regras de schema e tipagem.",
      "",
      "## 3. Decisões Arquiteturais Chave (ADRs)",
      "- Decisões importantes e suas justificativas técnicas.",
    ].join("\n"),
  },
  {
    names: ["tech-context.md", "techContext.md"],
    label: "Contexto Tecnológico (tech-context.md)",
    description: "Linguagens, frameworks, versões e restrições de ambiente",
    template: [
      "# Tech Context",
      "",
      "## 1. Stack Tecnológica",
      "- Runtime / Linguagens principais.",
      "- Frameworks, bibliotecas e bancos de dados.",
      "",
      "## 2. Comandos e Scripts de Desenvolvimento",
      "- Testes: comando para rodar testes.",
      "- Build / Lint / Typecheck: scripts de validação.",
      "",
      "## 3. Restrições do Ambiente",
      "- Compatibilidade de SO, variáveis de ambiente e requisitos de segurança.",
    ].join("\n"),
  },
  {
    names: ["memory.md"],
    label: "Notas Globais de Memória (memory.md)",
    description: "Registro persistente de preferências e decisões históricas em .omnicode/memory.md",
    isRoot: true,
    template: [
      "# Notas Globais de Memória OmniCode",
      "",
      "Registro de decisões arquiteturais e notas duráveis do projeto.",
    ].join("\n"),
  },
]

export function DialogMemoryBank() {
  const dialog = useDialog()
  const paths = useTuiPaths()
  const toast = useToast()
  const theme = useTheme()
  const [version, setVersion] = createSignal(0)
  const [toDelete, setToDelete] = createSignal<string | undefined>()

  const dir = () => {
    const root = paths.cwd ?? process.cwd()
    return path.join(root, ".omnicode", "memory-bank")
  }

  const rootMemoryPath = () => {
    const root = paths.cwd ?? process.cwd()
    return path.join(root, ".omnicode", "memory.md")
  }

  const files = createMemo<MemoryBankFile[]>(() => {
    version() // dependência reativa
    const folder = dir()
    const memoryRoot = rootMemoryPath()

    const result: MemoryBankFile[] = []
    const seenFiles = new Set<string>()

    for (const def of STANDARD_FILES) {
      let resolvedPath: string | undefined
      let exists = false
      let size = 0
      let chosenName = def.names[0]

      if (def.isRoot) {
        resolvedPath = memoryRoot
        if (fs.existsSync(resolvedPath)) {
          exists = true
          size = fs.statSync(resolvedPath).size
        }
      } else {
        for (const candidate of def.names) {
          const p = path.join(folder, candidate)
          if (fs.existsSync(p)) {
            resolvedPath = p
            exists = true
            size = fs.statSync(p).size
            chosenName = candidate
            seenFiles.add(candidate.toLowerCase())
            break
          }
        }
        if (!resolvedPath) {
          resolvedPath = path.join(folder, def.names[0])
        }
      }

      result.push({
        name: chosenName,
        label: def.label,
        description: def.description,
        exists,
        size,
        path: resolvedPath,
      })
    }

    // Identificar arquivos adicionais/customizados dentro de .omnicode/memory-bank/
    if (fs.existsSync(folder)) {
      try {
        const customFiles = fs.readdirSync(folder).filter((f) => f.endsWith(".md"))
        for (const file of customFiles) {
          if (!seenFiles.has(file.toLowerCase())) {
            const p = path.join(folder, file)
            const stat = fs.statSync(p)
            result.push({
              name: file,
              label: `Memória Customizada (${file})`,
              description: `Arquivo de memória adicional em .omnicode/memory-bank/${file}`,
              exists: true,
              size: stat.size,
              path: p,
            })
          }
        }
      } catch {}
    }

    return result
  })

  function deleteFile(filePath: string) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        setToDelete(undefined)
        setVersion((v) => v + 1)
        toast.show({
          variant: "success",
          title: "Memória Excluída",
          message: `Arquivo '${path.basename(filePath)}' excluído com sucesso.`,
        })
      }
    } catch (err) {
      toast.show({
        variant: "error",
        title: "Erro ao excluir",
        message: `Não foi possível excluir o arquivo: ${err}`,
      })
    }
  }

  function clearAll() {
    try {
      const folder = dir()
      let count = 0
      if (fs.existsSync(folder)) {
        for (const f of fs.readdirSync(folder)) {
          if (f.endsWith(".md")) {
            try {
              fs.unlinkSync(path.join(folder, f))
              count++
            } catch {}
          }
        }
      }
      const memRoot = rootMemoryPath()
      if (fs.existsSync(memRoot)) {
        try {
          fs.unlinkSync(memRoot)
          count++
        } catch {}
      }
      setToDelete(undefined)
      setVersion((v) => v + 1)
      toast.show({
        variant: "success",
        title: "Memory Bank Limpo",
        message: `${count} arquivo(s) de memória excluído(s) com sucesso.`,
      })
    } catch (err) {
      toast.show({
        variant: "error",
        title: "Erro ao limpar",
        message: `Erro ao limpar memória: ${err}`,
      })
    }
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const list: DialogSelectOption<string>[] = []
    const bank = files()
    const existingFiles = bank.filter((f) => f.exists)
    const totalExists = existingFiles.length

    list.push({
      value: "__init__",
      title: `⚡ Inicializar Todos os Arquivos Padrão (${totalExists}/${STANDARD_FILES.length} ativos)`,
      description: "Garante que a estrutura .omnicode/memory-bank/ e memory.md estejam criados com os modelos",
      category: "Ações de Gestão",
      footer: "[Inicializar]",
      onSelect: () => {
        try {
          const folder = dir()
          if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true })
          }
          for (const item of STANDARD_FILES) {
            const target = item.isRoot ? rootMemoryPath() : path.join(folder, item.names[0])
            if (!fs.existsSync(target)) {
              fs.writeFileSync(target, item.template, "utf8")
            }
          }
          setVersion((v) => v + 1)
          toast.show({
            variant: "info",
            title: "🧠 Memory Bank Inicializado",
            message: "Arquivos do banco de memória persistente foram criados.",
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
      const isPendingDelete = toDelete() === f.path
      const statusIcon = f.exists ? (f.size > 0 ? "●" : "○") : "×"
      const statusLabel = f.exists
        ? f.size > 0
          ? `${(f.size / 1024).toFixed(1)} KB`
          : "Vazio (0 KB)"
        : "Não criado"

      list.push({
        value: f.path,
        title: isPendingDelete
          ? `⚠️ EXCLUIR: ${f.label}`
          : `${statusIcon} ${f.label} [${statusLabel}]`,
        description: isPendingDelete
          ? "Pressione Enter ou Ctrl+D novamente para confirmar a exclusão deste arquivo de memória"
          : f.description,
        category: f.exists ? "Arquivos Ativos na Memória" : "Arquivos Disponíveis para Criação",
        footer: isPendingDelete
          ? "Pressione Ctrl+D novamente para confirmar exclusão"
          : f.exists
            ? "[Enter: Abrir · Ctrl+D: Excluir]"
            : "[Enter: Criar]",
        footerColor: isPendingDelete ? theme.text.feedback.warning.base : undefined,
        onSelect: () => {
          if (isPendingDelete) {
            deleteFile(f.path)
            return
          }
          if (!f.exists) {
            try {
              const folder = path.dirname(f.path)
              if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true })
              const match = STANDARD_FILES.find((s) => s.names.includes(f.name))
              const template = match?.template ?? `# ${f.label}\n\n*Arquivo de memória persistente.*\n`
              fs.writeFileSync(f.path, template, "utf8")
              setVersion((v) => v + 1)
              toast.show({
                variant: "info",
                title: "Arquivo Criado",
                message: `${f.name} criado com sucesso.`,
              })
            } catch (err) {
              toast.show({
                variant: "error",
                title: "Erro ao criar",
                message: `Falha ao criar arquivo: ${err}`,
              })
            }
          } else {
            dialog.clear()
            void openEditor({ value: f.path, renderer: null as any, cwd: paths.cwd })
          }
        },
      })
    }

    if (totalExists > 0) {
      const isPendingClearAll = toDelete() === "__clear_all__"
      list.push({
        value: "__clear_all__",
        title: isPendingClearAll
          ? "⚠️ CONFIRMAR: Limpar Todo o Banco de Memória (.omnicode/memory-bank/)"
          : `🗑️ Limpar Todo o Banco de Memória (${totalExists} arquivo${totalExists > 1 ? "s" : ""})`,
        description: isPendingClearAll
          ? "Atenção: Todos os arquivos de memória serão apagados permanentemente. Pressione Enter ou Ctrl+D para confirmar."
          : "Exclui todos os arquivos de memória persistente deste workspace",
        category: "Ações de Gestão",
        footer: isPendingClearAll
          ? "Pressione Enter ou Ctrl+D para confirmar"
          : "[Limpar Tudo]",
        footerColor: isPendingClearAll ? theme.text.feedback.error.base : undefined,
        onSelect: () => {
          if (isPendingClearAll) {
            clearAll()
            return
          }
          setToDelete("__clear_all__")
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
      onMove={() => setToDelete(undefined)}
      actions={[
        {
          command: "session.delete",
          title: (option) => {
            if (!option?.value) return "excluir"
            if (option.value === "__clear_all__") return "limpar tudo (Ctrl+D)"
            if (option.value === "__init__") return ""
            return toDelete() === option.value ? "confirmar exclusão" : "excluir (Ctrl+D)"
          },
          onTrigger: (option) => {
            if (!option.value || option.value === "__init__") return
            if (option.value === "__clear_all__") {
              if (toDelete() !== "__clear_all__") {
                setToDelete("__clear_all__")
                return
              }
              clearAll()
              return
            }
            if (toDelete() !== option.value) {
              setToDelete(option.value)
              return
            }
            deleteFile(option.value)
          },
        },
      ]}
      footerHints={[
        { title: "abrir / criar", label: "enter" },
        { title: "excluir memória", label: "ctrl+d", side: "right" },
      ]}
    />
  )
}
