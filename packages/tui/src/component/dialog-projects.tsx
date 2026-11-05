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

  // A bare project name should not create folders inside OnethyCode's own packages/cli source tree.
  // Prefer the user's Documents folder; fall back to the home directory.
  const projectBase = () => {
    const documents = path.join(paths.home, "Documents")
    return fs.existsSync(documents) ? documents : paths.home
  }

  function showError(title: string, error: unknown) {
    toast.show({ variant: "error", title, message: error instanceof Error ? error.message : String(error) })
  }

  function open(directory: string) {
    try {
      const normalized = addProjectDirectory(directory, projectBase())
      dialog.clear()
      const target = { directory: normalized }
      route.navigate({ type: "home", location: target })
      location.set(target)
    } catch (error) {
      showError("Could not open project", error)
    }
  }

  function promptCreate(existingFolder: boolean) {
    dialog.push(() => (
      <DialogPrompt
        title={existingFolder ? "Add existing project" : "Create new project"}
        placeholder={existingFolder ? "Path to existing folder" : "New folder name or path"}
        subtitle={existingFolder
          ? "The folder must already exist. No files will be changed."
          : "Creates an empty folder at the specified path; existing projects will not be overwritten."}
        description={() => (
          <text wrapMode="word">
            {existingFolder
              ? "Paste an existing folder path (quotes and spaces are supported). Relative paths start in: " + projectBase()
              : "Enter a new folder name or full path. Relative names are created in: " + projectBase()}
          </text>
        )}
        onCancel={() => dialog.pop()}
        onConfirm={(input) => {
          void (async () => {
            try {
              const directory = existingFolder
                ? addProjectDirectory(input, projectBase())
                : createProjectDirectory(input, projectBase())
              await change((draft) => rememberProject(draft, directory))
              toast.show({ variant: "success", title: existingFolder ? "Project added" : "Project created", message: directory })
              open(directory)
            } catch (error) {
              showError("Project management failed", error)
            }
          })()
        }}
      />
    ))
  }

  function rename(directory: string) {
    dialog.push(() => (
      <DialogPrompt
        title="Rename project in list"
        subtitle="Only changes the display name in OnethyCode; the folder remains unchanged."
        value={registry.names[directory] ?? existing().find((item) => item.canonical === directory)?.name ?? path.basename(directory)}
        onCancel={() => dialog.pop()}
        onConfirm={(input) => {
          void (async () => {
            try {
              const name = input.trim()
              if (!name || name.length > 80) throw new Error("Enter a name with no more than 80 characters.")
              await change((draft) => {
                draft.names[directory] = name
              })
              dialog.pop()
              toast.show({ variant: "success", title: "Project renamed in list", message: name })
            } catch (error) {
              showError("Could not rename project", error)
            }
          })()
        }}
      />
    ))
  }

  function remove(directory: string) {
    dialog.push(() => (
      <DialogSelect
        title="Remove project from list?"
        description={"Only the list entry will be removed. Files and sessions will be preserved: " + directory}
        skipFilter
        options={[
          { value: "cancel", title: "Cancel", onSelect: () => dialog.pop() },
          {
            value: "confirm",
            title: "Confirm removal from list",
            onSelect: () => {
              void (async () => {
                try {
                  await change((draft) => forgetProject(draft, directory))
                  dialog.pop()
                  toast.show({ variant: "success", title: "Project removed from list", message: "No files were deleted." })
                } catch (error) {
                  showError("Could not remove project", error)
                }
              })()
            },
          },
        ]}
        footerHints={[{ title: "select", label: "enter" }, { title: "back", label: "esc" }]}
      />
    ))
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => [
    {
      value: "__create",
      title: "＋ Create new project",
      description: "Create a folder and open it as a project in OnethyCode",
      category: "Management",
      onSelect: () => promptCreate(false),
    },
    {
      value: "__add",
      title: "＋ Add existing folder",
      description: "Register and open a local folder",
      category: "Management",
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
        category: "Projects",
        footer: exists ? "Enter: open" : "Folder not found · Ctrl+D to remove from list",
        onSelect: () => open(directory),
      }
    }),
  ])

  const isProject = (value: string | undefined) => Boolean(value && directories().includes(value))

  return (
    <DialogSelect
      title="📁 Onethy Code — Manage projects"
      placeholder="Search projects..."
      options={options()}
      actions={[
        {
          command: "session.rename",
          title: "rename",
          disabled: (option) => !isProject(option?.value),
          onTrigger: (option) => rename(option.value),
        },
        {
          command: "session.delete",
          title: "remove from list",
          disabled: (option) => !isProject(option?.value),
          onTrigger: (option) => remove(option.value),
        },
      ]}
      footerHints={[{ title: "open / create", label: "enter" }]}
    />
  )
}
