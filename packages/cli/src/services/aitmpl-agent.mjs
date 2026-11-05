// AITmpl Claude Code agent markdown -> native OnethyCode subagent markdown.
// Keeps the task instructions, but does not implicitly grant permissions or
// assign a provider/model that the user might not have configured.
function description(frontmatter, name) {
  const match = frontmatter.match(/^description:\s*(.*)$/m)
  if (!match || !match[1].trim()) return "Imported AITmpl agent: " + name
  const first = match[1].trim()
  if (first === "|" || first === ">") {
    const after = frontmatter.slice(match.index + match[0].length).split("\n")
    const joined = after.filter(x => /^\s+\S/.test(x)).map(x => x.trim()).join(" ")
    return (joined || "Imported AITmpl agent: " + name).slice(0, 500)
  }
  let value = first
  if (first[0] === '"' && first.endsWith('"')) {
    try { value = JSON.parse(first) } catch { value = first.slice(1, -1) }
  } else if (first[0] === "'" && first.endsWith("'")) {
    value = first.slice(1, -1).replace(/''/g, "'")
  }
  return String(value).replace(/\s+/g, " ").slice(0, 500) || "Imported AITmpl agent: " + name
}
export function convertAITmplAgent(content, name) {
  let head = ""
  let body = content
  const warnings = []
  if (content.startsWith("---\n")) {
    const at = content.indexOf("\n---\n", 4)
    if (at !== -1) {
      head = content.slice(4, at)
      body = content.slice(at + 5)
    } else warnings.push("Agent YAML frontmatter could not be parsed")
  } else warnings.push("Agent has no YAML frontmatter")
  const summary = description(head, name)
  const disclaimer = [
    "## OnethyCode compatibility",
    "Use only tools and connected services actually available in OnethyCode.",
    "Never assume Claude Code-specific slash commands, hooks, subagents, MCPs or plugins are installed.",
    "Follow the current workspace permissions and ask for authorization before actions requiring it.",
    "",
  ].join("\n")
  if (/(context-manager|mcp__|claude\s+-p|Claude Code CLI|\/loop\b)/i.test(body)) {
    warnings.push("Instructions may reference unavailable Claude Code components")
  }
  if (/^tools:\s*/m.test(head)) warnings.push("Claude-specific agent tools replaced by current OnethyCode permissions")
  if (/^model:\s*/m.test(head)) warnings.push("Claude-specific model override omitted; inherits chosen provider")
  return {
    body: "---\ndescription: " + JSON.stringify(summary) + "\nmode: subagent\n---\n\n" + disclaimer + body,
    warning: warnings.join("; "),
  }
}
