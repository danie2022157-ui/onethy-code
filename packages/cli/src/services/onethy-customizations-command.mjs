/**
 * Transform OnethyCode / Claude command templates into native OnethyCode
 * command Markdown. Preserve $ARGUMENTS and $N placeholders, but never allow
 * Markdown's !`shell` interpolation to execute as a side effect of invoking
 * an imported command.
 */
const intro = (name) => [
  "## OnethyCode imported customization",
  "This command was imported from OnethyCode (" + name + ").",
  "Use the tools actually available in the active workspace.",
  "Check project context before acting. Respect existing permissions.",
  "Shell snippets in the original template were NOT automatically executed.",
  "",
].join("\n")
export function convertOnethyCodeCommand(content, name) {
  let header = ""
  let body = content
  if (content.startsWith("---\n")) {
    const end = content.indexOf("\n---\n", 4)
    if (end >= 0) {
      header = content.slice(4, end)
      body = content.slice(end + 5)
    }
  }
  const descriptionLine = header.match(/^description:\s*(.+)$/m)?.[1]?.trim()
  let description = descriptionLine || ("OnethyCode custom command: " + name)
  if (/^["'].*["']$/.test(description)) description = description.slice(1, -1)
  description = description.replace(/\s+/g, " ").slice(0, 420)
  const warnings = []
  if (/(^|\s)!\x60/.test(body)) warnings.push("Claude shell interpolations stripped")
  // Removes shell-injection interpolation that OnethyCode would otherwise run
  // eagerly when a slash command is invoked.
  body = body.replace(/!\x60[^\x60]*\x60/g, "(Original shell output omitted; inspect the project safely with available tools.)")
  if (/(\/\w[\w-]*|\bTask\b|\bmcp__\w+)/.test(body)) {
    warnings.push("May reference other Claude-specific components")
  }
  return {
    body: "---\ndescription: " + JSON.stringify(description) + "\n---\n\n" + intro(name) + body,
    warning: warnings.join("; "),
  }
}
