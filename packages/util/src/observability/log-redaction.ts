/** Best-effort privacy filter shared by the on-disk logger and its readers.
 * Third-party messages may contain secrets in unknown formats: review before sharing.
 */
export function redact(line: string) {
  return line
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [REDACTED]")
    .replace(/\b(gh[opsru]_[a-zA-Z0-9_]{12,}|github_pat_[a-zA-Z0-9_]{12,}|sk-[a-zA-Z0-9_-]{12,}|AIza[0-9A-Za-z_-]{30,})\b/g, "[REDACTED]")
    .replace(/\b(authorization|proxy-authorization|x-api-key|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token|password|passwd|secret|cookie|set-cookie|token|credential|session[_-]?key|key|code|state)\s*([=:])\s*(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s&,}\]]+)/gi, "$1$2[REDACTED]")
    .replace(/(https?:\/\/)[^@/\s"']+:[^@/\s"']+@/gi, "$1[REDACTED]@")
}
