// Convert AITmpl's Claude-style MCP templates to native OnethyCode discovery files.
// No third-party process is started, credentials are never copied, and imported
// MCP servers stay disabled until the user explicitly enables and authenticates.
import { createHash } from "node:crypto"

export function safeMcpId(value) {
  const clean = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unnamed"
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 8)
  return (clean.length > 55 ? clean.slice(0, 55).replace(/-+$/g, "") : clean) + "-" + hash
}
const record = (value) => !!value && typeof value === "object" && !Array.isArray(value)
const vars = (value) => record(value) && Object.entries(value).every(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === "string")
function normalServer(input, id, warnings) {
  if (!record(input)) return null
  const suffix = safeMcpId(id)
  const common = { disabled: true }
  if (record(input.env) || record(input.environment)) {
    const values = input.env ?? input.environment
    if (!vars(values)) return null
    const names = Object.keys(values)
    if (names.length) warnings.push("MCP " + suffix + " requires external environment configuration: " + names.join(", "))
    // Never import plaintext tokens, placeholder secrets, or example database URLs.
  }
  if (typeof input.url === "string") {
    let uri
    try { uri = new URL(input.url) } catch { return null }
    if (!["https:", "http:"].includes(uri.protocol) || uri.username || uri.password) return null
    if (input.headers && record(input.headers)) {
      warnings.push("MCP " + suffix + " requires externally configured authentication headers")
    }
    return { key: "aitmpl-" + suffix, value: { ...common, type: "http", url: uri.href } }
  }
  const command = typeof input.command === "string"
    ? [input.command]
    : Array.isArray(input.command) && input.command.every(x => typeof x === "string")
      ? input.command
      : []
  const args = Array.isArray(input.args) && input.args.every(x => typeof x === "string") ? input.args : []
  if (!command.length || !command[0].trim()) return null
  if (command.some(x => /\r|\n|\0/.test(x)) || args.some(x => /\r|\n|\0/.test(x))) return null
  // Avoid shell expansion: native MCP transport always receives argv, never "sh -c".
  if (["sh", "bash", "cmd", "powershell", "pwsh"].includes(command[0].toLowerCase())) {
    warnings.push("MCP " + suffix + ": shell wrapper must be adapted manually")
    return null
  }
  return { key: "aitmpl-" + suffix, value: { ...common, type: "stdio", command: command[0], args: [...command.slice(1), ...args] } }
}
export function convertMcpTemplate(source, sourceId) {
  let parsed
  try { parsed = JSON.parse(source) } catch { return { json: null, count: 0, warnings: ["Invalid MCP JSON"] } }
  if (!record(parsed)) return { json: null, count: 0, warnings: ["Invalid MCP structure"] }
  const servers = parsed.mcpServers ?? parsed.servers ?? parsed.mcp?.servers
  if (!record(servers)) return { json: null, count: 0, warnings: ["MCP template has no mcpServers"] }
  const adapted = Object.create(null)
  const warnings = []
  for (const [name, def] of Object.entries(servers)) {
    const item = normalServer(def, sourceId + "/" + name, warnings)
    if (!item) { warnings.push("Unsupported MCP transport: " + name); continue }
    adapted[item.key] = item.value
  }
  const count = Object.keys(adapted).length
  return { json: count ? JSON.stringify({ mcpServers: adapted }, null, 2) + "\n" : null, count, warnings }
}
