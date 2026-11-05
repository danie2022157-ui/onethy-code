import type { DesktopResult } from "@opencode/core/agent-desktop"

/** Rows for desktop diagnostics. Unlike DialogHeader.description, these always render in every TUI theme. */
export interface DesktopReportRow {
  label: string
  value: string
  severity: "normal" | "success" | "warning" | "error"
}

const MAX_ROWS = 40
const MAX_VALUE = 280

function title(text: string) {
  return text
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function severity(value: string): DesktopReportRow["severity"] {
  const normalized = value.trim().toLowerCase()
  if (["granted", "allowed", "authorized", "ready", "available", "connected", "enabled", "ok", "supported"].includes(normalized))
    return "success"
  if (["denied", "blocked", "error", "failed", "unsupported", "unavailable"].includes(normalized))
    return "error"
  if (["missing", "unknown", "prompt", "required", "not_granted", "not granted", "not_determined", "not determined"].includes(normalized))
    return "warning"
  return "normal"
}

function summary(value: unknown): string {
  if (value === null) return "Not reported"
  if (value === undefined) return "Not reported"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

export function desktopReportRows(response: DesktopResult): DesktopReportRow[] {
  const rows: DesktopReportRow[] = [{
    label: "Native command",
    value: response.ok ? "Responding" : "Failed",
    severity: response.ok ? "success" : "error",
  }]
  const seen = new WeakSet<object>()
  const add = (label: string, value: unknown) => {
    if (rows.length >= MAX_ROWS) return
    const text = summary(value)
    rows.push({
      label: title(label),
      value: text.length > MAX_VALUE ? text.slice(0, MAX_VALUE) + "…" : text,
      severity: severity(text),
    })
  }
  const walk = (value: unknown, label: string, depth: number) => {
    if (rows.length >= MAX_ROWS) return
    if (value === null || typeof value !== "object") {
      add(label, value)
      return
    }
    if (seen.has(value)) return
    seen.add(value)
    if (depth >= 5) {
      add(label, "[Nested diagnostics omitted]")
      return
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return add(label, "None")
      if (value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item)))
        return add(label, value.map(summary).join(", "))
      value.slice(0, 25).forEach((item, index) => walk(item, label + " " + (index + 1), depth + 1))
      return
    }
    const entries = Object.entries(value)
    if (entries.length === 0) return add(label, "No details")
    for (const [key, nested] of entries) {
      if (rows.length >= MAX_ROWS) break
      walk(nested, label ? label + " / " + key : key, depth + 1)
    }
  }
  if (response.version) add("Protocol version", response.version)
  const data = response.data
  if (data === undefined || data === null) add("Report", "No detailed data returned")
  else walk(data, "", 0)
  return rows
}
