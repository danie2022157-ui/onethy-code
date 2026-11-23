import { createMemo, createSignal, lazy, Match, on, onCleanup, onMount, Show, Suspense, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode/session-ui/file"
import { useFileComponent } from "@opencode/ui/context/file"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode/session-ui/pierre/selection-bridge"
import { createLineCommentControllerV2 } from "@opencode/session-ui/v2/line-comment-annotations-v2"
import { sampledChecksum } from "@opencode/util/encode"
import { LineCommentOverflowIcon } from "@opencode/ui/line-comment"
import { Menu } from "@opencode/ui/menu"
import { createKeyed, usePlugin, type LineRange, type MountedSession, type SessionScreen } from "@opencode/plugin/gui"
import { artifactKind } from "@opencode/util/artifact"
import ArtifactView from "./artifact-view"
import type { CodeEditorSearchHandle, CodeEditorSelection } from "./code-editor"
import { useShared } from "./context"
import { fileTabPath } from "./path"

const CodeEditor = lazy(() => import("./code-editor"))

type FileSelection = { startLine: number; endLine: number; startChar: number; endChar: number }

type EditorMode = "edit" | "review"

function languageLabel(filepath: string) {
  const dot = filepath.lastIndexOf(".")

  if (dot < 0) return "Texto"

  const ext = filepath.slice(dot).toLowerCase()

  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "TypeScript"

  if (ext === ".tsx") return "TSX"

  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "JavaScript"

  if (ext === ".jsx") return "JSX"

  if (ext === ".json" || ext === ".jsonc") return "JSON"

  if (ext === ".css" || ext === ".scss" || ext === ".less") return "CSS"

  if (ext === ".html" || ext === ".htm") return "HTML"

  if (ext === ".md" || ext === ".markdown" || ext === ".mdx") return "Markdown"

  if (ext === ".py" || ext === ".pyw") return "Python"

  if (ext === ".rs") return "Rust"

  if (ext === ".sql") return "SQL"

  if (ext === ".xml") return "XML"

  if (ext === ".svg") return "SVG"

  if (ext === ".yml" || ext === ".yaml") return "YAML"

  if (ext === ".toml") return "TOML"

  if (ext === ".sh" || ext === ".bash" || ext === ".zsh") return "Shell"

  if (ext === ".go") return "Go"

  if (ext === ".c" || ext === ".h") return "C"

  if (ext === ".cpp" || ext === ".cc" || ext === ".hpp") return "C++"

  if (ext === ".java") return "Java"

  if (ext === ".rb") return "Ruby"

  if (ext === ".php") return "PHP"

  if (ext === ".txt") return "Texto"

  const raw = ext.slice(1)

  return raw.length > 0 && raw.length <= 8 ? raw.toUpperCase() : "Texto"
}

function splitDisplayPath(filepath: string) {
  const normalized = filepath.replaceAll("\\", "/")
  const slash = normalized.lastIndexOf("/")

  if (slash < 0) return { dir: "", name: normalized }

  return {
    dir: normalized.slice(0, slash + 1),
    name: normalized.slice(slash + 1),
  }
}

function formatLineRangeTag(range: LineRange) {
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)

  return start === end ? `L${start}` : `L${start}-${end}`
}

function EditModeIcon() {
  return (
    <svg
      class="size-3 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5.5 12.5 2.5 13.5l1-3 8-8Z" />
    </svg>
  )
}

function ReviewModeIcon() {
  return (
    <svg
      class="size-3 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  )
}

function SaveFileIcon() {
  return (
    <svg
      class="size-3 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2h7.379a1.5 1.5 0 0 1 1.06.44l1.622 1.621a1.5 1.5 0 0 1 .439 1.06V12.5A1.5 1.5 0 0 1 12.5 14Z" />
      <path d="M11 14V9.5H5V14" />
      <path d="M5 2v3h5" />
    </svg>
  )
}

function DiscardChangesIcon() {
  return (
    <svg
      class="size-3 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 6.5h4v-4" />
      <path d="M3 6.5a5.5 5.5 0 1 1-.3 3.7" />
    </svg>
  )
}

function SendToChatIcon() {
  return (
    <svg
      class="size-3 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M14 7.5a5.5 5.5 0 0 1-5.5 5.5H4l-2.5 1.5V8A5.5 5.5 0 1 1 14 7.5Z" />
      <path d="M8 5.25v4.5" />
      <path d="M5.75 7.5h4.5" />
    </svg>
  )
}

function SavedCheckIcon() {
  return (
    <svg
      class="size-3 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  )
}

function selectionFromLines(range: LineRange): FileSelection {
  const startLine = Math.min(range.start, range.end)
  const endLine = Math.max(range.start, range.end)

  return {
    startLine,
    endLine,
    startChar: 0,
    endChar: 0,
  }
}

const selectionSide = (range: LineRange) => range.endSide ?? range.side ?? "additions"

function FileCommentMenu(props: {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <Menu gutter={4}>
        <Menu.Trigger as="button" type="button" data-slot="line-comment-v2-overflow" aria-label={props.moreLabel}>
          <LineCommentOverflowIcon />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content>
            <Menu.Item onSelect={props.onEdit}>{props.editLabel}</Menu.Item>
            <Menu.Item onSelect={props.onDelete}>{props.deleteLabel}</Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </div>
  )
}

type ScrollPos = { x: number; y: number }

type ScrollSyncState = { scroll?: HTMLDivElement; scrollFrame?: number; restoreFrame?: number; pending?: ScrollPos }

type NoteState = { openedComment: string | null; commenting: LineRange | null; selected: LineRange | null }

type FindState = { find: FileSearchHandle | null }

type EditorRuntimeState = { search: CodeEditorSearchHandle | null; savedTimer?: ReturnType<typeof setTimeout> }

function createScrollSync(input: { get: () => ScrollPos | undefined; set: (pos: ScrollPos) => void }) {
  const state: ScrollSyncState = {}
  const [code, setCode] = createSignal<HTMLElement[]>([])

  const getCode = () => {
    const el = state.scroll

    if (!el) return []

    const host = el.querySelector("diffs-container")

    if (!(host instanceof HTMLElement)) return []

    const root = host.shadowRoot

    if (!root) return []

    return Array.from(root.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
    )
  }

  const save = (next: ScrollPos) => {
    state.pending = next

    if (state.scrollFrame !== undefined) return

    state.scrollFrame = requestAnimationFrame(() => {
      state.scrollFrame = undefined

      const out = state.pending
      state.pending = undefined

      if (!out) return

      input.set(out)
    })
  }

  const onCodeScroll = (event: Event) => {
    const el = state.scroll

    if (!el) return

    const target = event.currentTarget

    if (!(target instanceof HTMLElement)) return

    save({
      x: target.scrollLeft,
      y: el.scrollTop,
    })
  }

  const sync = () => {
    const next = getCode()
    const current = code()

    if (next.length === current.length && next.every((el, i) => el === current[i])) return
    setCode(next)
  }

  const restore = () => {
    const el = state.scroll

    if (!el) return

    const pos = input.get()

    if (!pos) return

    sync()

    if (code().length > 0) {
      for (const item of code()) {
        if (item.scrollLeft !== pos.x) item.scrollLeft = pos.x
      }
    }

    if (el.scrollTop !== pos.y) el.scrollTop = pos.y

    if (code().length > 0) return

    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const queueRestore = () => {
    if (state.restoreFrame !== undefined) return

    state.restoreFrame = requestAnimationFrame(() => {
      state.restoreFrame = undefined
      restore()
    })
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (code().length === 0) sync()

    save({
      x: code()[0]?.scrollLeft ?? event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    })
  }

  // The diff's code columns scroll on their own; listen to the ones on screen.
  createKeyed(code, (items) => items.forEach((item) => makeEventListener(item, "scroll", onCodeScroll)))

  const setViewport = (el: HTMLDivElement) => {
    state.scroll = el
    // The ref runs before the file renders into the element.
    onMount(restore)
  }

  onCleanup(() => {
    if (state.scrollFrame !== undefined) cancelAnimationFrame(state.scrollFrame)

    if (state.restoreFrame !== undefined) cancelAnimationFrame(state.restoreFrame)
  })

  return {
    handleScroll,
    queueRestore,
    setViewport,
  }
}

export function SessionFileView(props: { session: MountedSession; screen: SessionScreen; id: string }) {
  const ctx = usePlugin()
  const layout = ctx.layout
  const shared = useShared()
  const fileComponent = useFileComponent()
  const file = props.screen.file
  const comment = props.screen.comment
  const composer = props.screen.composer
  // The stored side tab key doubles as the scroll key, as it did before plugins.
  const key = () => `file:${props.id}`
  const active = () => shared.active(props.session, props.id)

  const state: FindState = { find: null }

  const search = {
    register: (handle: FileSearchHandle | null) => {
      state.find = handle
    },
  }

  const path = createMemo(() => fileTabPath(file, props.id))

  const current = createMemo(() => {
    const p = path()

    if (!p) return

    return file.get(p)
  })

  const contents = createMemo(() => current()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))

  // Plain text keeps the code view; every other kind is rendered by ArtifactView.
  const artifact = createMemo(() => {
    const content = current()?.content

    return content?.type === "binary" || artifactKind(path() ?? "") !== "text"
  })

  const selectedLines = createMemo<LineRange | null>(() => {
    const p = path()

    if (!p) return null

    if (file.ready()) return file.selection.get(p) ?? null

    return shared.handoff.get(props.session.key, p) ?? null
  })

  const scrollSync = createScrollSync({
    get: () => layout.scroll.get(props.session, key()),
    set: (pos) => layout.scroll.set(props.session, key(), pos),
  })

  const selectionPreview = (source: string, selection: FileSelection) => {
    return previewSelectedLines(source, {
      start: selection.startLine,
      end: selection.endLine,
    })
  }

  const buildPreview = (filePath: string, lines: LineRange) => {
    const source = filePath === path() ? contents() : file.get(filePath)?.content?.content

    if (!source) return undefined

    return selectionPreview(source, selectionFromLines(lines))
  }

  const addCommentToContext = (input: {
    file: string
    selection: LineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? buildPreview(input.file, input.selection)

    const saved = comment.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })

    composer.attach({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: { id: string; file: string; selection: LineRange; comment: string }) => {
    comment.update(input.id, input.comment)
    const preview = input.file === path() ? buildPreview(input.file, input.selection) : undefined
    // The composer keeps a chip's preview unless the update names a new one.
    composer.update(input.id, preview ? { comment: input.comment, preview } : { comment: input.comment })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comment.remove(input.id)
    composer.detach(input.id)
  }

  const fileComments = createMemo(() => {
    const p = path()

    if (!p) return []

    return [...comment.list(p)]
  })

  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

  const [note, setNote] = createStore<NoteState>({ openedComment: null, commenting: null, selected: null })

  const syncSelected = (range: LineRange | null) => {
    const p = path()

    if (!p) return
    file.selection.set(p, range ? cloneSelectedLineRange(range) : null)
  }

  const activeSelection = () => note.selected ?? selectedLines()

  const commentsUi = createLineCommentControllerV2({
    comments: fileComments,
    label: ctx.t("ui.lineComment.submit"),
    draftKey: () => path() ?? props.id,
    mention: {
      items: (query) => file.search(query, { kind: "any" }),
    },
    getSide: selectionSide,
    state: {
      opened: () => note.openedComment,
      setOpened: (id) => setNote("openedComment", id),
      selected: () => note.selected,
      setSelected: (range) => setNote("selected", range),
      commenting: () => note.commenting,
      setCommenting: (range) => setNote("commenting", range),
      syncSelected,
      hoverSelected: syncSelected,
    },
    onSubmit: ({ comment, selection }) => {
      const p = path()

      if (!p) return
      addCommentToContext({ file: p, selection, comment, origin: "file" })
    },
    onUpdate: ({ id, comment, selection }) => {
      const p = path()

      if (!p) return
      updateCommentInContext({ id, file: p, selection, comment })
    },
    onDelete: (comment) => {
      const p = path()

      if (!p) return
      removeCommentFromContext({ id: comment.id, file: p })
    },
    editSubmitLabel: ctx.t("common.save"),
    renderCommentActions: (_, controls) => (
      <FileCommentMenu
        moreLabel={ctx.t("common.moreOptions")}
        editLabel={ctx.t("common.edit")}
        deleteLabel={ctx.t("common.delete")}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
  })

  const [mode, setMode] = createSignal<EditorMode>("edit")
  const [draft, setDraft] = createSignal<string | undefined>(undefined)
  const [editorSelection, setEditorSelection] = createSignal<CodeEditorSelection | null>(null)
  const [saving, setSaving] = createSignal(false)
  const [saveStatus, setSaveStatus] = createSignal<"idle" | "saved">("idle")
  const [reveal, setReveal] = createStore<{ line?: number; token: number }>({ line: undefined, token: 0 })
  const editorState: EditorRuntimeState = { search: null }

  onCleanup(() => {
    if (editorState.savedTimer !== undefined) clearTimeout(editorState.savedTimer)
  })

  const dirty = createMemo(() => {
    const value = draft()

    return value !== undefined && value !== contents()
  })

  const editorContent = createMemo(() => draft() ?? contents())
  const language = createMemo(() => languageLabel(path() ?? ""))
  const displayPath = createMemo(() => splitDisplayPath(path() ?? ""))
  const revealLine = createMemo(() => reveal.line ?? selectedLines()?.start)
  const chatSelection = createMemo<LineRange | null>(() => (mode() === "edit" ? editorSelection() : activeSelection()))

  const handleEditorChange = (next: string) => {
    setDraft(next === contents() ? undefined : next)

    if (saveStatus() === "saved") setSaveStatus("idle")
  }

  const saveFile = (nextText?: string) => {
    const p = path()

    if (!p || saving()) return

    const text = nextText ?? editorContent()
    const payload = new TextEncoder().encode(text)

    setSaving(true)

    void props.session.server.client.experimental.file
      .write({
        location: { directory: file.root },
        path: p,
        payload,
      })
      .then(() => file.sync(p, { force: true }))
      .then(() => {
        if (ctx.signal.aborted) return

        setDraft((currentDraft) => (currentDraft === text ? undefined : currentDraft))
        setSaveStatus("saved")

        if (editorState.savedTimer !== undefined) clearTimeout(editorState.savedTimer)

        editorState.savedTimer = setTimeout(() => {
          editorState.savedTimer = undefined
          setSaveStatus("idle")
        }, 2000)

        ctx.toast.show({
          title: ctx.t("editor.toast.saved"),
          description: p,
          variant: "success",
          duration: 2200,
        })
      })
      .catch((error) => {
        if (ctx.signal.aborted) return

        ctx.toast.show({
          title: ctx.t("editor.toast.saveFailed"),
          description: error instanceof Error ? error.message : String(error),
          variant: "error",
        })
      })
      .finally(() => {
        setSaving(false)
      })
  }

  const discardDraft = () => {
    if (saving()) return

    setDraft(undefined)
    setSaveStatus("idle")
  }

  const sendToChat = () => {
    const p = path()

    if (!p) return

    const range = chatSelection()

    if (range) {
      const selection = selectionFromLines(range)
      const source = mode() === "edit" ? editorContent() : contents()
      const preview = source ? selectionPreview(source, selection) : undefined

      composer.attach({
        type: "file",
        path: p,
        selection,
        preview,
      })
      composer.focus()
      ctx.toast.show({
        title: ctx.t("editor.toast.linesSent"),
        description: `${p}:${selection.startLine}-${selection.endLine}`,
        variant: "success",
        duration: 2000,
      })

      return
    }

    composer.attach({
      type: "file",
      path: p,
    })
    composer.focus()
    ctx.toast.show({
      title: ctx.t("editor.toast.fileSent"),
      description: p,
      variant: "success",
      duration: 2000,
    })
  }

  // Mod+F / Mod+H find or replace in the shown file; Mod+S saves when focus is outside CodeMirror.
  makeEventListener(
    window,
    "keydown",
    (event: KeyboardEvent) => {
      if (!active()) return

      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return

      const pressed = event.key.toLowerCase()

      if (pressed === "f") {
        event.preventDefault()
        event.stopPropagation()

        if (!artifact() && mode() === "edit") {
          editorState.search?.focus()

          return
        }

        state.find?.focus()

        return
      }

      if (pressed === "h" && !artifact() && mode() === "edit") {
        event.preventDefault()
        event.stopPropagation()
        editorState.search?.replace()

        return
      }

      if (pressed === "s" && !artifact()) {
        if (event.target instanceof Element && event.target.closest(".cm-editor") !== null) return

        event.preventDefault()
        event.stopPropagation()
        saveFile()
      }
    },
    { capture: true },
  )

  // A new path, e.g. after the workspace directory changes, drops the comment draft, editor draft, and selection of the old one.
  const moved = createMemo(on(path, () => ({}), { defer: true }))

  createKeyed(moved, () => {
    commentsUi.note.reset()
    setDraft(undefined)
    setEditorSelection(null)
    setSaveStatus("idle")
    setReveal({ line: undefined, token: 0 })
  })

  // A comment focused elsewhere, e.g. from its composer chip, opens here once this file shows.
  createKeyed(
    () => {
      const focus = comment.focus.current()
      const p = path()

      if (!focus || !p || focus.file !== p || !active()) return

      const target = fileComments().find((item) => item.id === focus.id)

      return target && { target }
    },
    (focus) => {
      setMode("review")
      commentsUi.note.openComment(focus.target.id, focus.target.selection, { cancelDraft: true })
      requestAnimationFrame(() => comment.focus.set(null))
    },
  )

  const previous = { loaded: false, ready: false, active: false }

  createKeyed(
    () => {
      const p = path()

      return p ? { session: props.session.key, path: p } : undefined
    },
    (target) =>
      onCleanup(
        shared.reveal.register(target.session, target.path, () => {
          setNote("selected", null)
          scrollSync.queueRestore()
          const targetLine = selectedLines()?.start

          if (targetLine !== undefined) setReveal({ line: targetLine, token: reveal.token + 1 })
        }),
      ),
    { equals: (previous, next) => previous?.session === next?.session && previous?.path === next?.path },
  )

  // Restores the stored scroll when the file loads, its view state loads, or the tab shows a loaded file again.
  createKeyed(
    () => ({ loaded: !!current()?.loaded, ready: file.ready(), shown: active() }),
    (next) => {
      const restore =
        (next.loaded && !previous.loaded) ||
        (next.ready && !previous.ready) ||
        (next.shown && next.loaded && !previous.active)

      previous.loaded = next.loaded
      previous.ready = next.ready
      previous.active = next.shown

      if (restore) scrollSync.queueRestore()
    },
    {
      // The file's content changing while it stays loaded is the same key.
      equals: (previous, next) =>
        previous.loaded === next.loaded && previous.ready === next.ready && previous.shown === next.shown,
    },
  )

  const renderFile = () => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: path() ?? "",
          contents: contents(),
          cacheKey: cacheKey(),
        }}
        enableLineSelection
        enableGutterUtility
        selectedLines={activeSelection()}
        commentedLines={commentedLines()}
        onRendered={() => {
          scrollSync.queueRestore()
        }}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderGutterUtility={commentsUi.renderGutterUtility}
        onLineSelected={(range: LineRange | null) => {
          commentsUi.onLineSelected(range)
        }}
        onLineSelectionEnd={(range: LineRange | null) => {
          if (!range) {
            commentsUi.note.select(null)
            commentsUi.note.cancelDraft()

            return
          }

          commentsUi.onLineSelectionEnd(range)
        }}
        onLineNumberSelectionEnd={(range: LineRange | null) => {
          commentsUi.onLineNumberSelectionEnd(range)
        }}
        search={search}
        class="select-text"
        // Media and previews have their own viewers below; the code view only ever shows text.
        media={{ mode: "off" }}
      />
    </div>
  )

  // The code view scrolls in its own container so line state and scroll position persist per tab.
  // It reads the text itself: `Show` tracks its fallback, so passing the content in would rebuild the view, scrolled to
  // the top, each time a reread stores a new content object.
  const codeView = () => (
    <div
      data-scrollable
      class="min-h-0 flex-1 overflow-y-auto"
      ref={scrollSync.setViewport}
      onScroll={scrollSync.handleScroll}
    >
      {renderFile()}
    </div>
  )

  const editorToolbar = () => {
    const selectionTag = () => {
      const range = chatSelection()

      return range ? formatLineRangeTag(range) : undefined
    }

    return (
      <div
        data-slot="code-editor-toolbar"
        class="flex h-[34px] shrink-0 items-center justify-between gap-2 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 select-none"
      >
        <div class="flex min-w-0 items-center gap-2">
          <div class="flex min-w-0 items-center font-mono text-[11.5px] leading-none" title={path() ?? ""}>
            <Show when={displayPath().dir}>
              <span class="truncate text-v2-text-text-faint">{displayPath().dir}</span>
            </Show>
            <span class="shrink-0 font-medium text-v2-text-text-base">{displayPath().name}</span>
          </div>
          <span class="shrink-0 rounded bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-[10.5px] font-medium leading-none text-v2-text-text-muted">
            {language()}
          </span>
          <Show when={dirty()}>
            <span
              data-slot="code-editor-dirty-badge"
              class="inline-flex shrink-0 items-center gap-1 rounded-full border border-v2-state-border-warning bg-v2-state-bg-warning px-2 py-0.5 text-[10.5px] font-medium leading-none text-v2-state-fg-warning"
            >
              <span class="size-1.5 rounded-full bg-v2-state-fg-warning" aria-hidden="true" />
              <span>{ctx.t("editor.modified")}</span>
            </span>
          </Show>
          <Show when={!dirty() && saveStatus() === "saved"}>
            <span
              data-slot="code-editor-saved-badge"
              class="inline-flex shrink-0 items-center gap-1 rounded-full border border-v2-state-border-success bg-v2-state-bg-success px-2 py-0.5 text-[10.5px] font-medium leading-none text-v2-state-fg-success"
            >
              <SavedCheckIcon />
              <span>{ctx.t("editor.saved")}</span>
            </span>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <div
            role="tablist"
            aria-label={ctx.t("editor.modeLabel")}
            class="inline-flex h-[24px] items-center rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode() === "edit"}
              data-slot="code-editor-mode-edit"
              onClick={() => setMode("edit")}
              class="inline-flex h-[18px] cursor-pointer items-center gap-1 rounded-[4px] px-2 text-[11px] font-medium leading-none transition-colors"
              classList={{
                "bg-v2-background-bg-layer-02 text-v2-text-text-base": mode() === "edit",
                "text-v2-text-text-muted hover:text-v2-text-text-base": mode() !== "edit",
              }}
            >
              <EditModeIcon />
              <span>{ctx.t("editor.edit")}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode() === "review"}
              data-slot="code-editor-mode-review"
              onClick={() => setMode("review")}
              class="inline-flex h-[18px] cursor-pointer items-center gap-1 rounded-[4px] px-2 text-[11px] font-medium leading-none transition-colors"
              classList={{
                "bg-v2-background-bg-layer-02 text-v2-text-text-base": mode() === "review",
                "text-v2-text-text-muted hover:text-v2-text-text-base": mode() !== "review",
              }}
            >
              <ReviewModeIcon />
              <span>{ctx.t("editor.review")}</span>
            </button>
          </div>
          <span class="h-3.5 w-px bg-v2-border-border-muted" aria-hidden="true" />
          <Show when={dirty()}>
            <button
              type="button"
              data-slot="code-editor-discard"
              title={ctx.t("editor.discardTitle")}
              disabled={saving()}
              onClick={discardDraft}
              class="inline-flex h-[24px] cursor-pointer items-center gap-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-button-neutral px-2 text-[11px] font-medium leading-none text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:cursor-default disabled:opacity-50"
            >
              <DiscardChangesIcon />
              <span>{ctx.t("editor.discard")}</span>
            </button>
          </Show>
          <button
            type="button"
            data-slot="code-editor-save"
            title={ctx.t("editor.saveTitle")}
            disabled={!dirty() || saving()}
            onClick={() => saveFile()}
            class="inline-flex h-[24px] items-center gap-1 rounded-md px-2 text-[11px] font-medium leading-none transition-colors"
            classList={{
              "cursor-pointer bg-v2-background-bg-accent text-v2-text-text-contrast hover:opacity-90":
                dirty() && !saving(),
              "cursor-default border border-v2-border-border-muted bg-transparent text-v2-text-text-faint opacity-60":
                !dirty() || saving(),
            }}
          >
            <SaveFileIcon />
            <span>{saving() ? ctx.t("editor.saving") : ctx.t("editor.save")}</span>
          </button>
          <button
            type="button"
            data-slot="code-editor-send-chat"
            title={
              selectionTag()
                ? ctx.t("editor.sendRangeTitle", { range: selectionTag()! })
                : ctx.t("editor.sendFileTitle")
            }
            onClick={sendToChat}
            class="inline-flex h-[24px] cursor-pointer items-center gap-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-button-neutral px-2 text-[11px] font-medium leading-none text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover"
          >
            <SendToChatIcon />
            <span>{ctx.t("editor.sendToChat")}</span>
            <Show when={selectionTag()}>
              {(tag) => (
                <span class="rounded bg-v2-background-bg-layer-02 px-1 py-0.5 font-mono text-[10px] leading-none text-v2-text-text-muted">
                  {tag()}
                </span>
              )}
            </Show>
          </button>
        </div>
      </div>
    )
  }

  const textEditorView = () => (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      {editorToolbar()}
      <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          class="flex h-full min-h-0 flex-1 flex-col"
          classList={{ hidden: mode() !== "edit" }}
          aria-hidden={mode() !== "edit" || undefined}
        >
          <Suspense fallback={<div class="px-6 py-4 text-12-regular text-v2-text-text-muted">{ctx.t("common.loading")}…</div>}>
            <CodeEditor
              filename={path() ?? ""}
              content={editorContent()}
              dirty={dirty()}
              visible={mode() === "edit"}
              revealLine={revealLine()}
              revealToken={reveal.token}
              onChange={handleEditorChange}
              onSave={saveFile}
              onSelectionChange={setEditorSelection}
              onSearchRef={(handle) => {
                editorState.search = handle
              }}
            />
          </Suspense>
        </div>
        <Show when={mode() === "review"}>
          <div class="flex min-h-0 flex-1 flex-col pt-2">{codeView()}</div>
        </Show>
      </div>
    </div>
  )

  return (
    <div class="relative h-full min-h-0 flex flex-col">
      <Switch>
        <Match when={current()?.loaded ? current()?.content : undefined}>
          {(value) => (
            <Show when={artifact()} fallback={textEditorView()}>
              <ArtifactView
                session={props.session}
                screen={props.screen}
                path={path() ?? ""}
                content={value()}
                cacheKey={cacheKey()}
                source={codeView()}
              />
            </Show>
          )}
        </Match>
        <Match when={current()?.loading}>
          <div class="px-6 py-4 text-text-weak">{ctx.t("common.loading")}…</div>
        </Match>
        <Match when={current()?.notFound ? current()?.name : undefined}>
          {(name) => <div class="px-6 py-4 text-text-weak">{ctx.t("tab.notFound", { name: name() })}</div>}
        </Match>
        <Match when={current()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
      </Switch>
    </div>
  )
}
