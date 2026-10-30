import { Plugin } from "@opencode/plugin/tui"
import type { SessionInfo } from "@opencode/client"
import { createMemo, For, Show } from "solid-js"
import { Locale } from "../../util/locale"
import { contextUsage, sessionFamily } from "../../util/session"
import { useLocal } from "../../context/local"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function SidebarContext(props: { context: Plugin.Context; sessionID: string }) {
  let local: ReturnType<typeof useLocal> | undefined
  try {
    local = useLocal()
  } catch {
    // safely ignore outside LocalProvider
  }
  const theme = props.context.theme
  const msg = createMemo(() => props.context.data.session.message.list(props.sessionID))
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const cost = createMemo(() => props.context.data.session.cost(props.sessionID))
  const models = createMemo(() => props.context.data.location.model.list(session()?.location) ?? [])
  const providers = createMemo(() => props.context.data.location.provider.list(session()?.location) ?? [])
  const agents = createMemo(() => props.context.data.location.agent.list(session()?.location) ?? [])
  const skills = createMemo(() => props.context.data.location.skill.list(session()?.location) ?? [])
  const commands = createMemo(() => props.context.data.location.command.list(session()?.location) ?? [])
  const mcps = createMemo(() => props.context.data.location.mcp.server.list(session()?.location) ?? [])

  const customizationsSummary = createMemo(() => {
    if (process.env.OMNICODE_ACTIVE !== "1") return undefined
    const allSkills = skills()
    const hooks = allSkills.filter((s) => s.id.startsWith("hook-") || s.name.startsWith("hook-")).length
    const mods = allSkills.filter((s) => s.id.startsWith("mod-") || s.name.startsWith("mod-")).length
    const settings = allSkills.filter((s) => s.id.startsWith("setting-") || s.name.startsWith("setting-")).length
    const pureSkills = allSkills.length - hooks - mods - settings
    return {
      agents: agents().filter((a) => !a.hidden).length,
      skills: pureSkills,
      mods,
      hooks,
      settings,
      commands: commands().length,
      mcps: mcps().length,
    }
  })

  const state = createMemo(() =>
    contextUsage(msg(), models(), session()?.revert?.messageID),
  )

  const formatModel = (ref: { providerID: string; id: string; variant?: string } | undefined) => {
    if (!ref) return "auto"
    const m = models().find((item) => item.providerID === ref.providerID && item.id === ref.id)
    const p = providers().find((item) => item.id === ref.providerID)
    const modelName = m?.name ?? ref.id
    const providerName = p?.name ?? ref.providerID
    return `${modelName} (${providerName})`
  }

  const activeSubagents = createMemo(() => {
    if (process.env.OMNICODE_ACTIVE !== "1") return []
    const current = session()
    if (!current) return []
    return sessionFamily<SessionInfo>(props.context.data.session.list(), current.id).map((item) => {
      const childMsgs = props.context.data.session.message.list(item.session.id)
      const usage = contextUsage(childMsgs, models(), item.session.revert?.messageID)
      const childCost = props.context.data.session.cost(item.session.id)
      const tokLabel = usage ? ` · ${Locale.number(usage.tokens)} tok` : ""
      const costLabel = childCost > 0 ? ` (${money.format(childCost)})` : ""
      return {
        id: item.session.id,
        agent: Locale.titlecase(item.session.agent || "subagent"),
        model: `${formatModel(item.session.model ?? current.model)}${tokLabel}${costLabel}`,
        running: props.context.data.session.status(item.session.id) === "running",
      }
    })
  })

  const integrations = createMemo(() => props.context.data.location.integration.list(session()?.location) ?? [])

  const fusionSummary = createMemo(() => {
    if (process.env.OMNICODE_ACTIVE !== "1") return undefined
    const connectedIntegrationIDs = new Set(
      integrations().filter((item) => item.connections.length > 0).map((item) => item.id),
    )
    const activeModels = models().filter((m) => m.status !== "deprecated")
    const provWithModels = new Set(activeModels.map((m) => m.providerID))
    const externalProvs = providers().filter(
      (p) =>
        provWithModels.has(p.id) &&
        (connectedIntegrationIDs.has(p.integrationID ?? p.id) || p.id !== "opencode"),
    )
    const connProvs = externalProvs.length > 0 ? externalProvs : providers().filter((p) => provWithModels.has(p.id))
    const connProvIDs = new Set(connProvs.map((p) => p.id))
    const filteredModels = activeModels.filter((m) => connProvIDs.has(m.providerID))
    const nonFree = filteredModels.filter((m) => m.providerID !== "opencode" || m.cost.some((c) => c.input > 0))
    const allPool = nonFree.length > 0 ? nonFree : filteredModels.length > 0 ? filteredModels : activeModels

    const isFiltered = Boolean(local && !local.model.auto.isAllModelsAllowed())
    const candidatePool = isFiltered && local
      ? allPool.filter((m) => local.model.auto.isModelAllowed(m.providerID, m.id))
      : allPool
    const pool = candidatePool.length > 0 ? candidatePool : allPool
    const activeProviders = connProvs.filter((p) => pool.some((m) => m.providerID === p.id))

    const classify = (id: string, name: string): "efficiency" | "balanced" | "intelligence" => {
      const text = `${id} ${name}`.toLowerCase()
      if (/(flash|mini|haiku|nano|lite|small|instant|fast|8b)/.test(text)) return "efficiency"
      if (/(opus|gpt-5|gpt-6|o3|o1|pro|sonnet-4|claude-4|r1|reasoning|max|large|astra)/.test(text)) {
        return "intelligence"
      }
      return "balanced"
    }

    const pick = (bucket: "efficiency" | "balanced" | "intelligence") => {
      const order: ("efficiency" | "balanced" | "intelligence")[] =
        bucket === "efficiency"
          ? ["efficiency", "balanced", "intelligence"]
          : bucket === "intelligence"
            ? ["intelligence", "balanced", "efficiency"]
            : ["balanced", "intelligence", "efficiency"]
      const activeProv = session()?.model?.providerID
      for (const b of order) {
        const list = pool.filter((m) => classify(m.id, m.name) === b)
        if (list.length > 0) {
          return (activeProv ? list.find((m) => m.providerID === activeProv) : undefined) ?? list[0]
        }
      }
      return pool[0]
    }

    const eff = pick("efficiency")
    const bal = pick("balanced")
    const int = pick("intelligence")

    return {
      providers: (activeProviders.length > 0 ? activeProviders : connProvs).map((p) => p.name).join(", ") || "Padrão",
      modelCount: pool.length,
      totalConnectedCount: allPool.length,
      isFiltered,
      selectedList: pool.map((m) => formatModel({ providerID: m.providerID, id: m.id })),
      efficiency: eff ? formatModel({ providerID: eff.providerID, id: eff.id }) : "auto",
      balanced: bal ? formatModel({ providerID: bal.providerID, id: bal.id }) : "auto",
      intelligence: int ? formatModel({ providerID: int.providerID, id: int.id }) : "auto",
    }
  })

  const configuredSubagents = createMemo(() => {
    if (process.env.OMNICODE_ACTIVE !== "1") return []
    const current = session()
    const fallbackModel = current?.model
    const fusion = fusionSummary()
    const targetIds = ["planner", "architect", "coder", "reviewer", "librarian", "explore"]
    return targetIds.flatMap((id) => {
      const found = agents().find((a) => a.id === id)
      if (!found) return []
      const tierModel =
        found.model
          ? formatModel(found.model)
          : id === "explore" || id === "librarian"
            ? (fusion?.efficiency ?? formatModel(fallbackModel))
            : id === "architect" || id === "reviewer"
              ? (fusion?.intelligence ?? formatModel(fallbackModel))
              : (fusion?.balanced ?? formatModel(fallbackModel))
      return [
        {
          id: found.id,
          name: Locale.titlecase(found.id),
          model: tierModel,
        },
      ]
    })
  })

  return (
    <>
      <Show when={state() || cost() > 0}>
        <box>
          <text fg={theme.text.base}>
            <b>Context</b>
          </text>
          <Show when={state()}>
            {(value) => (
              <>
                <text fg={theme.text.muted}>{value().tokens.toLocaleString()} tokens</text>
                <Show when={value().percent !== undefined}>
                  <text fg={theme.text.muted}>{value().percent}% used</text>
                </Show>
              </>
            )}
          </Show>
          <Show when={cost() > 0}>
            <text fg={theme.text.muted}>{money.format(cost())} spent</text>
          </Show>
        </box>
      </Show>
      <Show when={activeSubagents().length > 0}>
        <box>
          <text fg={theme.text.base}>
            <b>Subagentes ({activeSubagents().length})</b>
          </text>
          <For each={activeSubagents()}>
            {(item) => (
              <text fg={theme.text.muted} wrapMode="none">
                {item.running ? "● " : "✓ "}
                {item.agent}: {item.model}
              </text>
            )}
          </For>
        </box>
      </Show>
      <Show when={fusionSummary()}>
        {(fusion) => (
          <box>
            <text fg={theme.text.base}>
              <b>⚡ Omni Fusion ({fusion().modelCount} {fusion().isFiltered ? "selecionados" : "modelos"})</b>
            </text>
            <text fg={theme.text.muted} wrapMode="none">
              Provedores: {fusion().providers}
            </text>
            <Show when={fusion().isFiltered}>
              <text fg={theme.text.feedback.info.base} wrapMode="none">
                Filtro: {fusion().modelCount} de {fusion().totalConnectedCount} modelos
              </text>
            </Show>
            <text fg={theme.text.muted} wrapMode="none">
              🌱 Eficiência: {fusion().efficiency}
            </text>
            <text fg={theme.text.muted} wrapMode="none">
              ⚖️ Balanceado: {fusion().balanced}
            </text>
            <text fg={theme.text.muted} wrapMode="none">
              🧠 Inteligência: {fusion().intelligence}
            </text>
            <Show when={fusion().isFiltered && fusion().modelCount <= 6}>
              <For each={fusion().selectedList}>
                {(m) => (
                  <text fg={theme.text.muted} wrapMode="none">
                    • {m}
                  </text>
                )}
              </For>
            </Show>
          </box>
        )}
      </Show>
      <Show when={configuredSubagents().length > 0}>
        <box>
          <text fg={theme.text.base}>
            <b>Modelos por Subagente</b>
          </text>
          <For each={configuredSubagents()}>
            {(item) => (
              <text fg={theme.text.muted} wrapMode="none">
                @{item.id}: {item.model}
              </text>
            )}
          </For>
        </box>
      </Show>
      <Show when={customizationsSummary()}>
        {(summary) => (
          <box>
            <text fg={theme.text.base}>
              <b>Personalizações Ativas</b>
            </text>
            <text fg={theme.text.muted} wrapMode="none">
              Agentes (@): {summary().agents} · Skills: {summary().skills}
            </text>
            <text fg={theme.text.muted} wrapMode="none">
              Mods/Plugins: {summary().mods} · Hooks: {summary().hooks}
            </text>
            <text fg={theme.text.muted} wrapMode="none">
              Modos: {summary().settings} · Cmds (/): {summary().commands}
            </text>
            <text fg={theme.text.muted} wrapMode="none">
              MCPs: {summary().mcps} · /personalizacoes
            </text>
          </box>
        )}
      </Show>
    </>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.context",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarContext context={context} sessionID={props.sessionID} />,
    })
  },
})
