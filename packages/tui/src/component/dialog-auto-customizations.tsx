import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"

export function DialogAutoCustomizations() {
  const local = useLocal()
  const dialog = useDialog()
  const toast = useToast()

  const options = createMemo(() => {
    const cust = local.customizations
    const cfg = cust.config()
    const isGlobal = cust.enabled()

    return [
      {
        value: "toggle-global",
        title: isGlobal ? "✓ ⚡ Auto-Uso Geral: [ATIVADO]" : "○ ⚡ Auto-Uso Geral: [DESATIVADO]",
        description: isGlobal
          ? "Ativo: a IA seleciona e aciona proativamente os recursos abaixo conforme a tarefa"
          : "Inativo: IA não acionará recursos automaticamente (modo passivo estrito)",
        category: "Controle Geral",
        footer: isGlobal ? "[Ativo]" : "[Inativo]",
        onSelect: () => {
          cust.toggleEnabled()
          toast.show({
            variant: cust.enabled() ? "success" : "info",
            message: cust.enabled() ? "✓ Auto-Uso Geral Ativado" : "○ Auto-Uso Geral Desativado",
          })
        },
      },
      {
        value: "useSkills",
        title: cfg.useSkills ? "✓ 🛠️ Skills Especializadas (@skills)" : "○ 🛠️ Skills Especializadas (@skills)",
        description: "Carregar e executar skills automaticamente (testes, UI, vídeo, SEO, segurança, git)",
        category: "Recursos Permitidos de Acordo com a Tarefa",
        footer: cfg.useSkills ? "[Permitido]" : "[Ignorar]",
        onSelect: () => {
          cust.toggle("useSkills")
        },
      },
      {
        value: "useAgents",
        title: cfg.useAgents ? "✓ 🤖 Subagentes Especialistas (@agentes)" : "○ 🤖 Subagentes Especialistas (@agentes)",
        description: "Delegar para @architect, @researcher, @coder, @reviewer em tarefas complexas",
        category: "Recursos Permitidos de Acordo com a Tarefa",
        footer: cfg.useAgents ? "[Permitido]" : "[Ignorar]",
        onSelect: () => {
          cust.toggle("useAgents")
        },
      },
      {
        value: "useMcps",
        title: cfg.useMcps ? "✓ 🔌 Servidores MCP Conectados" : "○ 🔌 Servidores MCP Conectados",
        description: "Usar ativamente ferramentas externas (navegadores, bancos de dados, git, APIs)",
        category: "Recursos Permitidos de Acordo com a Tarefa",
        footer: cfg.useMcps ? "[Permitido]" : "[Ignorar]",
        onSelect: () => {
          cust.toggle("useMcps")
        },
      },
      {
        value: "useHooks",
        title: cfg.useHooks ? "✓ 🪝 Ganchos & Hooks (hook-*, /hook-*)" : "○ 🪝 Ganchos & Hooks (hook-*, /hook-*)",
        description: "Disparar regras pré/pós tarefa e checagens automáticas de integridade",
        category: "Recursos Permitidos de Acordo com a Tarefa",
        footer: cfg.useHooks ? "[Permitido]" : "[Ignorar]",
        onSelect: () => {
          cust.toggle("useHooks")
        },
      },
      {
        value: "useMods",
        title: cfg.useMods ? "✓ 🧩 Mods e Plugins Ativos" : "○ 🧩 Mods e Plugins Ativos",
        description: "Aproveitar extensões de código e plugins instalados no workspace",
        category: "Recursos Permitidos de Acordo com a Tarefa",
        footer: cfg.useMods ? "[Permitido]" : "[Ignorar]",
        onSelect: () => {
          cust.toggle("useMods")
        },
      },
      {
        value: "useCommands",
        title: cfg.useCommands ? "✓ ⚡ Comandos Slash & Loops (/loop-*)" : "○ ⚡ Comandos Slash & Loops (/loop-*)",
        description: "Sugerir e acionar comandos de verificação contínua e pipelines de testes",
        category: "Recursos Permitidos de Acordo com a Tarefa",
        footer: cfg.useCommands ? "[Permitido]" : "[Ignorar]",
        onSelect: () => {
          cust.toggle("useCommands")
        },
      },
      {
        value: "useSettings",
        title: cfg.useSettings ? "✓ ⚙️ Modos, Presets e Settings" : "○ ⚙️ Modos, Presets e Settings",
        description: "Respeitar modo de autonomia selecionado e configurações de ambiente",
        category: "Recursos Permitidos de Acordo com a Tarefa",
        footer: cfg.useSettings ? "[Permitido]" : "[Ignorar]",
        onSelect: () => {
          cust.toggle("useSettings")
        },
      },
      {
        value: "enable-all",
        title: "🟢 Ativar Todos os Recursos",
        description: "Permitir auto-uso total (Skills, Agentes, MCPs, Hooks, Mods, Comandos, Settings)",
        category: "Ações Rápidas",
        footer: "[Ativar Todos]",
        onSelect: () => {
          cust.setAll(true)
          toast.show({
            variant: "success",
            message: "✓ Todos os 7 recursos de auto-orquestração foram ativados!",
          })
        },
      },
      {
        value: "disable-all",
        title: "🔴 Desativar Todos os Recursos",
        description: "Desabilitar a seleção automática de qualquer recurso adicional",
        category: "Ações Rápidas",
        footer: "[Desativar]",
        onSelect: () => {
          cust.setAll(false)
          toast.show({
            variant: "info",
            message: "Todos os recursos foram desativados.",
          })
        },
      },
      {
        value: "close",
        title: "← Concluir & Fechar",
        description: `Salvo: ${cust.summary()} · Pressione Enter ou ESC para retornar`,
        category: "Ações Rápidas",
        footer: "[Concluir]",
        onSelect: () => {
          dialog.clear()
        },
      },
    ]
  })

  return (
    <DialogSelect<string>
      options={options()}
      title="⚙️ Auto-Uso de Customizações — OnethyCode"
      titlePlaceholder="Filtrar opções (Enter para alternar)..."
      renderFilter={true}
      flat={false}
      onSelect={(opt) => {
        const item = options().find((o) => o.value === opt.value)
        item?.onSelect?.()
      }}
    />
  )
}
