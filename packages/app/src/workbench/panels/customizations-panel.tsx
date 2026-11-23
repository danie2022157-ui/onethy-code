import { batch, createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { CommandInfo, SkillInfo } from "@opencode/client/promise"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { useOnethyI18n } from "@/runtime/i18n/onethy"
import { showToast } from "@/shell/notifications/toast"
import { SearchCodeIcon, SkillsSparkIcon } from "../icons"
import { useWorkbench } from "../state"

type TranslateFn = ReturnType<typeof useOnethyI18n>["tr"]

type CategoryFilter = "all" | "skills" | "hooks" | "mods" | "settings" | "commands"

type ItemBadgeTone = "skill" | "hook" | "mod" | "setting" | "loop" | "command"

type CustomizationEntry = {
  id: string
  category: Exclude<CategoryFilter, "all">
  title: string
  subtitle?: string
  trigger: string
  description: string
  badge: string
  tone: ItemBadgeTone
  content?: string
  path?: string
  autoinvoke?: boolean
}

type LoadErrorState = {
  skills?: string
  commands?: string
}

const CATEGORY_IDS: readonly CategoryFilter[] = ["all", "skills", "hooks", "mods", "settings", "commands"]

export function CustomizationsPanel() {
  const workbench = useWorkbench()
  const { tr } = useOnethyI18n()

  const categoryLabel = (id: CategoryFilter) => {
    if (id === "all") return tr("All", "Tudo")

    if (id === "skills") return "Skills"

    if (id === "hooks") return "Hooks"

    if (id === "mods") return "Mods"

    if (id === "settings") return tr("Modes", "Modos")

    return tr("Commands", "Comandos")
  }

  const [category, setCategory] = createSignal<CategoryFilter>("all")
  const [query, setQuery] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [loadError, setLoadError] = createSignal<LoadErrorState | undefined>(undefined)
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})

  let syncGeneration = 0

  const location = createMemo(() => {
    const ctx = workbench.activeServerCtx()

    if (!ctx) return undefined

    return workbench.activeLocation() ?? ctx.data.location.default()
  })

  const skills = createMemo<readonly SkillInfo[]>(() => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc) return []

    return ctx.data.location.skill.list(loc) ?? []
  })

  const commands = createMemo<readonly CommandInfo[]>(() => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc) return []

    return ctx.data.location.command.list(loc) ?? []
  })

  const allItems = createMemo<readonly CustomizationEntry[]>(() => {
    const skillEntries = skills().map((skill) => classifySkill(skill, tr))
    const commandEntries = commands().map((cmd) => classifyCommand(cmd, tr))

    return [...skillEntries, ...commandEntries].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    )
  })

  const loadErrorText = createMemo(() => {
    const err = loadError()

    if (!err) return []

    return [
      err.skills && tr("Skills: {{message}}", "Skills: {{message}}", { message: err.skills }),
      err.commands && tr("Commands: {{message}}", "Comandos: {{message}}", { message: err.commands }),
    ].filter((message): message is string => Boolean(message))
  })

  const counts = createMemo<Record<CategoryFilter, number>>(() => {
    const list = allItems()

    return {
      all: list.length,
      skills: list.filter((item) => item.category === "skills").length,
      hooks: list.filter((item) => item.category === "hooks").length,
      mods: list.filter((item) => item.category === "mods").length,
      settings: list.filter((item) => item.category === "settings").length,
      commands: list.filter((item) => item.category === "commands").length,
    }
  })

  const filteredItems = createMemo(() => {
    const activeCat = category()
    const term = query().trim().toLowerCase()

    return allItems().filter((item) => {
      if (activeCat !== "all" && item.category !== activeCat) return false

      if (!term) return true

      const haystack = `${item.title} ${item.subtitle ?? ""} ${item.description} ${item.badge} ${item.path ?? ""} ${item.content ?? ""}`.toLowerCase()

      return haystack.includes(term)
    })
  })

  const syncCustomizations = async (opts?: { force?: boolean }) => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc) return

    const generation = ++syncGeneration
    setLoading(true)
    setLoadError(undefined)

    if (opts?.force) {
      ctx.data.location.skill.invalidate(loc)
      ctx.data.location.command.invalidate(loc)
    }

    const [skillRes, cmdRes] = await Promise.all([
      ctx.data.location.skill
        .sync(loc)
        .then(() => ({ ok: true as const }))
        .catch((err) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) })),
      ctx.data.location.command
        .sync(loc)
        .then(() => ({ ok: true as const }))
        .catch((err) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) })),
    ])

    if (generation !== syncGeneration) return

    batch(() => {
      setLoading(false)

      if (!skillRes.ok || !cmdRes.ok) {
        setLoadError({
          skills: skillRes.ok ? undefined : skillRes.message,
          commands: cmdRes.ok ? undefined : cmdRes.message,
        })

        return
      }

      setLoadError(undefined)
    })
  }

  createEffect(() => {
    const ctx = workbench.activeServerCtx()
    const loc = location()

    if (!ctx || !loc) {
      syncGeneration += 1
      setLoading(false)
      setLoadError(undefined)

      return
    }

    void syncCustomizations()
  })

  const handleUseInChat = (item: CustomizationEntry, event?: MouseEvent) => {
    event?.stopPropagation()
    workbench.insertComposerText(`${item.trigger} `)
    showToast({
      variant: "default",
      title: tr("{{trigger}} inserted in chat", "{{trigger}} inserido no chat", { trigger: item.trigger }),
      description: tr(
        "Send the message to activate this customization.",
        "Envie a mensagem para ativar esta customização.",
      ),
    })
  }

  const toggleExpand = (id: string) => {
    setExpanded(id, !expanded[id])
  }

  return (
    <Show
      when={workbench.activeServerCtx()}
      fallback={
        <div class="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
          <div class="flex size-10 items-center justify-center rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
            <SkillsSparkIcon size={18} />
          </div>
          <div class="text-[12.5px] font-medium text-v2-text-text-base">
            {tr("No active server", "Nenhum servidor ativo")}
          </div>
          <p class="max-w-[210px] text-[11.5px] leading-4 text-v2-text-text-faint">
            {tr(
              "Open a workspace to explore skills, hooks, mods, modes, and slash commands.",
              "Abra um workspace para explorar skills, hooks, mods, modos e comandos slash.",
            )}
          </p>
        </div>
      }
    >
      <div class="flex min-h-0 flex-1 flex-col bg-v2-background-bg-base text-v2-text-text-base">
        {/* Top bar */}
        <div class="flex shrink-0 items-center justify-between gap-1.5 border-b border-v2-border-border-muted px-2.5 py-1.5">
          <div class="flex min-w-0 items-center gap-1.5">
            <SkillsSparkIcon size={13} class="shrink-0 text-v2-text-text-accent" />
            <span class="truncate text-[11.5px] font-semibold text-v2-text-text-base">
              {allItems().length === 1
                ? tr("1 active item", "1 item ativo")
                : tr("{{count}} active items", "{{count}} itens ativos", { count: allItems().length })}
            </span>
          </div>

          <Tooltip placement="bottom" value={tr("Reload skills and commands", "Recarregar skills e comandos")}>
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
              aria-label={tr("Refresh customizations", "Atualizar customizações")}
              disabled={loading()}
              onClick={() => void syncCustomizations({ force: true })}
            >
              <Show when={loading()} fallback={<Icon name="refresh" size="small" class="size-3.5" />}>
                <Loader width={13} height={13} />
              </Show>
            </button>
          </Tooltip>
        </div>

        {/* Search box */}
        <div class="shrink-0 border-b border-v2-border-border-muted px-2 py-1.5">
          <div class="flex h-7 items-center gap-1.5 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-deep px-2 focus-within:border-v2-border-border-focus">
            <SearchCodeIcon size={13} class="shrink-0 text-v2-icon-icon-muted" />
            <input
              type="text"
              value={query()}
              placeholder={tr(
                "Search skills, hooks, mods, commands...",
                "Buscar skills, hooks, mods, comandos...",
              )}
              aria-label={tr("Search customizations", "Buscar customizações")}
              class="min-w-0 flex-1 bg-transparent text-[12px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query()) {
                  e.stopPropagation()
                  setQuery("")
                }
              }}
            />
            <Show when={query().length > 0}>
              <button
                type="button"
                class="flex size-4 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                aria-label={tr("Clear search", "Limpar busca")}
                onClick={() => setQuery("")}
              >
                <Icon name="outline-xmark" size="small" class="size-3" />
              </button>
            </Show>
          </div>
        </div>

        {/* Category pills */}
        <div
          role="tablist"
          aria-label={tr("Customization categories", "Categorias de customizações")}
          class="flex shrink-0 flex-wrap gap-1 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01/40 px-2 py-1.5"
        >
          <For each={CATEGORY_IDS}>
            {(pillId) => {
              const active = () => category() === pillId
              const count = () => counts()[pillId]

              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={active()}
                  class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors"
                  classList={{
                    "border-v2-border-border-strong bg-v2-background-bg-accent text-v2-text-text-inverse": active(),
                    "border-v2-border-border-muted bg-v2-background-bg-base text-v2-text-text-muted hover:border-v2-border-border-base hover:text-v2-text-text-base":
                      !active(),
                  }}
                  onClick={() => setCategory(pillId)}
                >
                  <span>{categoryLabel(pillId)}</span>
                  <span
                    class="font-mono text-[9.5px]"
                    classList={{
                      "opacity-85": active(),
                      "text-v2-text-text-faint": !active(),
                    }}
                  >
                    {count()}
                  </span>
                </button>
              )
            }}
          </For>
        </div>

        {/* Item list */}
        <div data-slot="workbench-scroll" class="min-h-0 flex-1 overflow-y-auto p-2">
          <For each={loadErrorText()}>
            {(message) => (
              <div class="mb-2 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger px-2.5 py-1.5 text-[11px] text-v2-state-fg-danger">
                {message}
              </div>
            )}
          </For>

          <Show
            when={!loading() || allItems().length > 0}
            fallback={
              <div class="flex items-center justify-center gap-2 py-8 text-[12px] text-v2-text-text-faint">
                <Loader width={14} height={14} />
                <span>{tr("Loading customizations...", "Carregando customizações...")}</span>
              </div>
            }
          >
            <Show
              when={filteredItems().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                  <div class="flex size-9 items-center justify-center rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
                    <SkillsSparkIcon size={16} />
                  </div>
                  <div class="text-[12px] font-medium text-v2-text-text-base">
                    {query().trim()
                      ? tr("No items found", "Nenhum item encontrado")
                      : tr("No customizations in this category", "Nenhuma customização nesta categoria")}
                  </div>
                  <p class="max-w-[215px] text-[11px] leading-4 text-v2-text-text-faint">
                    {query().trim()
                      ? tr(
                          'No results for "{{query}}". Try another term or change the filter.',
                          'Sem resultados para "{{query}}". Tente outro termo ou mude o filtro.',
                          { query: query().trim() },
                        )
                      : tr(
                          "Add files to .opencode/skills or .opencode/commands to expand the workspace.",
                          "Adicione arquivos em .opencode/skills ou .opencode/commands para expandir o workspace.",
                        )}
                  </p>
                </div>
              }
            >
              <div class="flex flex-col gap-1.5">
                <For each={filteredItems()}>
                  {(item) => {
                    const isOpen = () => Boolean(expanded[item.id])

                    return (
                      <div class="rounded-[7px] border border-v2-border-border-muted bg-v2-background-bg-layer-01/60 transition-colors hover:border-v2-border-border-base">
                        <div
                          role="button"
                          tabIndex={0}
                          aria-expanded={isOpen()}
                          class="flex cursor-pointer items-start gap-1.5 px-2 py-2 text-left"
                          onClick={() => toggleExpand(item.id)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" && e.key !== " ") return
                            e.preventDefault()
                            toggleExpand(item.id)
                          }}
                        >
                          <Icon
                            name="outline-chevron-right"
                            size="small"
                            class="mt-0.5 size-3.5 shrink-0 text-v2-icon-icon-muted transition-transform duration-150"
                            classList={{ "rotate-90": isOpen() }}
                          />

                          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                            <div class="flex items-center gap-1.5 min-w-0">
                              <span
                                class="truncate font-mono text-[11.5px] font-semibold text-v2-text-text-base"
                                title={item.title}
                              >
                                {item.title}
                              </span>
                              <span
                                class={`shrink-0 rounded border px-1.5 py-0.5 text-[9.5px] font-medium leading-none ${toneBadgeClass(item.tone)}`}
                              >
                                {item.badge}
                              </span>
                              <Show when={item.autoinvoke}>
                                <span
                                  class="shrink-0 rounded bg-v2-background-bg-layer-02 px-1 py-0.5 text-[9px] text-v2-text-text-muted"
                                  title={tr(
                                    "Automatically activated when relevant",
                                    "Ativada automaticamente quando relevante",
                                  )}
                                >
                                  auto
                                </span>
                              </Show>
                            </div>

                            <p class="line-clamp-2 text-[11px] leading-4 text-v2-text-text-muted">
                              {item.description}
                            </p>
                          </div>

                          <Tooltip
                            placement="top"
                            value={tr("Use {{trigger}} in Chat", "Usar {{trigger}} no Chat", {
                              trigger: item.trigger,
                            })}
                          >
                            <button
                              type="button"
                              class="shrink-0 rounded-[5px] border border-v2-border-border-base bg-v2-background-bg-base px-1.5 py-1 text-[10px] font-medium text-v2-text-text-base transition-colors hover:border-v2-border-border-strong hover:bg-v2-overlay-simple-overlay-hover"
                              aria-label={tr("Use {{trigger}} in chat", "Usar {{trigger}} no chat", {
                                trigger: item.trigger,
                              })}
                              onClick={(e) => handleUseInChat(item, e)}
                            >
                              {tr("Use", "Usar")}
                            </button>
                          </Tooltip>
                        </div>

                        <Show when={isOpen()}>
                          <div class="border-t border-v2-border-border-muted/80 px-2.5 py-2 flex flex-col gap-2">
                            <Show when={item.subtitle}>
                              {(sub) => (
                                <div class="text-[11px] font-medium text-v2-text-text-base">{sub()}</div>
                              )}
                            </Show>

                            <p class="text-[11px] leading-4 text-v2-text-text-muted">{item.description}</p>

                            <Show when={item.content && item.content.trim().length > 0}>
                              <pre class="max-h-48 overflow-y-auto rounded-[5px] border border-v2-border-border-muted bg-v2-background-bg-deep p-2 font-mono text-[10.5px] leading-4 whitespace-pre-wrap break-words text-v2-text-text-base">
                                {previewContent(item.content ?? "")}
                              </pre>
                            </Show>

                            <Show when={item.path}>
                              {(skillPath) => (
                                <div
                                  class="truncate font-mono text-[10px] text-v2-text-text-faint"
                                  title={skillPath()}
                                >
                                  {skillPath()}
                                </div>
                              )}
                            </Show>

                            <div class="flex items-center justify-between gap-2 pt-0.5">
                              <span class="font-mono text-[10px] text-v2-text-text-faint">
                                {tr("Trigger: {{trigger}}", "Gatilho: {{trigger}}", { trigger: item.trigger })}
                              </span>
                              <button
                                type="button"
                                class="inline-flex items-center gap-1 rounded-[5px] bg-v2-background-bg-accent px-2.5 py-1 text-[11px] font-medium text-v2-text-text-inverse transition-opacity hover:opacity-90"
                                onClick={(e) => handleUseInChat(item, e)}
                              >
                                <Icon name="plus" size="small" class="size-3" />
                                <span>{tr("Use in Chat", "Usar no Chat")}</span>
                              </button>
                            </div>
                          </div>
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </Show>
  )
}

function classifySkill(skill: SkillInfo, tr: TranslateFn): CustomizationEntry {
  const isHook = skill.id.startsWith("hook-") || skill.name.startsWith("hook-")
  const isMod = skill.id.startsWith("mod-") || skill.name.startsWith("mod-")
  const isSetting = skill.id.startsWith("setting-") || skill.name.startsWith("setting-")

  const category: CustomizationEntry["category"] = isHook
    ? "hooks"
    : isMod
      ? "mods"
      : isSetting
        ? "settings"
        : "skills"

  const tone: ItemBadgeTone = isHook ? "hook" : isMod ? "mod" : isSetting ? "setting" : "skill"
  const badge = isHook ? "Hook" : isMod ? "Mod" : isSetting ? tr("Mode", "Modo") : "Skill"
  const trigger = `@${skill.id}`

  return {
    id: `skill:${skill.id}`,
    category,
    title: trigger,
    subtitle: skill.name !== skill.id ? skill.name : undefined,
    trigger,
    description: skill.description?.trim() || skill.name,
    badge,
    tone,
    content: skill.content,
    path: skill.path,
    autoinvoke: skill.autoinvoke,
  }
}

function classifyCommand(cmd: CommandInfo, tr: TranslateFn): CustomizationEntry {
  const isLoop = cmd.name.startsWith("loop-")
  const isHookCmd = cmd.name.startsWith("hook-")
  const trigger = `/${cmd.name}`

  return {
    id: `cmd:${cmd.name}`,
    category: "commands",
    title: trigger,
    trigger,
    description:
      cmd.description?.trim() || tr("Slash command {{trigger}}", "Comando slash {{trigger}}", { trigger }),
    badge: isLoop ? "Loop" : isHookCmd ? "Hook Cmd" : tr("Command", "Comando"),
    tone: isLoop ? "loop" : isHookCmd ? "hook" : "command",
  }
}

function toneBadgeClass(tone: ItemBadgeTone) {
  if (tone === "hook") return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"

  if (tone === "mod") return "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400"

  if (tone === "setting") return "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400"

  if (tone === "loop") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"

  if (tone === "command") return "border-v2-border-border-base bg-v2-background-bg-layer-02 text-v2-text-text-muted"

  return "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400"
}

function previewContent(raw: string) {
  const trimmed = raw.trim()

  if (trimmed.length <= 1800) return trimmed

  return `${trimmed.slice(0, 1800)}\n...`
}
