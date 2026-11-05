// Only self-contained local MCP templates are eligible for discovery.
// Any server that might require an API key, sign-in, OAuth, bearer header,
// remote hosted service, or provider account is excluded at import time.
// All accepted definitions remain disabled until the user enables them.
import { createHash } from "node:crypto"

const safePrograms = new Set(["npx", "npx.cmd", "uvx"])
const noAccountPackages = new Set([
  "@modelcontextprotocol/server-memory",
  "@modelcontextprotocol/server-sequential-thinking",
  "@modelcontextprotocol/server-filesystem",
  "@modelcontextprotocol/server-sqlite",
  "@modelcontextprotocol/server-everything",
  "mcp-server-time",
  "mcp-server-sqlite",
  "mcp-server-fetch",
])
const blocked = /(?:api[-_ ]?key|token|secret|pass(?:word)?|oauth|authorization|bearer|login|sign[-_ ]?in|credential|client[-_ ]?id|client[-_ ]?secret|account|webhook|github|stripe|slack|notion|discord|linear|google|aws|azure|cloudflare|supabase|postg(?:res)?|database[-_ ]?url|connection[-_ ]?string|salesforce|hubspot|jira|zendesk|figma|tavily|brave|serpapi|openai|anthropic)/i

export function safeMcpId(value) {
  const clean = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unnamed"
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 8)
  return (clean.length > 55 ? clean.slice(0, 55).replace(/-+$/g, "") : clean) + "-" + hash
}
function record(value) { return !!value && typeof value === "object" && !Array.isArray(value) }
function eligibleServer(input, name, warnings) {
  if (!record(input)) return null
  const unsupportedFields = ["env", "environment", "headers", "oauth", "authorization", "auth",
    "apiKey", "api_key", "credentials", "token", "password", "url", "endpoint", "secrets",
    "clientId", "clientSecret", "serviceAccount"]
  if (unsupportedFields.some(field => Object.hasOwn(input, field))) {
    warnings.push("Skipped account-dependent or remote MCP: " + name)
    return null
  }
  const argv = typeof input.command === "string" ? [input.command]
    : Array.isArray(input.command) && input.command.every(x => typeof x === "string")
      ? [...input.command] : []
  const extra = input.args === undefined ? [] :
    Array.isArray(input.args) && input.args.every(x => typeof x === "string") ? input.args : null
  if (!argv.length || extra === null) return null
  const [program, ...firstArgs] = argv
  if (!safePrograms.has(program.toLowerCase())) return null
  const args = [...firstArgs, ...extra]
  if (args.some(x => /[\r\n\0]/.test(x) || blocked.test(x) || /\$\{|%[A-Za-z_]+%/.test(x))) return null
  // No shell, package scripts, arbitrary URLs, or downloads from unknown vendors.
  const packages = args.filter(x => !x.startsWith("-"))
  if (packages.length === 0 || !noAccountPackages.has(packages[0])) return null
  // File access and database targets must be provided consciously, not imported
  // from an untrusted catalog. No additional positional arguments are allowed.
  if (packages.length !== 1) return null
  if (args.some(x => /^https?:\/\//i.test(x))) return null
  if (args.some(x => x.startsWith("-") && !["-y", "--yes"].includes(x))) return null
  if (args.filter(x => noAccountPackages.has(x)).length !== 1) return null
  if (blocked.test(name) && !/filesystem|sequential|thinking|memory|sqlite|fetch|time|everything/i.test(name))
    return null
  return { type: "stdio", command: program, args, disabled: true }
}
export function convertMcpTemplate(source, sourceId) {
  let parsed
  try { parsed = JSON.parse(source) } catch { return { json: null, count: 0, warnings: ["Invalid MCP JSON"] } }
  if (!record(parsed)) return { json: null, count: 0, warnings: ["Invalid MCP JSON object"] }
  const servers = parsed.mcpServers ?? parsed.servers ?? parsed.mcp?.servers
  if (!record(servers)) return { json: null, count: 0, warnings: ["Missing MCP server declarations"] }
  const output = Object.create(null)
  const warnings = []
  for (const [name, entry] of Object.entries(servers)) {
    const server = eligibleServer(entry, name, warnings)
    if (!server) {
      if (!warnings.some(w => w.endsWith(": " + name))) warnings.push("Excluded non-local or unverified MCP: " + name)
      continue
    }
    output["onethy-" + safeMcpId(sourceId + "/" + name)] = server
  }
  const count = Object.keys(output).length
  return { json: count ? JSON.stringify({ mcpServers: output }, null, 2) + "\n" : null, count, warnings }
}
