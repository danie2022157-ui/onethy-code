import { onCleanup, onMount } from "solid-js"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { python } from "@codemirror/lang-python"
import { rust } from "@codemirror/lang-rust"
import { sql } from "@codemirror/lang-sql"
import { xml } from "@codemirror/lang-xml"
import { yaml } from "@codemirror/lang-yaml"
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language"
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search"
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state"
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view"
import { tags } from "@lezer/highlight"
import { createKeyed } from "@opencode/plugin/gui"

export interface CodeEditorSelection {
  readonly start: number
  readonly end: number
}

export interface CodeEditorSearchHandle {
  readonly focus: () => void
  readonly replace: () => void
}

export interface CodeEditorProps {
  readonly filename: string
  readonly content: string
  readonly dirty?: boolean
  readonly readOnly?: boolean
  readonly visible?: boolean
  readonly revealLine?: number
  readonly revealToken?: number
  readonly onChange?: (value: string) => void
  readonly onSave?: (value: string) => void
  readonly onSelectionChange?: (selection: CodeEditorSelection | null) => void
  readonly onSearchRef?: (handle: CodeEditorSearchHandle | null) => void
}

const externalSync = Annotation.define<boolean>()

const editorHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: "var(--syntax-comment)",
    fontStyle: "italic",
  },
  {
    tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.definitionKeyword],
    color: "var(--syntax-keyword)",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.character],
    color: "var(--syntax-string)",
  },
  {
    tag: tags.regexp,
    color: "var(--syntax-regexp)",
  },
  {
    tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom],
    color: "var(--syntax-primitive)",
  },
  {
    tag: [tags.constant(tags.variableName), tags.standard(tags.variableName)],
    color: "var(--syntax-constant)",
  },
  {
    tag: [tags.variableName, tags.local(tags.variableName)],
    color: "var(--syntax-variable)",
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--syntax-info)",
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    color: "var(--syntax-property)",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.tagName],
    color: "var(--syntax-type)",
  },
  {
    tag: [
      tags.operator,
      tags.compareOperator,
      tags.arithmeticOperator,
      tags.logicOperator,
      tags.bitwiseOperator,
      tags.updateOperator,
    ],
    color: "var(--syntax-operator)",
  },
  {
    tag: [
      tags.punctuation,
      tags.separator,
      tags.bracket,
      tags.brace,
      tags.paren,
      tags.squareBracket,
      tags.angleBracket,
    ],
    color: "var(--syntax-punctuation)",
  },
  {
    tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    color: "var(--markdown-heading, var(--syntax-type))",
    fontWeight: "600",
  },
  {
    tag: tags.emphasis,
    color: "var(--markdown-emph, var(--syntax-warning))",
    fontStyle: "italic",
  },
  {
    tag: tags.strong,
    color: "var(--markdown-strong, var(--syntax-constant))",
    fontWeight: "600",
  },
  {
    tag: [tags.link, tags.url],
    color: "var(--markdown-link, var(--v2-text-text-accent))",
    textDecoration: "underline",
  },
  {
    tag: tags.monospace,
    color: "var(--markdown-code, var(--syntax-string))",
  },
  {
    tag: tags.invalid,
    color: "var(--syntax-critical)",
  },
  {
    tag: tags.inserted,
    color: "var(--syntax-diff-add)",
  },
  {
    tag: tags.deleted,
    color: "var(--syntax-diff-delete)",
  },
  {
    tag: [tags.meta, tags.processingInstruction, tags.annotation],
    color: "var(--syntax-constant)",
  },
])

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--v2-background-bg-base)",
    color: "var(--v2-text-text-base)",
    fontFamily: "var(--v2-font-family-code, var(--font-family-mono))",
    fontSize: "13px",
    lineHeight: "1.6",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--v2-font-family-code, var(--font-family-mono))",
    lineHeight: "1.6",
    paddingBottom: "80px",
  },
  ".cm-content": {
    caretColor: "var(--v2-text-text-accent)",
    padding: "8px 0",
  },
  ".cm-line": {
    padding: "0 16px 0 12px",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--v2-text-text-accent)",
    borderLeftWidth: "2px",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "color-mix(in srgb, var(--v2-background-bg-accent) 22%, transparent)",
    },
  ".cm-activeLine": {
    backgroundColor: "var(--v2-overlay-simple-overlay-hover)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--v2-background-bg-base)",
    color: "var(--v2-text-text-faint)",
    borderRight: "1px solid var(--v2-border-border-muted)",
    minWidth: "48px",
    userSelect: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 12px 0 8px",
    minWidth: "36px",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--v2-overlay-simple-overlay-hover)",
    color: "var(--v2-text-text-base)",
  },
  ".cm-foldGutter .cm-gutterElement": {
    padding: "0 4px 0 2px",
    color: "var(--v2-text-text-faint)",
    cursor: "pointer",
  },
  ".cm-foldGutter .cm-gutterElement:hover": {
    color: "var(--v2-text-text-base)",
  },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--v2-background-bg-accent) 20%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--v2-border-border-focus) 50%, transparent)",
    borderRadius: "2px",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in srgb, var(--v2-background-bg-accent) 14%, transparent)",
    borderRadius: "2px",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--v2-state-fg-warning) 24%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--v2-state-fg-warning) 45%, transparent)",
    borderRadius: "2px",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, var(--v2-background-bg-accent) 32%, transparent)",
    outline: "1px solid var(--v2-border-border-focus)",
  },
  ".cm-panels": {
    backgroundColor: "var(--v2-background-bg-layer-01)",
    color: "var(--v2-text-text-base)",
    borderColor: "var(--v2-border-border-base)",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--v2-border-border-base)",
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid var(--v2-border-border-base)",
  },
  ".cm-panel.cm-search": {
    padding: "6px 12px",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    fontSize: "12px",
    fontFamily: "var(--v2-font-family-sans, var(--font-family-sans))",
  },
  ".cm-panel.cm-search input.cm-textfield": {
    backgroundColor: "var(--v2-background-bg-base)",
    color: "var(--v2-text-text-base)",
    border: "1px solid var(--v2-border-border-base)",
    borderRadius: "5px",
    padding: "3px 8px",
    fontSize: "12px",
    outline: "none",
    lineHeight: "1.4",
  },
  ".cm-panel.cm-search input.cm-textfield:focus": {
    borderColor: "var(--v2-border-border-focus)",
  },
  ".cm-panel.cm-search button.cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--v2-background-bg-button-neutral)",
    color: "var(--v2-text-text-base)",
    border: "1px solid var(--v2-border-border-base)",
    borderRadius: "5px",
    padding: "3px 8px",
    fontSize: "11px",
    fontWeight: "500",
    cursor: "pointer",
    textTransform: "capitalize",
  },
  ".cm-panel.cm-search button.cm-button:hover": {
    backgroundColor: "var(--v2-overlay-simple-overlay-hover)",
    borderColor: "var(--v2-border-border-strong)",
  },
  ".cm-panel.cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    color: "var(--v2-text-text-muted)",
    fontSize: "11px",
    cursor: "pointer",
  },
  ".cm-panel.cm-search button[name='close']": {
    color: "var(--v2-text-text-muted)",
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: "16px",
    lineHeight: "1",
    padding: "2px 6px",
    borderRadius: "4px",
  },
  ".cm-panel.cm-search button[name='close']:hover": {
    color: "var(--v2-text-text-base)",
    backgroundColor: "var(--v2-overlay-simple-overlay-hover)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--v2-background-bg-layer-01)",
    border: "1px solid var(--v2-border-border-base)",
    borderRadius: "6px",
    boxShadow: "var(--v2-elevation-floating)",
    color: "var(--v2-text-text-base)",
  },
})

function languageForFilename(filename: string): Extension {
  const dot = filename.lastIndexOf(".")

  if (dot < 0) return []

  const ext = filename.slice(dot).toLowerCase()

  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return javascript({ typescript: true })

  if (ext === ".tsx") return javascript({ typescript: true, jsx: true })

  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return javascript()

  if (ext === ".jsx") return javascript({ jsx: true })

  if (ext === ".json" || ext === ".jsonc") return json()

  if (ext === ".css") return css()

  if (ext === ".html" || ext === ".htm") return html()

  if (ext === ".md" || ext === ".markdown" || ext === ".mdx") return markdown()

  if (ext === ".py" || ext === ".pyw") return python()

  if (ext === ".rs") return rust()

  if (ext === ".sql") return sql()

  if (ext === ".xml" || ext === ".svg") return xml()

  if (ext === ".yml" || ext === ".yaml") return yaml()

  return []
}

function focusReplaceField(view: EditorView) {
  requestAnimationFrame(() => {
    const field = view.dom.querySelector("input[name='replace']")

    if (field instanceof HTMLInputElement && field.isConnected) {
      field.focus()
      field.select()
    }
  })
}

function selectionLinesFromState(state: EditorState): CodeEditorSelection | null {
  const main = state.selection.main

  if (main.empty) return null

  const start = state.doc.lineAt(main.from).number
  const endLine = state.doc.lineAt(main.to)
  const end = main.to > main.from && main.to === endLine.from ? state.doc.lineAt(main.to - 1).number : endLine.number

  return { start, end }
}

function selectionsEqual(previous: CodeEditorSelection | null, next: CodeEditorSelection | null) {
  if (previous === next) return true

  if (!previous || !next) return false

  return previous.start === next.start && previous.end === next.end
}

function revealLineInView(view: EditorView, lineNumber: number | undefined) {
  if (lineNumber === undefined || lineNumber < 1) return

  const clamped = Math.min(Math.max(1, Math.floor(lineNumber)), view.state.doc.lines)
  const line = view.state.doc.line(clamped)

  view.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: "center" }),
  })
}

type EditorRuntime = {
  container?: HTMLDivElement
  view?: EditorView
  lastSelection: CodeEditorSelection | null
  revealFrame?: number
}

export default function CodeEditor(props: CodeEditorProps) {
  const languageCompartment = new Compartment()
  const readOnlyCompartment = new Compartment()
  const runtime: EditorRuntime = { lastSelection: null }

  onMount(() => {
    const container = runtime.container

    if (!container) return

    const openReplace = (view: EditorView) => {
      openSearchPanel(view)
      focusReplaceField(view)

      return true
    }

    const state = EditorState.create({
      doc: props.content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        syntaxHighlighting(editorHighlightStyle, { fallback: true }),
        editorTheme,
        languageCompartment.of(languageForFilename(props.filename)),
        readOnlyCompartment.of([
          EditorState.readOnly.of(Boolean(props.readOnly)),
          EditorView.editable.of(!props.readOnly),
        ]),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: (view) => {
              props.onSave?.(view.state.doc.toString())

              return true
            },
          },
          {
            key: "Mod-h",
            preventDefault: true,
            run: openReplace,
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const syncedExternally = update.transactions.some((tr) => tr.annotation(externalSync))

            if (!syncedExternally) props.onChange?.(update.state.doc.toString())
          }

          if (update.selectionSet || update.docChanged) {
            const nextSelection = selectionLinesFromState(update.state)

            if (!selectionsEqual(runtime.lastSelection, nextSelection)) {
              runtime.lastSelection = nextSelection
              props.onSelectionChange?.(nextSelection)
            }
          }
        }),
      ],
    })

    const view = new EditorView({ state, parent: container })

    runtime.view = view

    props.onSearchRef?.({
      focus: () => {
        openSearchPanel(view)
        view.focus()
      },
      replace: () => {
        openReplace(view)
      },
    })

    if (props.revealLine !== undefined) {
      const targetLine = props.revealLine

      runtime.revealFrame = requestAnimationFrame(() => {
        runtime.revealFrame = undefined

        if (runtime.view === view) revealLineInView(view, targetLine)
      })
    }

    onCleanup(() => {
      if (runtime.revealFrame !== undefined) cancelAnimationFrame(runtime.revealFrame)
      props.onSearchRef?.(null)
      view.destroy()
      runtime.view = undefined
    })
  })

  createKeyed(
    () => props.filename,
    (filename) => {
      const view = runtime.view

      if (!view) return

      view.dispatch({
        effects: languageCompartment.reconfigure(languageForFilename(filename)),
      })
    },
  )

  createKeyed(
    () => ({ readOnly: Boolean(props.readOnly) }),
    (next) => {
      const view = runtime.view

      if (!view) return

      view.dispatch({
        effects: readOnlyCompartment.reconfigure([
          EditorState.readOnly.of(next.readOnly),
          EditorView.editable.of(!next.readOnly),
        ]),
      })
    },
    {
      equals: (previous, next) => previous.readOnly === next.readOnly,
    },
  )

  createKeyed(
    () => ({ content: props.content, dirty: Boolean(props.dirty) }),
    (next) => {
      const view = runtime.view

      if (!view || next.dirty) return

      const currentDoc = view.state.doc.toString()

      if (currentDoc === next.content) return

      const anchor = Math.min(view.state.selection.main.anchor, next.content.length)
      const head = Math.min(view.state.selection.main.head, next.content.length)

      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: next.content },
        selection: { anchor, head },
        annotations: externalSync.of(true),
      })
    },
    {
      equals: (previous, next) => previous.content === next.content && previous.dirty === next.dirty,
    },
  )

  createKeyed(
    () => (props.revealLine !== undefined ? { line: props.revealLine, token: props.revealToken ?? 0 } : undefined),
    (target) => {
      const view = runtime.view

      if (!view) return

      revealLineInView(view, target.line)
    },
    {
      equals: (previous, next) => previous.line === next.line && previous.token === next.token,
    },
  )

  createKeyed(
    () => Boolean(props.visible),
    () => {
      const view = runtime.view

      if (!view) return

      view.requestMeasure()
    },
  )

  return (
    <div
      data-slot="code-editor"
      class="h-full min-h-0 w-full flex-1 overflow-hidden bg-v2-background-bg-base"
      ref={(el) => {
        runtime.container = el
      }}
    />
  )
}
