import { useEffect, useRef } from 'react'
import { EditorState, EditorSelection, Compartment, Prec } from '@codemirror/state'
import {
  EditorView,
  keymap,
  highlightActiveLine,
  drawSelection,
  placeholder as cmPlaceholder,
} from '@codemirror/view'
import type { Command } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentMore, indentLess } from '@codemirror/commands'
import { autocompletion } from '@codemirror/autocomplete'
import {
  markdown,
  markdownLanguage,
  insertNewlineContinueMarkupCommand,
} from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxTree, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { useTheme } from '../theme/theme'
import { liveMarkdown } from './markdown-live'
import { emojiCompletion, mentionCompletion } from './editor-complete'
import { slashInsertCompletion } from './editor-slash'
import { NO_SETEXT_HEADINGS } from './markdown-flavour'

/**
 * The Markdown editor: one mode, not two.
 *
 * There is no Write/Preview switch, because there is nothing to switch — the
 * text is drawn as it will be read while it is being typed. Typing `# ` sizes
 * the line as a heading, `- ` turns into a bullet, `**bold**` goes bold. The
 * markup is only visible on the line the cursor is on, so it can still be
 * edited. `src/ui/markdown-live.ts` does the drawing; this file assembles the
 * editor and its keys.
 *
 * The colour mode is swapped through a `Compartment` rather than by rebuilding
 * the editor — otherwise cursor and undo history would be lost on every switch.
 * docs/12-theming.md, docs/13-editing.md
 */
const themeCompartment = new Compartment()

/**
 * The reading scale, as CSS. These numbers mirror `PAGE` in
 * `src/ui/Markdown.tsx`: if the two drift apart, writing and reading stop
 * looking alike, which is the one thing this editor is for.
 */
function editorTheme(dark: boolean) {
  return EditorView.theme(
    {
      '&': {
        color: 'var(--fg)',
        backgroundColor: 'transparent',
        fontSize: '17px',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-content': {
        fontFamily: 'var(--font-sans)',
        padding: '0',
        caretColor: 'var(--fg)',
        // The same measure as the rendered page — a line of text stays
        // readable, however wide the window is.
        maxWidth: '70ch',
        // A floor, not the height: the room under the text comes from the host
        // growing inside the frame's flex column, so that whatever follows the
        // editor sits at the bottom of the page. See the host div below.
        minHeight: '6rem',
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
      // highlightActiveLine() ships its own default background; override it
      // rather than just omitting a rule, or that default shows through.
      '.cm-activeLine': { backgroundColor: 'transparent' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--accent-bg)',
      },
      // The editor grows with the text instead of scrolling inside a box: a
      // page is a document, and a document does not have a 60vh window in it.
      '.cm-scroller': { overflow: 'visible', lineHeight: '1.75' },
      '.cm-placeholder': { color: 'var(--fg-subtle)' },

      // — headings —
      '.cm-md-h1': {
        fontSize: '26px',
        fontWeight: '600',
        letterSpacing: '-0.02em',
        lineHeight: '1.3',
        paddingTop: '1.4rem',
      },
      '.cm-md-h2': {
        fontSize: '21px',
        fontWeight: '600',
        letterSpacing: '-0.015em',
        lineHeight: '1.35',
        paddingTop: '1.2rem',
      },
      '.cm-md-h3': { fontSize: '18px', fontWeight: '600', lineHeight: '1.4', paddingTop: '1rem' },
      '.cm-md-h4': { fontSize: '17px', fontWeight: '600', lineHeight: '1.45', paddingTop: '0.8rem' },
      '.cm-md-h5, .cm-md-h6': {
        fontSize: '14px',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--fg-muted)',
        paddingTop: '0.7rem',
      },

      // — inline —
      '.cm-md-strong': { fontWeight: '600' },
      '.cm-md-em': { fontStyle: 'italic' },
      '.cm-md-strike': { textDecoration: 'line-through', color: 'var(--fg-subtle)' },
      '.cm-md-link': { color: 'var(--accent-fg)', textDecoration: 'underline', textUnderlineOffset: '2px' },
      '.cm-md-inline-code': {
        fontFamily: 'var(--font-mono)',
        fontSize: '14px',
        backgroundColor: 'var(--code-bg)',
        borderRadius: '3px',
        padding: '0.1em 0.3em',
      },
      // The markup itself, on the line being edited. Recessed, not hidden: it
      // has to be visible enough to delete and quiet enough to read past.
      '.cm-md-marker': { color: 'var(--fg-subtle)', fontWeight: '400' },

      // — blocks —
      // The two indents that can meet on one line — a quote's and a list's —
      // are added rather than overriding one another: both rules declare the
      // same `padding-left`, and each contributes only its own variable, so a
      // list inside a quote is indented by both.
      '.cm-md-quote': {
        '--md-quote': '1rem',
        paddingLeft: 'calc(var(--md-quote, 0rem) + var(--md-step, 0rem))',
        borderLeft: '3px solid var(--line-strong)',
        color: 'var(--fg-muted)',
      },
      '.cm-md-code-block': {
        fontFamily: 'var(--font-mono)',
        fontSize: '14px',
        lineHeight: '1.6',
        backgroundColor: 'var(--code-bg)',
        borderLeft: '1px solid var(--code-line)',
        borderRight: '1px solid var(--code-line)',
        padding: '0 1rem',
      },
      '.cm-md-code-first': {
        borderTop: '1px solid var(--code-line)',
        borderRadius: '8px 8px 0 0',
        paddingTop: '0.6rem',
        marginTop: '0.6rem',
      },
      '.cm-md-code-last': {
        borderBottom: '1px solid var(--code-line)',
        borderRadius: '0 0 8px 8px',
        paddingBottom: '0.6rem',
        marginBottom: '0.6rem',
      },
      '.cm-md-code-info': { color: 'var(--fg-subtle)', fontSize: '12px' },

      // — lists —
      // Hanging indent: the marker sits in the gutter the padding opens up, so
      // a wrapped line lines up under the text and not under the bullet. One
      // step is 1.5rem — the `pl-6` a list gets in `src/ui/Markdown.tsx`, so a
      // list is indented the same amount here as it is on the page. The source
      // spaces that nest an item are hidden for the same reason; two spaces
      // per level would be a step of its own. src/ui/markdown-live.ts
      // The gap between items is padding, not a margin: inside a quote a
      // margin would break the border running down the side into pieces.
      '.cm-md-item': {
        textIndent: '-1.5rem',
        paddingTop: '0.375rem',
        paddingLeft: 'calc(var(--md-quote, 0rem) + var(--md-step, 0rem))',
      },
      '.cm-md-depth-1': { '--md-step': '1.5rem' },
      '.cm-md-depth-2': { '--md-step': '3rem' },
      '.cm-md-depth-3': { '--md-step': '4.5rem' },
      '.cm-md-depth-4': { '--md-step': '6rem' },
      '.cm-md-depth-5': { '--md-step': '7.5rem' },
      '.cm-md-depth-6': { '--md-step': '9rem' },
      // Marker and the space behind it are one replacement exactly one step
      // wide, so the text starts on the step and not a few pixels beside it.
      // `textIndent` is inherited, and an inline-block is a block container:
      // without resetting it the marker would take the line's hanging indent a
      // second time and end up outside the text column.
      '.cm-md-bullet': {
        display: 'inline-block',
        boxSizing: 'border-box',
        width: '1.5rem',
        paddingLeft: '0.5rem',
        textIndent: '0',
        color: 'var(--fg-subtle)',
      },
      // `minWidth`, not `width`: at "10." the number is wider than the gutter
      // and then pushes the text along instead of being cut off.
      '.cm-md-number': {
        display: 'inline-block',
        boxSizing: 'border-box',
        minWidth: '1.5rem',
        paddingRight: '0.5rem',
        textAlign: 'right',
        textIndent: '0',
        color: 'var(--fg-subtle)',
      },
      '.cm-md-task': {
        marginRight: '0.4em',
        width: '0.9em',
        height: '0.9em',
        accentColor: 'var(--accent)',
        verticalAlign: 'baseline',
        cursor: 'pointer',
      },

      // — divider —
      '.cm-md-rule': {
        display: 'inline-block',
        width: '100%',
        verticalAlign: 'middle',
        borderTop: '1px solid var(--line)',
      },
      '.cm-md-hr-raw': { color: 'var(--fg-subtle)' },

      // — tables and images —
      // The same drawing as the page: one rule under each row, a header band,
      // `px-3 py-2` cells at 14px, a bordered card around the table, and a
      // picture with the same border and radius. Read against `PAGE` and the
      // `table`/`th`/`td`/`img` components in `src/ui/Markdown.tsx` — when one
      // of the two changes, the other has to follow.
      '.cm-md-table': {
        position: 'relative',
        margin: '1.5rem 0',
        border: '1px solid var(--line)',
        borderRadius: '8px',
        // Not clipped: a row's handle sits on the left edge and a column's on
        // the top edge, both just outside the border. The rounded corners come
        // from the four corner cells instead, which is also what makes the
        // header band follow them.
        overflow: 'visible',
        width: '100%',
        boxSizing: 'border-box',
        // The line this widget sits in is `pre-wrap`; a grid inside it would
        // inherit that and break on every newline of its own DOM.
        whiteSpace: 'normal',
      },
      '.cm-md-table-row': { display: 'grid', position: 'relative' },
      '.cm-md-table-cell': {
        position: 'relative',
        padding: '0.5rem 0.75rem',
        fontSize: '14px',
        lineHeight: '1.5',
        // A rule under every row and between every column: the grid reads as a
        // grid, which is what makes an empty cell a place rather than a gap.
        // The last column has none, so the card's own border is not doubled.
        borderBottom: '1px solid var(--line)',
        borderRight: '1px solid var(--line)',
        color: 'var(--fg-muted)',
        overflowWrap: 'anywhere',
      },
      '.cm-md-table-cell-last': { borderRight: 'none' },
      '.cm-md-table-head .cm-md-table-cell': {
        backgroundColor: 'var(--surface-1)',
        color: 'var(--fg)',
        fontWeight: '600',
        textAlign: 'left',
      },
      '.cm-md-table-row:last-child .cm-md-table-cell': { borderBottom: 'none' },
      '.cm-md-table-head .cm-md-table-cell-first': { borderTopLeftRadius: '8px' },
      '.cm-md-table-head .cm-md-table-cell-last': { borderTopRightRadius: '8px' },
      '.cm-md-table-row:last-child .cm-md-table-cell-first': { borderBottomLeftRadius: '8px' },
      '.cm-md-table-row:last-child .cm-md-table-cell-last': { borderBottomRightRadius: '8px' },
      // A cell with nothing in it has no line box, so it would come out a whole
      // line shorter than the row above it — and it would only grow once
      // somebody typed into it. One line's height is the floor, not the
      // ceiling: the cell still grows with whatever is written in it.
      '.cm-md-table-text': { minHeight: '1.5em' },
      // A cell's editing surface: exactly over its text, transparent so the text
      // shows through, and focusable — which a hidden element would not be, and
      // Tab has to reach it. Only the caret makes it visible; `focus-within`
      // swaps the two, so there is no class to toggle from JS.
      '.cm-md-table-input': {
        position: 'absolute',
        inset: '0',
        width: '100%',
        boxSizing: 'border-box',
        padding: '0.5rem 0.75rem',
        border: 'none',
        background: 'transparent',
        font: 'inherit',
        fontSize: '14px',
        lineHeight: '1.5',
        color: 'inherit',
        textAlign: 'inherit',
        opacity: '0',
        outline: 'none',
      },
      '.cm-md-table-cell:focus-within .cm-md-table-text': { visibility: 'hidden' },
      '.cm-md-table-cell:focus-within .cm-md-table-input': {
        opacity: '1',
        boxShadow: 'inset 0 0 0 2px var(--accent)',
      },

      // — the row and column handles —
      // One click into a cell and two icons appear: one on the table's left
      // edge level with that row, one on its top edge above that column. They
      // sit in the margin the table already has, so nothing shifts, and a click
      // opens the menu a right-click opens — narrowed to that row or column.
      '.cm-md-table-handle': {
        display: 'none',
        position: 'absolute',
        zIndex: '40',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        padding: '0',
        border: '1px solid var(--line-strong)',
        borderRadius: '5px',
        backgroundColor: 'var(--surface-2)',
        color: 'var(--fg-subtle)',
        cursor: 'pointer',
      },
      '.cm-md-table-handle-visible': { display: 'flex' },
      '.cm-md-table-handle:hover': {
        backgroundColor: 'var(--surface-selected)',
        color: 'var(--fg)',
      },
      '.cm-md-table-handle-row': { left: '-9px', top: '50%', transform: 'translateY(-50%)' },
      '.cm-md-table-handle-column': {
        top: '-9px',
        left: '50%',
        transform: 'translateX(-50%)',
      },
      '.cm-md-table-handle svg': { width: '12px', height: '12px' },

      // — the table's right-click menu —
      '.cm-md-table-menu': {
        position: 'absolute',
        zIndex: '50',
        minWidth: '11rem',
        padding: '0.25rem',
        border: '1px solid var(--line-strong)',
        borderRadius: '8px',
        backgroundColor: 'var(--surface-2)',
        boxShadow: '0 8px 24px rgb(0 0 0 / 0.12)',
      },
      '.cm-md-table-menu-item': {
        display: 'block',
        width: '100%',
        padding: '0.35rem 0.6rem',
        border: 'none',
        borderRadius: '5px',
        background: 'none',
        fontFamily: 'var(--font-sans)',
        fontSize: '13px',
        textAlign: 'left',
        color: 'var(--fg)',
        cursor: 'pointer',
      },
      '.cm-md-table-menu-item:hover:not(:disabled)': { backgroundColor: 'var(--surface-selected)' },
      '.cm-md-table-menu-item:disabled': { color: 'var(--fg-subtle)', cursor: 'default' },
      '.cm-md-table-menu-current': { fontWeight: '600' },

      // — images —
      // `inline-block`, not `block`: the wrapper is what a click selects and
      // what the resize handle is pinned to, so it has to be the size of the
      // picture and not of the measure.
      '.cm-md-image': {
        position: 'relative',
        display: 'inline-block',
        maxWidth: '100%',
        margin: '1.5rem 0',
        whiteSpace: 'normal',
      },
      '.cm-md-image img': {
        display: 'block',
        maxWidth: '100%',
        borderRadius: '8px',
        border: '1px solid var(--line)',
      },
      '.cm-md-image-selected': {
        outline: '2px solid var(--accent)',
        outlineOffset: '2px',
        borderRadius: '8px',
      },
      '.cm-md-image-handle': {
        display: 'none',
        position: 'absolute',
        right: '-7px',
        bottom: '-7px',
        width: '14px',
        height: '14px',
        borderRadius: '50%',
        backgroundColor: 'var(--accent)',
        border: '2px solid var(--surface-2)',
        cursor: 'nwse-resize',
      },
      '.cm-md-image-selected .cm-md-image-handle': { display: 'block' },
      // — mentions —
      // A chip, not a link: it names a person, and clicking it in the editor
      // should place the cursor rather than navigate.
      '.cm-md-mention': {
        backgroundColor: 'var(--accent-bg)',
        color: 'var(--accent-fg)',
        borderRadius: '4px',
        padding: '0.05em 0.3em',
        whiteSpace: 'nowrap',
        fontSize: '0.95em',
      },

      // — the @, : and / dropdowns —
      // CodeMirror's default popup is styled for a code editor and stays light
      // in dark mode. It gets the app's tokens instead. docs/12-theming.md
      '.cm-tooltip.cm-tooltip-autocomplete': {
        border: '1px solid var(--line-strong)',
        borderRadius: '8px',
        backgroundColor: 'var(--surface-2)',
        boxShadow: '0 8px 24px rgb(0 0 0 / 0.12)',
        overflow: 'hidden',
        fontFamily: 'var(--font-sans)',
        fontSize: '14px',
      },
      '.cm-tooltip-autocomplete > ul': { maxHeight: '17em' },
      '.cm-tooltip-autocomplete > ul > li': {
        padding: '0.35em 0.6em',
        color: 'var(--fg)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5em',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--surface-selected)',
        color: 'var(--fg)',
      },
      '.cm-completionLabel': { flex: '1 1 auto' },
      '.cm-completionDetail': {
        fontStyle: 'normal',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        color: 'var(--fg-subtle)',
      },
    },
    { dark },
  )
}

/**
 * Colour inside fenced code blocks only. Prose is formatted by
 * `liveMarkdown`, so the structural Markdown tags are deliberately absent
 * here — a blue heading on top of a heading-sized line is two answers to the
 * same question.
 */
const codeHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--accent-fg)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--success)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--warning)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--fg-subtle)', fontStyle: 'italic' },
  { tag: [tags.typeName, tags.className, tags.tagName], color: 'var(--accent)' },
  { tag: [tags.function(tags.variableName), tags.propertyName], color: 'var(--fg)' },
  { tag: [tags.variableName, tags.attributeName], color: 'var(--fg-muted)' },
])

/**
 * Wrap or unwrap the selection — Cmd-B, Cmd-I and friends. Pressing the key
 * again on already wrapped text removes the markers instead of nesting a
 * second pair, which is what every other editor does.
 */
function toggleWrap(marker: string): Command {
  return (view) => {
    view.dispatch(
      view.state.changeByRange((range) => {
        const width = marker.length
        const before = view.state.sliceDoc(range.from - width, range.from)
        const after = view.state.sliceDoc(range.to, range.to + width)
        if (before === marker && after === marker) {
          return {
            changes: [
              { from: range.from - width, to: range.from },
              { from: range.to, to: range.to + width },
            ],
            range: EditorSelection.range(range.from - width, range.to - width),
          }
        }
        return {
          changes: [
            { from: range.from, insert: marker },
            { from: range.to, insert: marker },
          ],
          // With nothing selected the cursor lands between the markers, ready
          // to type the emphasised word.
          range: range.empty
            ? EditorSelection.cursor(range.from + width)
            : EditorSelection.range(range.from + width, range.to + width),
        }
      }),
    )
    return true
  }
}

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false })

/**
 * Enter: the next line, with the same marker — and on an empty item, the end of
 * the list. One press either way, and never a blank line nobody asked for.
 *
 * `@codemirror/lang-markdown` binds Enter to `insertNewlineContinueMarkup`
 * already, but it looks after CommonMark's distinction between a *tight* list
 * and a *loose* one — a list with a blank line in it — and that costs a press
 * in both directions:
 *
 * 1. **Ending it.** On the empty item of a list that has only one entry so far,
 *    the default does not remove the marker: it inserts a blank line and writes
 *    the marker again, keeping the option of a loose list open. The marker goes
 *    only on the press after that — and only in the one-entry case, so the key
 *    behaves differently depending on how much has been typed already, which is
 *    not something anybody can learn. `nonTightLists: false` says: end it.
 * 2. **Continuing it.** Once a list *is* loose, every Enter puts a blank line in
 *    front of the new item to keep it that way, so the cursor lands two lines
 *    down with an empty line above it. That is not configurable, so the blank
 *    line is taken out again below.
 *
 * Both come down to one rule: **an empty line is something the writer types,
 * never something a key leaves behind.** Enter lands on the next line. Whether
 * the list ends up tight or loose is then what the text says, not what the
 * editor guessed — and (1) is what made lists loose by accident in the first
 * place, so the two fixes are the same fix.
 */
export const continueList: Command = (view) => {
  const before = view.state.doc.lineAt(view.state.selection.main.head).number
  if (!continueMarkup(view)) return false

  const landed = view.state.doc.lineAt(view.state.selection.main.head).number
  if (landed !== before + 2) return true

  // Two lines down: the line skipped over is the one the command inserted to
  // keep the list loose. Only if it really is empty — in a quoted list it
  // carries the `>` that holds the quote together, and that has to stay.
  const skipped = view.state.doc.line(landed - 1)
  if (/\S/.test(skipped.text)) return true
  view.dispatch({ changes: { from: skipped.from, to: skipped.to + 1 } })
  return true
}

/**
 * `[` , the box, `]` , and the space that has to follow — with the two places
 * where an invisible character silently turns the task back into a bullet.
 */
const TASK_MARKER = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([^\]])(\])(.?)/

/**
 * Puts a plain space back into a task marker that lost one.
 *
 * `- [ ] milk` is a checkbox; `- [<no-break space>] milk` is a bullet followed
 * by two brackets, because GFM asks for U+0020 and nothing else. On a Mac
 * Option-Space produces exactly that character, and pasted text is full of
 * them — so the line refuses to become a task and **nothing on screen says
 * why**, because the character is invisible. `- [x]` keeps working the whole
 * time, which makes it look as though ticked boxes were the only kind there is.
 *
 * There is no reading of `- [<nbsp>]` in which the writer meant something other
 * than a checkbox, so the character is replaced as it is typed. Only whitespace
 * is touched: `- [y]` is left alone, because that really is just brackets.
 */
export const normaliseTaskMarker = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr

  const fixes: { from: number; to: number; insert: string }[] = []
  const seen = new Set<number>()
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const doc = tr.newDoc
    for (let n = doc.lineAt(fromB).number, last = doc.lineAt(toB).number; n <= last; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = doc.line(n)
      const match = TASK_MARKER.exec(line.text)
      if (!match) continue
      const [, before, box, bracket, after] = match
      // the box itself
      if (box !== ' ' && box !== 'x' && box !== 'X' && /\s/.test(box)) {
        fixes.push({ from: line.from + before.length, to: line.from + before.length + box.length, insert: ' ' })
      }
      // and the space that has to separate it from the words
      if (after && after !== ' ' && after !== '\t' && /\s/.test(after)) {
        const at = line.from + before.length + box.length + bracket.length
        fixes.push({ from: at, to: at + after.length, insert: ' ' })
      }
    }
  })

  if (fixes.length === 0) return tr
  // `sequential`, because the positions were read off the document this
  // transaction produces, not the one it started from.
  return [tr, { changes: fixes, sequential: true }]
})

function inList(view: EditorView): boolean {
  const node = syntaxTree(view.state).resolveInner(view.state.selection.main.head, -1)
  for (let parent: typeof node | null = node; parent; parent = parent.parent) {
    if (parent.name === 'ListItem') return true
  }
  return false
}

/**
 * Tab indents — but only inside a list. Everywhere else it has to keep moving
 * focus out of the editor, otherwise the page cannot be operated by keyboard
 * at all.
 */
const indentInList: Command = (view) => (inList(view) ? indentMore(view) : false)
const outdentInList: Command = (view) => (inList(view) ? indentLess(view) : false)

export type EditorHandle = {
  /** insert text at the cursor position */
  insert: (text: string) => void
}

type Props = {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  /** people the `@` dropdown offers — the members of the space */
  members?: string[]
  placeholder?: string
  /** filled with a small API so attachments land at the cursor */
  handleRef?: { current: EditorHandle | null }
  /** files dropped onto the editor */
  onDropFiles?: (files: File[]) => void
  /** the `/` menu's attachment entry — opens the file picker */
  onAttach?: () => void
}

export function MarkdownEditor({
  value,
  onChange,
  ariaLabel,
  members,
  placeholder = 'Start writing. “# ” makes a heading, “- ” a list, “@” mentions somebody, “/” inserts a table or a file.',
  handleRef,
  onDropFiles,
  onAttach,
}: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onDropRef = useRef(onDropFiles)
  onDropRef.current = onDropFiles
  // The completion source is captured when the editor is built, once. Reading
  // the callback through a ref keeps a later session (an account switch, a
  // different Blossom server) from being frozen into the first render.
  const onAttachRef = useRef(onAttach)
  onAttachRef.current = onAttach
  // Read through a ref, so members arriving from the relay after mount are
  // offered without rebuilding the editor.
  const membersRef = useRef(members ?? [])
  membersRef.current = members ?? []
  const { resolved } = useTheme()

  useEffect(() => {
    if (!host.current) return

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        // Above the default keymap, so Mod-i is emphasis and not whatever the
        // default binds it to.
        Prec.high(
          keymap.of([
            { key: 'Mod-b', run: toggleWrap('**') },
            { key: 'Mod-i', run: toggleWrap('*') },
            { key: 'Mod-Shift-x', run: toggleWrap('~~') },
            { key: 'Mod-e', run: toggleWrap('`') },
            // Above the language's own Enter — see continueList.
            { key: 'Enter', run: continueList },
            { key: 'Tab', run: indentInList },
            { key: 'Shift-Tab', run: outdentInList },
          ]),
        ),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // markdownLanguage, not the commonmark default: task lists, tables and
        // ~~strikethrough~~ are GFM, and the Enter key only continues a task
        // list if the parser knows what one is.
        markdown({
          base: markdownLanguage,
          codeLanguages: languages,
          // A wiki page is Markdown, not HTML — completing `<div` would be an
          // invitation to write something the renderer strips again.
          completeHTMLTags: false,
          // The page's parser is told the same. src/ui/markdown-flavour.ts
          extensions: NO_SETEXT_HEADINGS,
        }),
        syntaxHighlighting(codeHighlight),
        normaliseTaskMarker,
        liveMarkdown,
        autocompletion({
          override: [
            mentionCompletion(() => membersRef.current),
            emojiCompletion,
            slashInsertCompletion(() => onAttachRef.current?.()),
          ],
          icons: false,
          activateOnTyping: true,
        }),
        cmPlaceholder(placeholder),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
        themeCompartment.of(editorTheme(false)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        }),
        EditorView.domEventHandlers({
          drop: (event) => {
            const files = [...(event.dataTransfer?.files ?? [])]
            if (files.length === 0 || !onDropRef.current) return false
            event.preventDefault()
            onDropRef.current(files)
            return true
          },
        }),
      ],
    })

    const instance = new EditorView({ state, parent: host.current })
    view.current = instance

    if (handleRef) {
      handleRef.current = {
        insert: (text: string) => {
          const range = instance.state.selection.main
          instance.dispatch({
            changes: { from: range.from, to: range.to, insert: text },
            selection: { anchor: range.from + text.length },
          })
          instance.focus()
        },
      }
    }

    return () => {
      instance.destroy()
      view.current = null
      if (handleRef) handleRef.current = null
    }
    // Deliberately built once: the content is synchronised below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ariaLabel])

  // Switch the colour mode without rebuilding the editor
  useEffect(() => {
    view.current?.dispatch({
      effects: themeCompartment.reconfigure(editorTheme(resolved === 'dark')),
    })
  }, [resolved])

  // Adopt changes from outside (e.g. the result of a merge) without resetting
  // the cursor on every keystroke of our own
  useEffect(() => {
    const instance = view.current
    if (!instance) return
    const current = instance.state.doc.toString()
    if (current === value) return
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    })
  }, [value])

  return (
    <div
      ref={host}
      // Takes the space left over in the frame's flex column, so the row after
      // the editor ends up flush with the bottom of a short page — the same
      // place the comment composer sits when reading. `flex-1` keeps
      // `min-height: auto`, so a document longer than the space still grows
      // the column instead of being clipped.
      // src/ui/layout/PageFrame.tsx, the `stretch` prop
      className="flex-1"
      onMouseDown={(event) => {
        // A click in the empty space below the last line puts the cursor at
        // the end, the way clicking under the last paragraph of a document
        // does. Without this the grown-out area is dead to the touch.
        if (event.target !== event.currentTarget) return
        const instance = view.current
        if (!instance) return
        event.preventDefault()
        instance.dispatch({ selection: { anchor: instance.state.doc.length } })
        instance.focus()
      }}
    />
  )
}

/**
 * The editor is built once, in a `useEffect` that does not depend on this
 * module, and it keeps the extensions it was built with. A hot update here
 * therefore replaces the module while the running editor goes on using the old
 * decorations — the change looks like it simply did not work, and no amount of
 * editing makes it land. So a change here asks for a reload instead of
 * pretending it arrived. Dev only: `import.meta.hot` is undefined in a build.
 * src/ui/MarkdownEditor.tsx, the `[ariaLabel]` effect
 */
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot?.invalidate())
}
