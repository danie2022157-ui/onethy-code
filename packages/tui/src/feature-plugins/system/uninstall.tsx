import { Plugin } from "@opencode/plugin/tui"
import { useToast } from "../../ui/toast"

/**
 * Uninstall cannot safely delete its own running TUI executable and data.
 * This slash command is a safe entry point that explains how to finish from
 * an external shell after closing the TUI.
 */
export default Plugin.define({
  id: "onethy.unistall",
  setup(context) {
    context.ui.slot({
      append: "app",
      render() {
        const toast = useToast()
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "system.unistall",
            title: "Desinstalar OnethyCode",
            description: "Ver instruções para remover a aplicação e todos os dados",
            group: "System",
            slash: { name: "unistall", aliases: ["uninstall"] },
            palette: true,
            async run() {
              if (process.env.ONETHY_ACTIVE !== "1" && process.env.OMNICODE_ACTIVE !== "1") {
                toast.show({ message: "Este comando está disponível somente no OnethyCode.", variant: "warning" })
                return
              }
              await context.ui.dialog.alert({
                title: "Desinstalação completa do OnethyCode",
                message: [
                  "A remoção completa apaga permanentemente sessões, configurações, credenciais e cache do OnethyCode.",
                  "Seu código-fonte e projetos de clientes serão preservados.",
                  "",
                  "Feche o OnethyCode e execute em outro terminal:",
                  "onethy unistall --purge --dry-run",
                  "onethy unistall --purge",
                  "",
                  "O segundo comando solicitará confirmação antes de apagar.",
                ].join("\n"),
              })
            },
          }],
        }))
        return null
      },
    })
  },
})
