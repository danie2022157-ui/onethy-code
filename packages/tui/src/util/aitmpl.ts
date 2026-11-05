import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import catalog from "../../../../vendor/aitmpl/catalog.json"

/**
 * AI Templates is an external catalog, not an extension runtime.
 * Shipped entries are pinned, searchable metadata; none are auto-installed.
 * All downloads land in a review-only directory.
 */
export type TemplateEntry = (typeof catalog.entries)[number]
const sourcePrefix = "cli-tool/components/"
const allowedTypes = new Set(["agents", "commands", "skills", "mcps", "settings", "hooks", "mods", "loops"])
const repoUrl = "https://raw.githubusercontent.com/davila7/claude-code-templates/"
const maxBytes = 1024 * 1024

export const templateCatalog = catalog

export function searchTemplates(query = "", type = "all"): TemplateEntry[] {
  const needle = query.toLowerCase().trim()
  return catalog.entries.filter((entry) => {
    if (type !== "all" && entry.type !== type) return false
    if (!needle) return true
    return [entry.id, entry.name, entry.category, entry.description].some((value) =>
      value.toLowerCase().includes(needle),
    )
  })
}

export function sourceRelative(entry: TemplateEntry): string {
  if (!allowedTypes.has(entry.type)) throw new Error("Tipo de componente não suportado")
  if (!entry.source.startsWith(sourcePrefix) || !entry.source.startsWith(sourcePrefix + entry.type + "/"))
    throw new Error("Caminho de origem não confiável")
  if (!/^[0-9a-f]{40}$/i.test(entry.sha)) throw new Error("SHA do catálogo inválido")
  if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > maxBytes)
    throw new Error("Componente maior que o limite de 1 MiB")
  const relative = entry.source.slice(sourcePrefix.length)
  if (!relative.split("/").every((part) =>
    part !== "." && part !== ".." && /^[a-zA-Z0-9._-]+$/.test(part) && !part.startsWith(".") ||
    // The reviewed Claude mod marker is an ordinary metadata directory.
    part === ".claude-plugin"
  )) throw new Error("Caminho inválido no catálogo")
  return relative
}

export function reviewTarget(entry: TemplateEntry, directory: string): string {
  const root = path.resolve(directory)
  if (!path.isAbsolute(root)) throw new Error("O projeto precisa ter um caminho absoluto")
  return path.join(root, ".omnicode", "aitmpl-review", ...sourceRelative(entry).split("/"))
}

export async function fetchVerifiedTemplate(entry: TemplateEntry): Promise<string> {
  const relative = sourceRelative(entry)
  const url = repoUrl + catalog.upstreamCommit + "/" + relative.split("/").map(encodeURIComponent).join("/")
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error("Não foi possível consultar o arquivo original (HTTP " + response.status + ")")
  const length = Number(response.headers.get("content-length") || 0)
  if (length > maxBytes) throw new Error("Arquivo remoto muito grande")
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length !== entry.size || bytes.length > maxBytes) throw new Error("O arquivo remoto mudou de tamanho")
  const sha = createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex")
  if (sha !== entry.sha) throw new Error("Arquivo remoto não corresponde ao SHA fixado no catálogo")
  return bytes.toString("utf8")
}

async function assertNoSymlink(directory: string, root: string) {
  let current = root
  for (const segment of path.relative(root, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const info = await fs.lstat(current).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return undefined
      throw err
    })
    if (info?.isSymbolicLink()) throw new Error("Não é permitido gravar através de links simbólicos")
    if (info && !info.isDirectory()) throw new Error("Um caminho da área de revisão não é um diretório")
  }
}

export async function stageTemplate(entry: TemplateEntry, directory: string): Promise<string> {
  const target = reviewTarget(entry, directory)
  const root = path.resolve(directory)
  const realRoot = await fs.realpath(root)
  if (!(await fs.stat(realRoot)).isDirectory()) throw new Error("Projeto inválido")
  await assertNoSymlink(path.dirname(target), root)
  const content = await fetchVerifiedTemplate(entry)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await assertNoSymlink(path.dirname(target), root)
  try {
    await fs.writeFile(target, content, { flag: "wx", encoding: "utf8" })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const existing = await fs.readFile(target)
    const sha = createHash("sha1").update("blob " + existing.length + "\0").update(existing).digest("hex")
    if (sha !== entry.sha) throw new Error("Arquivo existente foi alterado; não será sobrescrito")
  }
  return target
}


/**
 * After manually reviewing a staged file, a user may explicitly activate
 * single-file Markdown agents/commands/loops in the project's native config.
 * Do not activate MCPs, hooks, mods or settings: their semantics differ from
 * Claude Code and some of them execute arbitrary programs.
 * Skills can depend on additional files and must be adapted separately.
 */
export function activeTemplateTarget(entry: TemplateEntry, directory: string): string {
  if (!["agents", "commands", "loops"].includes(entry.type))
    throw new Error("Esta categoria exige adaptação manual antes de ser ativada")
  const relative = sourceRelative(entry)
  const categoryPath = relative.slice(entry.type.length + 1)
  const root = path.resolve(directory)
  return path.join(root, ".opencode", entry.type, "aitmpl", ...categoryPath.split("/"))
}

export async function activateReviewedTemplate(entry: TemplateEntry, directory: string): Promise<string> {
  const staging = reviewTarget(entry, directory)
  const target = activeTemplateTarget(entry, directory)
  const root = path.resolve(directory)
  await assertNoSymlink(path.dirname(staging), root)
  await assertNoSymlink(path.dirname(target), root)
  const contents = await fs.readFile(staging)
  const sha = createHash("sha1").update("blob " + contents.length + "\0").update(contents).digest("hex")
  if (sha !== entry.sha) throw new Error("A cópia de revisão foi alterada ou está incompleta")
  await fs.mkdir(path.dirname(target), { recursive: true })
  await assertNoSymlink(path.dirname(target), root)
  await fs.writeFile(target, contents, { flag: "wx" })
  return target
}
