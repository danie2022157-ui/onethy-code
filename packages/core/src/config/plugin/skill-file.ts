export * as SkillFile from "./skill-file.js"

import path from "path"
import { isRecord } from "@opencode/util/record"
import { Result, Schema, type SchemaIssue, SchemaParser } from "effect"
import { ConfigMarkdown } from "../markdown.js"
import { AbsolutePath } from "../../schema.js"
import { Skill } from "../../skill.js"

const Frontmatter = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  metadata: Schema.Unknown.pipe(Schema.optional),
  "disable-model-invocation": Schema.Unknown.pipe(Schema.optional),
})
const decodeFrontmatter = SchemaParser.decodeUnknownResult(Frontmatter)

export type ParseResult =
  | { readonly _tag: "Parsed"; readonly skill: Skill.Info }
  | { readonly _tag: "Skipped"; readonly reason: "markdown" }
  | { readonly _tag: "Skipped"; readonly reason: "frontmatter"; readonly issue: SchemaIssue.Issue }

const metadataBoolean = (metadata: unknown, key: string) => {
  if (!isRecord(metadata)) return undefined
  return booleanValue(metadata[key])
}

const booleanValue = (value: unknown) => {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (["true", "yes", "on", "1"].includes(normalized)) return true
  if (["false", "no", "off", "0"].includes(normalized)) return false
  return undefined
}

export function parse(directory: string, filepath: string, content: string): ParseResult {
  if (process.env.OMNICODE_ACTIVE === "1" && filepath.endsWith(".json")) {
    try {
      const data = JSON.parse(content)
      const rootName = path.basename(directory).toLowerCase()
      const prefix =
        rootName === "hooks" ? "hook-" : rootName === "settings" ? "setting-" : "mod-"
      const base =
        typeof data?.name === "string"
          ? data.name
          : path.basename(filepath) === "plugin.json"
            ? path.basename(path.dirname(path.dirname(filepath)))
            : path.basename(filepath, ".json")
      const fullId = (base.startsWith(prefix) ? base : `${prefix}${base}`)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
      const desc =
        typeof data?.description === "string"
          ? data.description.slice(0, 300)
          : `Personalização ${fullId}`
      return {
        _tag: "Parsed",
        skill: {
          id: Skill.ID.make(fullId),
          name: Skill.Name.make(fullId),
          description: desc,
          path: AbsolutePath.make(filepath),
          content: `# ${fullId}\n\n${desc}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
        },
      }
    } catch {
      return { _tag: "Skipped", reason: "markdown" }
    }
  }
  const id =
    path.dirname(filepath) === directory && path.basename(filepath) !== "SKILL.md"
      ? path.basename(filepath, ".md")
      : path.basename(path.dirname(filepath))
  const markdown = ConfigMarkdown.parseOption(content)
  if (!markdown) {
    if (process.env.OMNICODE_ACTIVE === "1" && content.trim()) {
      return {
        _tag: "Parsed",
        skill: {
          id: Skill.ID.make(id),
          name: Skill.Name.make(id),
          description: `Skill personalizada ${id}`,
          path: AbsolutePath.make(filepath),
          content: content.trim(),
        },
      }
    }
    return { _tag: "Skipped", reason: "markdown" }
  }
  const decoded = decodeFrontmatter(markdown.data)
  if (Result.isFailure(decoded)) {
    if (process.env.OMNICODE_ACTIVE === "1") {
      const rawName = typeof markdown.data.name === "string" ? markdown.data.name : id
      const rawDesc =
        typeof markdown.data.description === "string" ? markdown.data.description : `Skill personalizada ${id}`
      return {
        _tag: "Parsed",
        skill: {
          id: Skill.ID.make(id),
          name: Skill.Name.make(rawName),
          description: rawDesc,
          path: AbsolutePath.make(filepath),
          content: markdown.content,
        },
      }
    }
    return { _tag: "Skipped", reason: "frontmatter", issue: decoded.failure }
  }
  const frontmatter = decoded.success
  const opencodeAutoinvoke = metadataBoolean(frontmatter.metadata, "opencode/autoinvoke")
  const disableModelInvocation = booleanValue(frontmatter["disable-model-invocation"])
  const autoinvoke = opencodeAutoinvoke ?? (disableModelInvocation ? false : undefined)
  return {
    _tag: "Parsed",
    skill: {
      id: Skill.ID.make(id),
      name: Skill.Name.make(frontmatter.name ?? id),
      ...(frontmatter.description === undefined ? {} : { description: frontmatter.description }),
      ...(autoinvoke === undefined ? {} : { autoinvoke }),
      path: AbsolutePath.make(filepath),
      content: markdown.content,
    },
  }
}
