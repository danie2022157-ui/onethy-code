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
        title: isGlobal ? "✓ Proactive Auto-Usage: [ENABLED]" : "○ Proactive Auto-Usage: [DISABLED]",
        description: isGlobal
          ? "Active: AI autonomously selects and executes capabilities below matching the task"
          : "Inactive: AI will not automatically invoke additional resources (strict passive mode)",
        category: "Global Control",
        footer: isGlobal ? "[Active]" : "[Inactive]",
        onSelect: () => {
          cust.toggleEnabled()
          toast.show({
            variant: cust.enabled() ? "success" : "info",
            message: cust.enabled() ? "✓ Proactive Auto-Usage Enabled" : "○ Proactive Auto-Usage Disabled",
          })
        },
      },
      {
        value: "useSkills",
        title: cfg.useSkills ? "✓ Specialized Skills (@skills)" : "○ Specialized Skills (@skills)",
        description: "Automatically invoke specialized skills (testing, UI, video, SEO, security, git)",
        category: "Allowed Capabilities Matching Task",
        footer: cfg.useSkills ? "[Allowed]" : "[Ignore]",
        onSelect: () => {
          cust.toggle("useSkills")
        },
      },
      {
        value: "useAgents",
        title: cfg.useAgents ? "✓ Expert Subagents (@agents)" : "○ Expert Subagents (@agents)",
        description: "Delegate to @architect, @researcher, @coder, @reviewer on complex tasks",
        category: "Allowed Capabilities Matching Task",
        footer: cfg.useAgents ? "[Allowed]" : "[Ignore]",
        onSelect: () => {
          cust.toggle("useAgents")
        },
      },
      {
        value: "useMcps",
        title: cfg.useMcps ? "✓ Connected MCP Servers" : "○ Connected MCP Servers",
        description: "Proactively utilize external tools (browsers, databases, git, APIs)",
        category: "Allowed Capabilities Matching Task",
        footer: cfg.useMcps ? "[Allowed]" : "[Ignore]",
        onSelect: () => {
          cust.toggle("useMcps")
        },
      },
      {
        value: "useHooks",
        title: cfg.useHooks ? "✓ Automated Hooks (hook-*, /hook-*)" : "○ Automated Hooks (hook-*, /hook-*)",
        description: "Trigger pre/post task rules and automated integrity assertions",
        category: "Allowed Capabilities Matching Task",
        footer: cfg.useHooks ? "[Allowed]" : "[Ignore]",
        onSelect: () => {
          cust.toggle("useHooks")
        },
      },
      {
        value: "useMods",
        title: cfg.useMods ? "✓ Active Mods & Plugins" : "○ Active Mods & Plugins",
        description: "Leverage code extensions and plugins installed in the workspace",
        category: "Allowed Capabilities Matching Task",
        footer: cfg.useMods ? "[Allowed]" : "[Ignore]",
        onSelect: () => {
          cust.toggle("useMods")
        },
      },
      {
        value: "useCommands",
        title: cfg.useCommands ? "✓ Slash Commands & Loops (/loop-*)" : "○ Slash Commands & Loops (/loop-*)",
        description: "Suggest and run verification loops and testing pipelines",
        category: "Allowed Capabilities Matching Task",
        footer: cfg.useCommands ? "[Allowed]" : "[Ignore]",
        onSelect: () => {
          cust.toggle("useCommands")
        },
      },
      {
        value: "useSettings",
        title: cfg.useSettings ? "✓ Modes, Presets & Settings" : "○ Modes, Presets & Settings",
        description: "Respect active autonomy mode and workspace environment settings",
        category: "Allowed Capabilities Matching Task",
        footer: cfg.useSettings ? "[Allowed]" : "[Ignore]",
        onSelect: () => {
          cust.toggle("useSettings")
        },
      },
      {
        value: "enable-all",
        title: "Enable All Capabilities",
        description: "Allow full autonomous usage (Skills, Agents, MCPs, Hooks, Mods, Commands, Settings)",
        category: "Quick Actions",
        footer: "[Enable All]",
        onSelect: () => {
          cust.setAll(true)
          toast.show({
            variant: "success",
            message: "✓ All 7 autonomous orchestration capabilities enabled!",
          })
        },
      },
      {
        value: "disable-all",
        title: "Disable All Capabilities",
        description: "Disable automatic selection of any additional resources",
        category: "Quick Actions",
        footer: "[Disable All]",
        onSelect: () => {
          cust.setAll(false)
          toast.show({
            variant: "info",
            message: "All autonomous capabilities disabled.",
          })
        },
      },
      {
        value: "close",
        title: "← Done & Close",
        description: `Saved: ${cust.summary()} · Press Enter or ESC to return`,
        category: "Quick Actions",
        footer: "[Done]",
        onSelect: () => {
          dialog.clear()
        },
      },
    ]
  })

  return (
    <DialogSelect<string>
      options={options()}
      title="Proactive Capabilities Auto-Usage — OmniCode"
      titlePlaceholder="Filter capabilities (Enter to toggle)..."
      renderFilter={true}
      flat={false}
      onSelect={(opt) => {
        const item = options().find((o) => o.value === opt.value)
        item?.onSelect?.()
      }}
    />
  )
}
