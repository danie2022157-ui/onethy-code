import { useLanguage } from "@/runtime/i18n/language"

export function formatTemplate(template: string, params?: Record<string, string | number>) {
  if (!params) return template

  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_, key: string) => {
    const value = params[key]

    return value === undefined ? "" : String(value)
  })
}

export function formatRelativeTime(timestamp: number, intlLocale: string, now = Date.now()) {
  const diffSec = Math.round((timestamp - now) / 1000)
  const absSec = Math.abs(diffSec)
  const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto", style: "short" })

  if (absSec < 60) return rtf.format(diffSec, "second")

  const diffMin = Math.round(diffSec / 60)

  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute")

  const diffHour = Math.round(diffMin / 60)

  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour")

  const diffDay = Math.round(diffHour / 24)

  if (Math.abs(diffDay) < 30) return rtf.format(diffDay, "day")

  const diffMonth = Math.round(diffDay / 30)

  if (Math.abs(diffMonth) < 12) return rtf.format(diffMonth, "month")

  return rtf.format(Math.round(diffDay / 365), "year")
}

export function useOnethyI18n() {
  const language = useLanguage()
  const isPt = () => language.locale() === "br"
  const tr = (en: string, pt: string, params?: Record<string, string | number>) =>
    formatTemplate(isPt() ? pt : en, params)
  const relativeTime = (timestamp: number) => formatRelativeTime(timestamp, language.intl())

  return {
    locale: language.locale,
    intl: language.intl,
    isPt,
    tr,
    relativeTime,
  }
}
