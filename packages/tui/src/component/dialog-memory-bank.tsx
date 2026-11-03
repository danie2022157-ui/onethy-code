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
    label: "Active Context (active-context.md)",
    description: "Current sprint focus, recent discoveries, and immediate next steps",
    template: [
      "# Active Context",
      "",
      "## 1. Current Focus",
      "- Feature or refactoring currently under development.",
      "",
      "## 2. Immediate Next Steps",
      "- [ ] Next concrete task.",
      "",
      "## 3. Recent Discoveries & Decisions",
      "- Guidance and notes for subagents and future sessions.",
    ].join("\n"),
  },
  {
    names: ["project-brief.md", "projectbrief.md"],
    label: "Project Brief (project-brief.md)",
    description: "High-level overview, core goals, and project scope",
    template: [
      "# Project Brief",
      "",
      "## 1. Overview & Goals",
      "- Core purpose of this project.",
      "- Problems it solves and value delivered.",
      "",
      "## 2. Requirements & Scope",
      "- Essential capabilities.",
      "- What is explicitly out of scope.",
      "",
      "## 3. Success Criteria",
      "- Stability, test coverage, and specification adherence.",
    ].join("\n"),
  },
  {
    names: ["system-patterns.md", "systemPatterns.md"],
    label: "System Patterns (system-patterns.md)",
    description: "Architecture, code conventions, and structural patterns",
    template: [
      "# System Patterns & Architecture",
      "",
      "## 1. System Architecture",
      "- Layers and separation of concerns.",
      "- Dependency direction and import conventions.",
      "",
      "## 2. Coding Patterns & Conventions",
      "- Naming conventions, error handling, and style rules.",
      "- Schema rules and typing.",
      "",
      "## 3. Key Architectural Decisions (ADRs)",
      "- Critical decisions and technical rationale.",
    ].join("\n"),
  },
  {
    names: ["tech-context.md", "techContext.md"],
    label: "Technology Context (tech-context.md)",
    description: "Languages, frameworks, versions, and build constraints",
    template: [
      "# Tech Context",
      "",
      "## 1. Technology Stack",
      "- Runtime / Core languages.",
      "- Frameworks, libraries, and databases.",
      "",
      "## 2. Development Commands & Scripts",
      "- Tests: test suite execution command.",
      "- Build / Lint / Typecheck: validation scripts.",
      "",
      "## 3. Environment Constraints",
      "- OS compatibility, environment variables, and security constraints.",
    ].join("\n"),
  },
  {
    names: ["memory.md"],
    label: "Global Memory Notes (memory.md)",
    description: "Persistent repository of project preferences in .omnicode/memory.md",
    isRoot: true,
    template: [
      "# OmniCode Global Memory Notes",
      "",
      "Durable architectural decisions and long-term project knowledge.",
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
    version()
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

    if (fs.existsSync(folder)) {
      try {
        const customFiles = fs.readdirSync(folder).filter((f) => f.endsWith(".md"))
        for (const file of customFiles) {
          if (!seenFiles.has(file.toLowerCase())) {
            const p = path.join(folder, file)
            const stat = fs.statSync(p)
            result.push({
              name: file,
              label: `Custom Memory (${file})`,
              description: `Additional memory file in .omnicode/memory-bank/${file}`,
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
          title: "Memory Deleted",
          message: `File '${path.basename(filePath)}' deleted successfully.`,
        })
      }
    } catch (err) {
      toast.show({
        variant: "error",
        title: "Delete Error",
        message: `Unable to delete file: ${err}`,
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
        title: "Memory Bank Cleared",
        message: `${count} memory file(s) deleted successfully.`,
      })
    } catch (err) {
      toast.show({
        variant: "error",
        title: "Clear Error",
        message: `Error clearing memory: ${err}`,
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
      title: `⚡ Initialize All Standard Files (${totalExists}/${STANDARD_FILES.length} active)`,
      description: "Ensures .omnicode/memory-bank/ and memory.md are scaffolded with templates",
      category: "Management Actions",
      footer: "[Initialize]",
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
            title: "🧠 Memory Bank Initialized",
            message: "Persistent memory bank files created successfully.",
          })
        } catch {
          toast.show({
            variant: "warning",
            title: "Init Error",
            message: "Unable to create Memory Bank files.",
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
          : "Empty (0 KB)"
        : "Not created"

      list.push({
        value: f.path,
        title: isPendingDelete
          ? `⚠️ DELETE: ${f.label}`
          : `${statusIcon} ${f.label} [${statusLabel}]`,
        description: isPendingDelete
          ? "Press Enter or Ctrl+D again to confirm deletion of this memory file"
          : f.description,
        category: f.exists ? "Active Memory Files" : "Available Memory Files",
        footer: isPendingDelete
          ? "Press Ctrl+D again to confirm deletion"
          : f.exists
            ? "[Enter: Open · Ctrl+D: Delete]"
            : "[Enter: Create]",
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
              const template = match?.template ?? `# ${f.label}\n\n*Persistent memory file.*\n`
              fs.writeFileSync(f.path, template, "utf8")
              setVersion((v) => v + 1)
              toast.show({
                variant: "info",
                title: "File Created",
                message: `${f.name} created successfully.`,
              })
            } catch (err) {
              toast.show({
                variant: "error",
                title: "Create Error",
                message: `Failed to create file: ${err}`,
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
          ? "⚠️ CONFIRM: Clear Entire Memory Bank (.omnicode/memory-bank/)"
          : `🗑️ Clear Entire Memory Bank (${totalExists} file${totalExists > 1 ? "s" : ""})`,
        description: isPendingClearAll
          ? "Warning: All memory files will be permanently erased. Press Enter or Ctrl+D to confirm."
          : "Permanently deletes all persistent memory files in this workspace",
        category: "Management Actions",
        footer: isPendingClearAll
          ? "Press Enter or Ctrl+D to confirm"
          : "[Clear All]",
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
      title="🧠 OmniCode — Persistent Memory Bank"
      placeholder="Search memory files..."
      options={options()}
      onMove={() => setToDelete(undefined)}
      actions={[
        {
          command: "session.delete",
          title: (option) => {
            if (!option?.value) return "delete"
            if (option.value === "__clear_all__") return "clear all (Ctrl+D)"
            if (option.value === "__init__") return ""
            return toDelete() === option.value ? "confirm delete" : "delete (Ctrl+D)"
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
        { title: "open / create", label: "enter" },
        { title: "delete memory", label: "ctrl+d", side: "right" },
      ]}
    />
  )
}
