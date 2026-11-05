import fs from "node:fs"
import path from "node:path"

/**
 * File Explorer's "Copy as path" wraps Windows paths in double quotes.
 * Quotes must be removed BEFORE path.resolve; otherwise Node interprets the
 * pasted absolute path as a child of OnethyCode's packages/cli directory.
 */
export function cleanProjectPath(input: string): string {
  let value = input.trim()
  const outerQuotes: readonly (readonly [string, string])[] = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ]
  for (const [open, close] of outerQuotes) {
    if (value.startsWith(open) && value.endsWith(close) && value.length >= 2) {
      value = value.slice(open.length, -close.length).trim()
      break
    }
  }
  if (!value || value === "." || value === "..") throw new Error("Enter a valid project folder.")
  if (/[\u0000-\u001f]/.test(value) || /["“”‘’]/.test(value)) {
    throw new Error("Invalid path. Paste a folder path without embedded quotes or line breaks.")
  }
  return value
}

export function resolveProjectDirectory(input: string, cwd: string, platform: NodeJS.Platform = process.platform): string {
  const cleaned = cleanProjectPath(input)
  const windowsAbsolute = path.win32.isAbsolute(cleaned)
  if (platform !== "win32" && windowsAbsolute) {
    throw new Error(
      "This is a Windows path, but the OnethyCode process is running on another OS. " +
      "Run OnethyCode directly on Windows or use a filesystem path accessible to the running process.",
    )
  }
  const filepath = platform === "win32" ? path.win32 : path.posix
  // Windows drive-relative forms like C:folder and root-relative \folder are
  // ambiguous; only a full drive/UNC path or an ordinary relative name is safe.
  if (platform === "win32" && (/^[a-zA-Z]:(?![\\/])/.test(cleaned) || /^[\\/](?![\\/])/.test(cleaned))) {
    throw new Error("Use a full Windows path (such as C:\\Users\\Name\\Documents\\Project) or a folder name.")
  }
  const directory = filepath.resolve(cwd, cleaned)
  if (directory === filepath.parse(directory).root) throw new Error("The filesystem root cannot be a project.")
  return directory
}

export function requireExistingProject(directory: string) {
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error('Folder not found: ' + directory + '. Use "Create new project" to create it.')
    }
    throw error
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("The project must be a real directory, not a symbolic link.")
  }
  return directory
}

/** Never overwrites an existing project and never deletes anything from disk. */
export function createProjectDirectory(input: string, cwd: string) {
  const directory = resolveProjectDirectory(input, cwd)
  const parent = path.dirname(directory)
  try {
    requireExistingProject(parent)
  } catch (error) {
    if ((error as Error).message.startsWith("Folder not found:")) {
      throw new Error("Parent folder does not exist: " + parent + ". Choose an existing parent folder.")
    }
    throw error
  }
  if (fs.existsSync(directory)) {
    throw new Error('Folder already exists: ' + directory + '. Use "Add existing folder" instead.')
  }
  fs.mkdirSync(directory, { recursive: false })
  return directory
}

export function addProjectDirectory(input: string, cwd: string) {
  const directory = resolveProjectDirectory(input, cwd)
  return requireExistingProject(directory)
}

export type ProjectRegistry = {
  registered: string[]
  hidden: string[]
  names: Record<string, string>
}

export function visibleProjectDirectories(known: readonly string[], registry: ProjectRegistry) {
  const hidden = new Set(registry.hidden)
  return [...new Set([...registry.registered, ...known])]
    .filter((directory) => directory && !hidden.has(directory))
}

export function rememberProject(registry: ProjectRegistry, directory: string) {
  registry.hidden = registry.hidden.filter((name) => name !== directory)
  if (!registry.registered.includes(directory)) registry.registered.push(directory)
}

export function forgetProject(registry: ProjectRegistry, directory: string) {
  registry.registered = registry.registered.filter((name) => name !== directory)
  if (!registry.hidden.includes(directory)) registry.hidden.push(directory)
  delete registry.names[directory]
}
