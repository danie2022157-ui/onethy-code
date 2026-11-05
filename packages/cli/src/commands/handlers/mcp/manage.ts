import { intro, outro, select } from "@clack/prompts"
import { Effect } from "effect"
import { Global } from "@opencode/util/global"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, prompt, requireInteractive } from "../../../ui/prompt"
import { managedMcpList, type McpAction } from "../../../services/mcp-manager"
import { confirmAction, perform } from "./shared"

export default Runtime.handler(
  Commands.commands.mcp.commands.manage,
  Effect.fn("cli.mcp.manage")((input) =>
    Effect.gen(function* () {
      yield* requireInteractive("O menu MCP requer um terminal interativo. Use 'onethy mcp list' ou os comandos enable/disable/remove/restore.")
      intro("OnethyCode • Gerenciamento de MCPs")
      const global = yield* Global.Service
      const items = yield* Effect.promise(() => managedMcpList(process.cwd(), global.config))
      const name = yield* prompt<string>(() => select({
        message: "Qual MCP deseja gerenciar?",
        options: items.map(item => ({
          value: item.name,
          label: item.name,
          hint: [
            item.kind === "native" ? "nativo" : "personalizado",
            !item.present ? "não instalado" : item.enabled === true ? "habilitado" : item.enabled === false ? "desativado" : "sem autorização explícita",
            item.location === "global" ? "global" : item.location === "project" ? "projeto" : "restaurável",
          ].join(" • "),
        })),
      }))
      const item = items.find(entry => entry.name === name)!
      const actions: Array<{value: McpAction; label: string; hint: string}> = []
      if (item.present) {
        actions.push({ value: "enable", label: "Ativar", hint: "Permite iniciar o servidor" })
        actions.push({ value: "disable", label: "Desativar", hint: "Mantém configuração e arquivos" })
        actions.push({ value: "remove", label: "Excluir", hint: "Remove do escopo selecionado" })
      }
      if (item.kind === "native") actions.push({
        value: "restore", label: "Restaurar configuração nativa", hint: "Reverte o modelo original, desativado",
      })
      const action = yield* prompt<McpAction>(() => select({
        message: "O que deseja fazer?",
        options: actions,
      }))
      if (action === "remove" || action === "restore") {
        const ok = yield* confirmAction(
          action === "remove"
            ? `Excluir MCP "${name}" da configuração ${input.global ? "global" : "do projeto"}?`
            : `Restaurar configuração original de "${name}" e redefinir sua autorização nesse escopo?`,
          false,
        )
        if (!ok) {
          outro("Nenhuma alteração realizada.")
          return
        }
      }
      yield* perform({ action, name, global: input.global })
      outro("Configuração salva. Confira a conexão com: onethy mcp doctor")
    }).pipe(handlePromptErrors),
  ),
)
