import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useThemes } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { onCleanup } from "solid-js"

/** `onClose` returns to the caller, e.g. Settings, instead of closing every dialog. */
export function DialogThemeList(props: { onClose?: () => void }) {
  const themes = useThemes()
  const allNames = Object.keys(themes.all())
  const onethyNames = allNames
    .filter((k) => k.startsWith("onethy"))
    .sort((a, b) => (a === "onethy" ? -1 : b === "onethy" ? 1 : a.localeCompare(b)))
  const otherNames = allNames
    .filter((k) => !k.startsWith("onethy"))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))

  const options = [...onethyNames, ...otherNames].map((value) => {
    let title = value
    if (value === "onethy") title = `⚡ onethy (Oficial Cosmic Cyberpunk)`
    else if (value === "onethy-cosmic") title = `⚡ onethy-cosmic (Cyberpunk)`
    else if (value === "onethy-lunar") title = `🌙 onethy-lunar (Midnight Moon)`
    else if (value === "onethy-aurora") title = `🌌 onethy-aurora (Aurora Borealis Mint)`
    else if (value === "onethy-eclipse") title = `🌑 onethy-eclipse (OLED Pitch Black)`
    return {
      title,
      value,
    }
  })
  const dialog = useDialog()
  let confirmed = false
  let ref: DialogSelectRef<string>
  const initial = themes.selected

  onCleanup(() => {
    if (!confirmed) themes.set(initial)
  })

  return (
    <DialogSelect
      title="Themes"
      searchInTitle
      titlePlaceholder="Search themes"
      options={options}
      current={initial}
      onCancel={props.onClose}
      onMove={(opt) => {
        themes.set(opt.value)
      }}
      onSelect={(opt) => {
        themes.set(opt.value)
        confirmed = true
        if (props.onClose) return props.onClose()
        dialog.clear()
      }}
      ref={(r) => {
        ref = r
      }}
      onFilter={(query) => {
        if (query.length === 0) {
          themes.set(initial)
          return
        }

        const first = ref.filtered[0]
        if (first) themes.set(first.value)
      }}
    />
  )
}
