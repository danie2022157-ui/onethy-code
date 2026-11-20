import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useThemes } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { onCleanup } from "solid-js"

const ONETHY_THEME_DETAILS: Record<string, { title: string; description: string }> = {
  onethy: {
    title: "⚡ onethy",
    description: "Official Cosmic Cyberpunk • Neon cyan, electric purple & star white",
  },
  "onethy-cosmic": {
    title: "⚡ onethy-cosmic",
    description: "Deep Space Cyberpunk • Electric blue & vivid magenta accents",
  },
  "onethy-lunar": {
    title: "🌙 onethy-lunar",
    description: "Midnight Moon • Calming deep navy with soft purple glow",
  },
  "onethy-aurora": {
    title: "🌌 onethy-aurora",
    description: "Aurora Borealis • Mint green, teal glow & arctic night",
  },
  "onethy-eclipse": {
    title: "🌑 onethy-eclipse",
    description: "OLED Pitch Black • Ultra pure contrast for deep focus",
  },
}

const KNOWN_THEME_DESCRIPTIONS: Record<string, string> = {
  dracula: "Vampiric dark purple palette with vivid accents",
  tokyonight: "Celebrated neon city night from visual Tokyo",
  catppuccin: "Soothing pastel palette with cozy warm tones",
  "catppuccin-frappe": "Medium dark Catppuccin variant",
  "catppuccin-macchiato": "Rich dark Catppuccin variant",
  nord: "Arctic, north-bluish clean and minimal aesthetic",
  gruvbox: "Retro groove warm brown and orange tones",
  "one-dark": "Iconic balanced editor dark theme",
  monokai: "Classic vibrant code highlighting on dark charcoal",
  matrix: "Iconic digital rain monochrome phosphor green",
  nightowl: "Tuned for late night coding with deep navy contrasts",
  rosepine: "All natural pine, rose and gold aesthetic",
  material: "Material Design official dark palette",
  github: "GitHub official high contrast palette",
  everforest: "Comforting natural green forest tones",
  kanagawa: "Traditional Japanese painting color harmony",
  solarized: "Scientifically calibrated precision contrast",
  synthwave84: "1980s neon synthwave with glowing pinks",
  cursor: "Dark minimalist IDE theme",
  ayu: "Clean and vibrant modern dark scheme",
  vesper: "Clean near-black with bright peach accents",
  zenburn: "Low contrast warm earthy tone palette",
  system: "Follows your operating system terminal palette",
}

/** `onClose` returns to the caller, e.g. Settings, instead of closing every dialog. */
export function DialogThemeList(props: { onClose?: () => void; initialQuery?: string }) {
  const themes = useThemes()
  const allNames = Object.keys(themes.all())
  const onethyNames = allNames
    .filter((k) => k.startsWith("onethy"))
    .sort((a, b) => (a === "onethy" ? -1 : b === "onethy" ? 1 : a.localeCompare(b)))
  const otherNames = allNames
    .filter((k) => !k.startsWith("onethy"))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))

  const options = [
    ...onethyNames.map((value) => {
      const detail = ONETHY_THEME_DETAILS[value]
      return {
        title: detail?.title ?? `⚡ ${value}`,
        description: detail?.description ?? "Official Onethy theme",
        value,
        category: "⭐ Onethy Official Themes",
      }
    }),
    ...otherNames.map((value) => {
      const description = KNOWN_THEME_DESCRIPTIONS[value] ?? `Theme preset: ${value}`
      return {
        title: value,
        description,
        value,
        category: "🎨 Community & Classic Themes",
      }
    }),
  ]

  const dialog = useDialog()
  let confirmed = false
  let ref: DialogSelectRef<string>
  const initial = themes.selected

  onCleanup(() => {
    if (!confirmed) themes.preview(initial)
  })

  return (
    <DialogSelect
      title="Themes"
      searchInTitle
      titlePlaceholder="Search themes (/themes <name>)"
      options={options}
      current={initial}
      onCancel={() => {
        themes.preview(initial)
        props.onClose?.()
      }}
      onMove={(opt) => {
        themes.preview(opt.value)
      }}
      onSelect={(opt) => {
        themes.set(opt.value, true)
        confirmed = true
        if (props.onClose) return props.onClose()
        dialog.clear()
      }}
      ref={(r) => {
        ref = r
      }}
      onFilter={(query) => {
        if (query.length === 0) {
          themes.preview(initial)
          return
        }

        const first = ref.filtered[0]
        if (first) themes.preview(first.value)
      }}
    />
  )
}
