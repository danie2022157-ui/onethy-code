import fs from "node:fs"
import path from "node:path"

export function resolveProjectDirectory(input: string, cwd: string): string {
  const trimmed = input.trim()
  if (!trimmed || trimmed === "." || trimmed === "..") throw new Error("Informe uma pasta de projeto válida.")
  const directory = path.resolve(cwd, trimmed)
  if (directory === path.parse(directory).root) throw new Error("A raiz do disco não pode ser um projeto.")
  return directory
}

export function requireExistingProject(directory: string) {
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("O projeto deve ser uma pasta real, não um link simbólico.")
  }
  return directory
}

/** Never overwrites an existing project and never deletes anything from disk. */
export function createProjectDirectory(input: string, cwd: string) {
  const directory = resolveProjectDirectory(input, cwd)
  const parent = path.dirname(directory)
  requireExistingProject(parent)
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
