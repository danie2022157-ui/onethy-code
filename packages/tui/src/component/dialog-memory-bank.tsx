import { createMemo, createSignal } from "solid-js"
import fs from "node:fs"
import path from "node:path"
import { useRenderer } from "@opentui/solid"
import { Global } from "@opencode/util/global"
import {
  GLOBAL_TEMPLATES,
  PROJECT_TEMPLATES,
  deleteMemoryFile,
  globalMemoryDirectory,
  globalMemoryFilename,
  initializeMemoryBank,
  memoryFilename,
  projectMemoryDirectory,
  readMemoryFile,
  writeMemoryFile,
} from "@opencode/core/omni-memory-bank"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useTuiPaths } from "../context/runtime"
import { useLocation } from "../context/location"
import { useToast } from "../ui/toast"
import { openEditor } from "../editor"

type Scope = "project" | "global"

interface MemoryEntry {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly description: string
  readonly directory: string
  readonly content: string
  readonly exists: boolean
  readonly size: number
  readonly safe: boolean
}

const PROJECT_NOTES = "# Durable project memory\n\nImportant technical decisions and long-term knowledge.\n"
const MAX_FILE_BYTES = 96 * 1024

/** This dialog manages local project memory and local user-wide memory separately. */
export function DialogMemoryBank(props: { projectDir?: string; configDir?: string } = {}) {
  const dialog = useDialog()
  const paths = useTuiPaths()
  const location = useLocation()
  const toast = useToast()
  const renderer = useRenderer()
  const [scope, setScope] = createSignal<Scope>("project")
  const [version, setVersion] = createSignal(0)

  const projectRoot = () => props.projectDir ?? location.current?.project.directory ?? paths.cwd
  const configRoot = () => props.configDir ?? process.env.OPENCODE_CONFIG_DIR ?? Global.Path.config
  const bankDir = () => scope() === "global"
    ? globalMemoryDirectory(configRoot())
    : projectMemoryDirectory(projectRoot())

  const names = () => scope() === "global" ? GLOBAL_TEMPLATES : PROJECT_TEMPLATES
  const scopeText = () => scope() === "global" ? "Global — all projects" : "Current project"

  function notify(variant: "success" | "error" | "info", title: string, message: string) {
    toast.show({ variant, title, message })
  }

  function inspect(directory: string, name: string, description: string, content: string): MemoryEntry {
    const full = path.join(directory, name)
    let exists = false
    let size = 0
    let safe = true
    try {
      const stat = fs.lstatSync(full)
      exists = true
      size = stat.size
      safe = stat.isFile() && !stat.isSymbolicLink() && size <= MAX_FILE_BYTES
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        exists = true
        safe = false
      }
    }
    return { id: full, name, label: name, description, directory, content, exists, size, safe }
  }

  const entries = createMemo(() => {
    version()
    const directory = bankDir()
    const templates = names()
    const items = Object.entries(templates).map(([name, content]) =>
      inspect(directory, name, scopeText(), content),
    )

    if (scope() === "project") {
      const notesDirectory = path.join(projectRoot(), ".omnicode")
      items.push(inspect(notesDirectory, "memory.md", "Project notes (not global)", PROJECT_NOTES))
      try {
        if (fs.existsSync(directory)) {
          const standard = new Set(Object.keys(templates))
          for (const name of fs.readdirSync(directory)) {
            if (standard.has(name)) continue
            try {
              memoryFilename(name)
            } catch {
              continue
            }
            items.push(inspect(directory, name, "Additional file for this project", "# Project memory\n"))
          }
        }
      } catch (error) {
        notify("error", "Read error", String(error))
      }
    }
    return items
  })

  function refresh() {
    setVersion((value) => value + 1)
  }

  function initBank() {
    try {
      const created = initializeMemoryBank(bankDir(), names())
      if (scope() === "project") {
        const notesDir = path.join(projectRoot(), ".omnicode")
        created.push(...initializeMemoryBank(notesDir, { "memory.md": PROJECT_NOTES }))
      }
      refresh()
      notify("success", "Memory initialized", created.length
        ? "Created: " + created.join(", ")
        : "The memory files already exist.")
    } catch (error) {
      notify("error", "Initialization failed", String(error))
    }
  }

  async function edit(entry: MemoryEntry) {
    if (!entry.safe) {
      notify("error", "File unavailable", "Invalid file, symbolic link, or larger than 96 KiB.")
      return
    }
    try {
      if (!entry.exists) {
        initializeMemoryBank(entry.directory, { [entry.name]: entry.content })
        refresh()
        notify("success", "Memory created", entry.name)
        return
      }
      const before = readMemoryFile(entry.directory, entry.name)
      if (before === undefined) throw new Error("Unable to read the selected memory file")
      // openEditor edits the supplied CONTENT in a temporary file and returns the edited text.
      // Passing the file path or a null renderer previously made editing impossible.
      const after = await openEditor({ value: before, renderer, cwd: projectRoot() })
      if (after === undefined || after === before) return
      const current = readMemoryFile(entry.directory, entry.name)
      if (current !== before) throw new Error("Memory changed while editing. Reopen it to avoid losing changes.")
      writeMemoryFile(entry.directory, entry.name, after)
      refresh()
      notify("success", "Memory updated", entry.name)
    } catch (error) {
      notify("error", "Edit failed", String(error))
    }
  }

  function confirm(title: string, description: string, action: () => void) {
    dialog.push(() => (
      <DialogSelect
        title={title}
        description={description}
        skipFilter
        options={[
          { value: "cancel", title: "Cancel", onSelect: () => dialog.pop() },
          {
            value: "confirm",
            title: "Confirm deletion",
            onSelect: () => {
              dialog.pop()
              action()
            },
          },
        ]}
        footerHints={[{ title: "select", label: "enter" }, { title: "cancel", label: "esc" }]}
      />
    ))
  }

  function remove(entry: MemoryEntry) {
    try {
      if (scope() === "global") globalMemoryFilename(entry.name)
      if (deleteMemoryFile(entry.directory, entry.name)) {
        refresh()
        notify("success", "Memory deleted", entry.name)
      } else notify("info", "File missing", entry.name)
    } catch (error) {
      notify("error", "Delete failed", String(error))
    }
  }

  function clearBank() {
    const existing = entries().filter((entry) => entry.exists)
    let count = 0
    const errors: string[] = []
    for (const entry of existing) {
      try {
        if (scope() === "global") globalMemoryFilename(entry.name)
        if (deleteMemoryFile(entry.directory, entry.name)) count++
      } catch (error) {
        errors.push(entry.name + ": " + String(error))
      }
    }
    refresh()
    if (errors.length) {
      notify("error", "Cleanup incomplete", "Deleted: " + count + ". Failures: " + errors.join("; "))
    } else notify("success", "Memory cleared", count + " file(s) deleted from this scope only.")
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const active = scope()
    const items = entries()
    const result: DialogSelectOption<string>[] = [
      {
        value: "__switch",
        title: active === "project" ? "🌐 Switch to GLOBAL memory" : "📁 Switch to PROJECT memory",
        description: active === "project"
          ? "Preferences shared across all local projects"
          : "Decisions and notes specific to the current workspace",
        category: "Management",
        onSelect: () => setScope((current) => current === "project" ? "global" : "project"),
      },
      {
        value: "__init",
        title: "Initialize default files",
        description: "Creates only missing files; existing files will not be overwritten",
        category: "Management",
        onSelect: initBank,
      },
    ]

    for (const entry of items) {
      const status = !entry.exists ? "not created" : !entry.safe ? "unavailable" : (entry.size / 1024).toFixed(1) + " KB"
      result.push({
        value: entry.id,
        title: (entry.exists ? entry.safe ? "● " : "⚠ " : "○ ") + entry.label + " [" + status + "]",
        description: entry.description,
        category: entry.exists ? "Available files" : "Files to create",
        footer: entry.safe ? (entry.exists ? "Enter: edit" : "Enter: create") : "File cannot be edited",
        onSelect: () => void edit(entry),
      })
    }

    if (items.some((entry) => entry.exists)) {
      result.push({
        value: "__clear",
        title: "🗑 Clear " + (active === "global" ? "GLOBAL" : "PROJECT"),
        description: "Requires confirmation; does not affect the other scope",
        category: "Management",
        onSelect: () => confirm(
          "Delete memory " + scopeText() + "?",
          "This permanently deletes the files in this scope. It cannot be undone.",
          clearBank,
        ),
      })
    }
    return result
  })

  function requestDelete(selected: string) {
    const entry = entries().find((file) => file.id === selected)
    if (!entry?.exists) return
    confirm("Delete " + entry.name + "?", "Only deletes this file from the memory scope " + scopeText() + ".", () => remove(entry))
  }

  return (
    <DialogSelect
      title={"🧠 Onethy Memory — " + scopeText()}
      placeholder="Search memories..."
      options={options()}
      actions={[
        {
          command: "session.delete",
          title: "delete memory",
          disabled: (option) => !entries().some((entry) => entry.id === option?.value && entry.exists),
          onTrigger: (option) => requestDelete(option.value),
        },
      ]}
      footerHints={[{ title: "open / create", label: "enter" }]}
    />
  )
}
