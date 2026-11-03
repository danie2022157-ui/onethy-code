import { expect, test } from "bun:test"

const lightTheme = await Bun.file(new URL("./theme.css", import.meta.url)).text()
const tokenTheme = await Bun.file(new URL("./tokens/theme.css", import.meta.url)).text()

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  return channels.reduce((sum, channel, index) => {
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    return sum + linear * [0.2126, 0.7152, 0.0722][index]
  }, 0)
}

function contrast(foreground: string, background: string) {
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

test("legacy weak text meets WCAG AA on light and dark fallback surfaces", () => {
  expect(contrast("#6f6f6f", "#f8f8f8")).toBeGreaterThanOrEqual(4.5)

  const alpha = 0.55
  const composite = Math.round(255 * alpha + 16 * (1 - alpha))
  const darkWeak = `#${[composite, composite, composite].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
  expect(contrast(darkWeak, "#101010")).toBeGreaterThanOrEqual(4.5)
  expect(lightTheme).toContain("--text-weak: #6f6f6f;")
  expect(lightTheme).toContain("--text-weak: rgba(255, 255, 255, 0.55);")
})

test("warning foreground meets WCAG AA on its light state surface", () => {
  expect(contrast("#68552b", "#fefaec")).toBeGreaterThanOrEqual(4.5)
  expect(tokenTheme).toContain("--v2-state-fg-warning: var(--v2-yellow-1100);")
})

test("warning and info foregrounds meet WCAG AA on light and dark state surfaces", () => {
  expect(contrast("#68552b", "#fefaec")).toBeGreaterThanOrEqual(4.5)
  expect(contrast("#f2cf76", "#4b4025")).toBeGreaterThanOrEqual(4.5)
  expect(contrast("#3250df", "#ecf1fe")).toBeGreaterThanOrEqual(4.5)
  expect(contrast("#7698fd", "#021945")).toBeGreaterThanOrEqual(4.5)
})

test("OS dark fallback is limited to the absence of an explicit scheme or custom theme", () => {
  expect(tokenTheme).toContain('@media (prefers-color-scheme: dark) {\n    :root:not([data-color-scheme]):not([data-theme]) {')
  expect(tokenTheme).not.toContain("/*@media (prefers-color-scheme: dark)")
})
