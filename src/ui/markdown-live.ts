import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import type { EditorState, Extension, Range, Text } from '@codemirror/state'
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common'
import { findMentions } from '../nostr/mentions'
import { observeProfile } from '../nostr/profile-store'
import { shortNpub, toNpub } from '../nostr/profile'

/**
 * Live formatting for the Markdown editor: what you type is drawn the way it
 * will be read.
 *
 * The document stays plain Markdown — that is not negotiable, because a
 * revision, a diff, blame and the three-way merge all work on the text itself
 * (`src/domain/`). So this is not a rich-text editor with a Markdown
 * serialiser; it is the source, decorated. Typing `# ` turns the line into a
 * heading on the spot, and the `#` is only shown while the cursor is on that
 * line.
 *
 * **Reveal is per line, not per node.** The line you are editing shows its
 * markup, every other line shows the result. That is one rule a reader can
 * hold in their head, instead of "the markers of the construct my cursor
 * happens to be inside".
 *
 * **One construct is the exception: a table.** A pipe table is drawn as the
 * table it is — header, rows, column alignment — and shows its source as a
 * whole as soon as the cursor is anywhere inside it. Columns only line up if
 * every row is laid out against all the others, so half a table over half its
 * source would be neither; the unit of reveal for it is the construct, not the
 * line. An image is a single inline construct and follows the line rule like
 * everything else: drawn off the active line, as written on it. Both mirror
 * what the rendered page does, down to loading an image from wherever it points
 * (src/ui/Markdown.tsx, docs/09-security-privacy.md).
 *
 * The sizes below mirror the `PAGE` scale in `src/ui/Markdown.tsx` — when one
 * of the two changes, the other has to follow, or write and read mode drift
 * apart, which is the whole point of this file.
 * docs/13-editing.md
 */

/**
 * No mention chip is drawn inside these. Code, because a mention in a code
 * sample is a quoted key and not a person. `URL`, because a link target is
 * already being hidden as markup — two replacements over the same stretch of
 * text is one too many, and `[Alice](nostr:npub1…)` reads perfectly well as
 * the link it is.
 */
const NO_MENTION = new Set([
  'InlineCode',
  'CodeText',
  'FencedCode',
  'CodeBlock',
  'HTMLBlock',
  'URL',
])

const HEADING_CLASS: Record<string, string> = {
  ATXHeading1: 'cm-md-h1',
  ATXHeading2: 'cm-md-h2',
  ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4',
  ATXHeading5: 'cm-md-h5',
  ATXHeading6: 'cm-md-h6',
}

const hidden = Decoration.replace({})

const line = (cls: string) => Decoration.line({ class: cls })
const mark = (cls: string) => Decoration.mark({ class: cls })

const EM = mark('cm-md-em')
const STRONG = mark('cm-md-strong')
const STRIKE = mark('cm-md-strike')
const INLINE_CODE = mark('cm-md-inline-code')
const LINK_TEXT = mark('cm-md-link')
const CODE_INFO = mark('cm-md-code-info')
const LIST_NUMBER = mark('cm-md-number')

class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super()
  }
  eq(other: BulletWidget) {
    return other.depth === this.depth
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-md-bullet'
    // Nested levels get a different shape rather than the same dot indented,
    // so depth is visible without counting pixels.
    span.textContent = this.depth >= 3 ? '▪' : this.depth === 2 ? '◦' : '•'
    return span
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-md-rule'
    return span
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.className = 'cm-md-task'
    box.setAttribute('aria-label', this.checked ? 'done' : 'open')
    // The position is read from the DOM at click time, not captured here: the
    // widget outlives edits above it, and a remembered offset would tick the
    // wrong box.
    box.addEventListener('mousedown', (event) => {
      event.preventDefault()
      const pos = view.posAtDOM(box)
      const text = view.state.doc.sliceString(pos, pos + 3)
      if (!/^\[[ xX]\]$/.test(text)) return
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: text[1] === ' ' ? 'x' : ' ' },
      })
    })
    return box
  }
}

/** Unsubscribe handles per chip — see releaseMention. */
const mentionCleanup = new WeakMap<HTMLElement, () => void>()

/**
 * The chip for a mention, with the profile subscription that fills in the name.
 *
 * Not a method of the widget: a table cell draws the same chip from inside its
 * own widget (see TableWidget), so the DOM is built in exactly one place.
 */
function mentionChip(pubkey: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'cm-md-mention'
  const npub = toNpub(pubkey)
  // The npub is what is stored and what identifies the person, so it stays
  // reachable — in the tooltip here, next to the name in the page.
  span.title = npub
  span.textContent = `@${shortNpub(npub)}`
  mentionCleanup.set(
    span,
    observeProfile(pubkey, (profile) => {
      const name = profile?.displayName ?? profile?.name
      span.textContent = `@${name ?? shortNpub(npub)}`
    }),
  )
  return span
}

/** Drop a chip's subscription. The widget's DOM is discarded, never reused. */
function releaseMention(dom: HTMLElement) {
  mentionCleanup.get(dom)?.()
  mentionCleanup.delete(dom)
}

class MentionWidget extends WidgetType {
  constructor(readonly pubkey: string) {
    super()
  }
  eq(other: MentionWidget) {
    return other.pubkey === this.pubkey
  }
  toDOM() {
    return mentionChip(this.pubkey)
  }
  destroy(dom: HTMLElement) {
    releaseMention(dom)
  }
}

/**
 * An image, drawn where it is written.
 *
 * `![alt](url)` is a single inline construct, so it follows the line rule like
 * everything else: the line the cursor is on shows the Markdown, every other
 * line shows the picture. Clicking the picture puts the cursor on its line,
 * which is how it is edited — no second affordance is needed for that.
 *
 * The source is loaded directly, ours or anybody's, exactly as on the rendered
 * page: a picture that only appears after a click is not a picture of anything.
 * docs/09-security-privacy.md
 */
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    /** where the construct starts — what a click on the picture lands on */
    readonly from: number,
  ) {
    super()
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt && other.from === this.from
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('span')
    wrapper.className = 'cm-md-image'
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.loading = 'lazy'
    // The editor ignores events inside a widget, so a replaced range takes no
    // clicks at all: the picture places the cursor itself, and the line turns
    // back into the Markdown it is written as.
    img.addEventListener('mousedown', (event) => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true })
      view.focus()
    })
    wrapper.appendChild(img)
    return wrapper
  }
}

/**
 * The lines the selection touches. Those show their markup; everything else is
 * formatted. An unfocused editor reveals nothing — otherwise a page that has
 * only just been opened shows a stray `#` on its first line.
 */
function revealedLines(state: EditorState, hasFocus: boolean): { from: number; to: number }[] {
  if (!hasFocus) return []
  return state.selection.ranges.map((range) => {
    const first = state.doc.lineAt(range.from)
    const last = range.to <= first.to ? first : state.doc.lineAt(range.to)
    return { from: first.from, to: last.to }
  })
}

/**
 * Whether a `Link`/`Image` node is really one.
 *
 * Any pair of brackets parses as a `Link` — `[X]`, `[ ]`, `[see]` — because it
 * *might* be a reference to a definition further down. Almost always there is
 * no such definition, and then the page prints the brackets as the text they
 * are. So a bracket pair only counts as a link once it carries a target, and
 * only then are the brackets hidden as markup.
 *
 * This is what made a checkbox impossible to type: `[` and `]` disappeared the
 * moment they were closed, and `- [ ] milk` was drawn as a bullet followed by
 * nothing at all until the parser had a whole task to look at.
 */
function hasTarget(node: SyntaxNode | null | undefined): boolean {
  for (let child = node?.firstChild; child; child = child.nextSibling) {
    if (child.name === 'URL') return true
  }
  return false
}

/** The target of a `[text](url)` link or an `![alt](url)` image. */
function childUrl(node: SyntaxNode, doc: Text): string | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'URL') return doc.sliceString(child.from, child.to)
  }
  return null
}

/**
 * The alt text of an image — what is written between the brackets.
 *
 * It is not drawn in the picture's place (that is what used to make an image
 * look like a paragraph that had lost it); it travels into the `alt` attribute,
 * where it is what a screen reader and a broken load fall back to.
 */
function imageAlt(node: SyntaxNode, doc: Text): string {
  let alt = ''
  let pos = node.from
  for (let child = node.firstChild; child; child = child.nextSibling) {
    // The alt text is not a node of its own — it is what lies *between* the
    // markup nodes, so the gaps are the text and the markers are skipped.
    if (child.from > pos) alt += doc.sliceString(pos, child.from)
    if (child.name !== 'LinkMark' && child.name !== 'URL') {
      alt += doc.sliceString(child.from, child.to)
    }
    pos = child.to
  }
  return alt
}

function hasAncestor(node: SyntaxNode, name: string): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === name) return true
  }
  return false
}

/** How deeply a list item is nested, counted in enclosing lists. */
function listDepth(node: SyntaxNode): number {
  let depth = 0
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'BulletList' || parent.name === 'OrderedList') depth += 1
  }
  return depth
}

function build(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
  const state = view.state
  const decos: Range<Decoration>[] = []
  const atoms: Range<Decoration>[] = []
  const regions = revealedLines(state, view.hasFocus)
  /** true while the cursor is on this stretch — then it stays raw text */
  const raw = (from: number, to: number) =>
    regions.some((region) => from <= region.to && to >= region.from)

  const eachLine = (from: number, to: number, apply: (pos: number, index: number, last: number) => void) => {
    let pos = from
    let index = 0
    const total = state.doc.lineAt(to).number - state.doc.lineAt(from).number
    while (pos <= to) {
      const current = state.doc.lineAt(pos)
      apply(current.from, index, total)
      if (current.to >= to) break
      pos = current.to + 1
      index += 1
    }
  }

  /** the position after the spaces that separate a marker from its text */
  const afterSpaces = (to: number) => {
    let end = to
    while (end < state.doc.length && state.doc.sliceString(end, end + 1) === ' ') end += 1
    return end
  }

  /** hide a marker together with the spaces that separate it from the text */
  const hideWithSpaces = (from: number, to: number) => {
    decos.push(hidden.range(from, afterSpaces(to)))
  }

  const tree = syntaxTree(state)

  for (const { from: viewFrom, to: viewTo } of view.visibleRanges) {
    tree.iterate({
      from: viewFrom,
      to: viewTo,
      enter: (node: SyntaxNodeRef) => {
        const name = node.name

        const headingClass = HEADING_CLASS[name]
        if (headingClass) {
          eachLine(node.from, node.to, (pos) => decos.push(line(headingClass).range(pos)))
          return
        }

        switch (name) {
          case 'HeaderMark': {
            // Only `#` reaches this: the underline of a Setext heading would be
            // one too, but that construct is off. src/ui/markdown-flavour.ts
            if (raw(node.from, node.to)) {
              decos.push(mark('cm-md-marker').range(node.from, node.to))
            } else {
              hideWithSpaces(node.from, node.to)
            }
            return
          }

          case 'Blockquote': {
            eachLine(node.from, node.to, (pos) => decos.push(line('cm-md-quote').range(pos)))
            return
          }

          case 'QuoteMark': {
            if (raw(node.from, node.to)) {
              decos.push(mark('cm-md-marker').range(node.from, node.to))
            } else {
              hideWithSpaces(node.from, node.to)
            }
            return
          }

          case 'FencedCode':
          case 'CodeBlock': {
            eachLine(node.from, node.to, (pos, index, last) => {
              decos.push(line('cm-md-code-block').range(pos))
              if (index === 0) decos.push(line('cm-md-code-first').range(pos))
              if (index === last) decos.push(line('cm-md-code-last').range(pos))
            })
            return
          }

          case 'CodeMark': {
            // The fence of a code block and the backticks of inline code are
            // the same node; both are markup and go away off the active line.
            if (!raw(node.from, node.to)) decos.push(hidden.range(node.from, node.to))
            return
          }

          case 'CodeInfo': {
            decos.push(CODE_INFO.range(node.from, node.to))
            return
          }

          case 'InlineCode': {
            decos.push(INLINE_CODE.range(node.from, node.to))
            return
          }

          case 'Emphasis': {
            decos.push(EM.range(node.from, node.to))
            return
          }

          case 'StrongEmphasis': {
            decos.push(STRONG.range(node.from, node.to))
            return
          }

          case 'Strikethrough': {
            decos.push(STRIKE.range(node.from, node.to))
            return
          }

          case 'EmphasisMark':
          case 'StrikethroughMark': {
            if (!raw(node.from, node.to)) decos.push(hidden.range(node.from, node.to))
            return
          }

          case 'ListItem': {
            // Only the line the item starts on. The lines below it belong
            // either to a nested item — which decorates itself — or to the
            // item's own continuation, which is left alone.
            const indent = `cm-md-item cm-md-depth-${Math.min(listDepth(node.node), 6)}`
            decos.push(line(indent).range(state.doc.lineAt(node.from).from))
            return
          }

          case 'ListMark': {
            const ordered = node.node.parent?.parent?.name === 'OrderedList'
            // A task item already has a marker — its checkbox — and `- ` and
            // `[ ]` are one thing, so the `- ` goes even on the active line.
            // See the TaskMarker case for why the box does not fall back.
            if (node.node.nextSibling?.name === 'Task') {
              decos.push(hidden.range(node.from, afterSpaces(node.to)))
              return
            }
            if (raw(node.from, node.to)) {
              decos.push(mark('cm-md-marker').range(node.from, node.to))
              return
            }
            // The spaces that nest the item are markup as well: the depth is
            // drawn by the line's padding, so leaving them would indent twice
            // — and by two spaces where the page indents by a full step. Only
            // whitespace: in a quoted list the `>` comes first on the line and
            // is the QuoteMark's to hide, not ours.
            const start = state.doc.lineAt(node.from).from
            if (start < node.from && /^[ \t]+$/.test(state.doc.sliceString(start, node.from))) {
              decos.push(hidden.range(start, node.from))
            }

            const end = afterSpaces(node.to)
            if (ordered) {
              // A number carries information — it is never replaced, only
              // toned down. Hiding the space behind it lets the CSS give it
              // the width of the gutter, the way `list-decimal` does.
              decos.push(LIST_NUMBER.range(node.from, node.to))
              if (end > node.to) decos.push(hidden.range(node.to, end))
              return
            }
            decos.push(
              Decoration.replace({ widget: new BulletWidget(listDepth(node.node)) }).range(
                node.from,
                end,
              ),
            )
            return
          }

          case 'TaskMarker': {
            // Like a mention chip, and unlike every other marker, this does not
            // fall back to raw text on the active line. `[ ]` is not something
            // anybody edits by hand — a box is ticked by clicking it — and a
            // checklist is written *on* the line it is being added to, so a box
            // that only appears once the cursor has left reads as "it did not
            // work". It is atomic instead: one Backspace takes the whole
            // marker, and the item falls back to an ordinary bullet.
            const checked = state.doc.sliceString(node.from, node.to).toLowerCase() === '[x]'
            const deco = Decoration.replace({ widget: new TaskWidget(checked) })
            decos.push(deco.range(node.from, node.to))
            atoms.push(deco.range(node.from, node.to))
            return
          }

          case 'HorizontalRule': {
            if (raw(node.from, node.to)) {
              decos.push(line('cm-md-hr-raw').range(state.doc.lineAt(node.from).from))
              return
            }
            decos.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to))
            return
          }

          case 'Image': {
            // Drawn off the active line, as written on it — the two
            // `hasAncestor(node, 'Image')` guards on LinkMark and URL below are
            // what leaves the Markdown alone while it is being edited.
            if (raw(node.from, node.to)) return
            const src = childUrl(node.node, state.doc)
            if (!src) return
            decos.push(
              Decoration.replace({
                widget: new ImageWidget(src, imageAlt(node.node, state.doc), node.from),
              }).range(node.from, node.to),
            )
            return
          }

          case 'Link': {
            if (hasTarget(node.node)) decos.push(LINK_TEXT.range(node.from, node.to))
            return
          }

          case 'LinkMark': {
            // An image is left as written: drawn as its alt text alone it
            // would look like a paragraph that lost its picture.
            if (hasAncestor(node.node, 'Image')) return
            // Brackets around nothing are not markup, they are two characters
            // the page prints. See hasTarget.
            if (!hasTarget(node.node.parent)) return
            if (!raw(node.from, node.to)) decos.push(hidden.range(node.from, node.to))
            return
          }

          case 'URL': {
            if (hasAncestor(node.node, 'Image')) return
            const parent = node.node.parent
            // Only the target of a `[text](url)` link is hidden. A bare or
            // <angled> URL *is* the text — hiding it would delete the link.
            const labelled =
              parent?.name === 'Link' && state.doc.sliceString(parent.from, parent.from + 1) === '['
            if (labelled && !raw(node.from, node.to)) decos.push(hidden.range(node.from, node.to))
            return
          }

          default:
            return
        }
      },
    })

    // Mentions are not a Markdown construct, so the syntax tree knows nothing
    // about them — they are found in the text and only skipped inside code.
    const text = state.doc.sliceString(viewFrom, viewTo)
    for (const span of findMentions(text)) {
      const from = viewFrom + span.from
      const to = viewFrom + span.to
      const node = tree.resolveInner(from, 1)
      if (
        NO_MENTION.has(node.name) ||
        hasAncestor(node, 'FencedCode') ||
        hasAncestor(node, 'CodeBlock')
      ) {
        continue
      }
      // Unlike every other marker a chip does not fall back to raw text on the
      // active line: a 63-character npub in the middle of a sentence is not
      // something anyone edits by hand. It is atomic instead, so one Backspace
      // removes the whole mention.
      const deco = Decoration.replace({ widget: new MentionWidget(span.pubkey) })
      decos.push(deco.range(from, to))
      atoms.push(deco.range(from, to))
    }
  }

  return { decorations: Decoration.set(decos, true), atomic: Decoration.set(atoms, true) }
}

// — tables —
//
// A pipe table is the one construct that cannot be drawn line by line: columns
// only line up if every row is laid out against all the others, and a row drawn
// over its neighbour's source is neither. So a table is drawn as a whole — one
// replaced range, from the header line to the last row — and shows its source
// as a whole the moment the cursor is anywhere inside it.
//
// That range spans line breaks, and a ViewPlugin is not allowed to replace line
// breaks ("Decorations that replace line breaks may not be specified via
// plugins"), so the tables live in a StateField of their own — the same shape
// CodeMirror's own folding uses. A state field cannot see whether the editor is
// focused, which is a view property, so that fact reaches it as an effect:
// `EditorView.focusChangeEffect` is dispatched by the editor on every focus
// change, and the field reads it in its update.

/** One run of text in a cell, or a mention chip in it. */
type Piece = { kind: 'text'; text: string; cls: string } | { kind: 'mention'; pubkey: string }

/** One cell: where it starts in the document, and what is drawn in it. */
type Cell = { from: number; pieces: Piece[] }

type TableData = {
  head: Cell[]
  rows: Cell[][]
  /** the alignment each column asks for with `:---`, `:---:` or `---:` */
  align: (string | null)[]
}

/**
 * The inline classes a cell carries — the same ones the editor puts on a
 * paragraph, because a cell is read the same way. A link shows its label; its
 * target is markup, exactly as in the LinkMark case below.
 */
const CELL_CLASS: Record<string, string> = {
  Emphasis: 'cm-md-em',
  StrongEmphasis: 'cm-md-strong',
  Strikethrough: 'cm-md-strike',
  InlineCode: 'cm-md-inline-code',
  Link: 'cm-md-link',
}

/** Markup and link targets: not text, so a cell never shows them. */
const CELL_MARKUP = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'URL'])

/** The pieces of one cell, read off the syntax tree. */
function cellPieces(cell: SyntaxNode, doc: Text): Piece[] {
  const pieces: Piece[] = []

  const emit = (text: string, cls: string) => {
    if (!text) return
    // A mention is not Markdown, so the syntax tree knows nothing about it and
    // the text is scanned exactly as it is everywhere else. Not inside code.
    const spans = cls.includes('inline-code') ? [] : findMentions(text)
    let pos = 0
    for (const span of spans) {
      if (span.from > pos) pieces.push({ kind: 'text', text: text.slice(pos, span.from), cls })
      pieces.push({ kind: 'mention', pubkey: span.pubkey })
      pos = span.to
    }
    if (pos < text.length) pieces.push({ kind: 'text', text: text.slice(pos), cls })
  }

  const walk = (node: SyntaxNode, cls: string) => {
    let pos = node.from
    for (let child = node.firstChild; child; child = child.nextSibling) {
      // Text is not a node: it is whatever lies between two markup nodes, so
      // the gap is read before the child is looked at.
      if (child.from > pos) emit(doc.sliceString(pos, child.from), cls)
      if (CELL_MARKUP.has(child.name)) {
        pos = child.to
        continue
      }
      const inner = CELL_CLASS[child.name]
      walk(child, inner ? [cls, inner].filter(Boolean).join(' ') : cls)
      pos = child.to
    }
    if (pos < node.to) emit(doc.sliceString(pos, node.to), cls)
  }

  walk(cell, '')
  return pieces
}

function rowCells(row: SyntaxNode, doc: Text): Cell[] {
  const cells: Cell[] = []
  for (let child = row.firstChild; child; child = child.nextSibling) {
    // The cell's own position is kept with it: it is where a click into the
    // drawn table puts the cursor. See TableWidget.toDOM.
    if (child.name === 'TableCell') cells.push({ from: child.from, pieces: cellPieces(child, doc) })
  }
  return cells
}

/**
 * What the delimiter row says about alignment. It is the one line of a table
 * that carries information without being content, which is why it is read here
 * and never drawn.
 */
function delimiterAlign(delimiter: SyntaxNode, doc: Text): (string | null)[] {
  const parts = doc.sliceString(delimiter.from, delimiter.to).trim().split('|')
  if (parts[0]?.trim() === '') parts.shift()
  if (parts[parts.length - 1]?.trim() === '') parts.pop()
  return parts.map((raw) => {
    const cell = raw.trim()
    if (!/^:?-+:?$/.test(cell)) return null
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

function tableData(table: SyntaxNode, doc: Text): TableData | null {
  let head: Cell[] = []
  const rows: Cell[][] = []
  let align: (string | null)[] = []
  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableHeader') head = rowCells(child, doc)
    else if (child.name === 'TableDelimiter') align = delimiterAlign(child, doc)
    else if (child.name === 'TableRow') rows.push(rowCells(child, doc))
  }
  if (head.length === 0) return null
  return { head, rows, align }
}

/**
 * The table, drawn the way the page draws it: the same header band, the same
 * one rule under each row, the same `px-3 py-2` cells at 14px. Read against
 * `PAGE` and the `table`/`th`/`td` components in `src/ui/Markdown.tsx`.
 *
 * Every row is a grid with the same number of columns of the same width, which
 * is what puts the columns under one another. A real `table` element cannot be
 * used here: its layout does not survive being put inside a line of text.
 */
class TableWidget extends WidgetType {
  constructor(readonly table: TableData) {
    super()
  }
  eq(other: TableWidget) {
    return JSON.stringify(other.table) === JSON.stringify(this.table)
  }
  toDOM(view: EditorView) {
    const root = document.createElement('div')
    root.className = 'cm-md-table'
    // The editor ignores events inside a widget, so a replaced range takes no
    // clicks at all — without this, clicking the drawn table would do nothing.
    // Clicking a cell puts the cursor into that cell instead, and that is what
    // makes the table hand its source back. src/ui/markdown-live.ts, the
    // "reveals as a whole" note.
    root.addEventListener('mousedown', (event) => {
      const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-pos]')
      if (!cell?.dataset.pos) return
      event.preventDefault()
      view.dispatch({ selection: { anchor: Number(cell.dataset.pos) }, scrollIntoView: true })
      view.focus()
    })
    root.appendChild(tableRow(this.table.head, this.table.align, true))
    for (const cells of this.table.rows) {
      root.appendChild(tableRow(cells, this.table.align, false))
    }
    return root
  }
  destroy(dom: HTMLElement) {
    // Every chip in a cell carries a profile subscription of its own, and
    // CodeMirror only calls destroy for the widget's own DOM.
    for (const chip of dom.querySelectorAll<HTMLElement>('.cm-md-mention')) releaseMention(chip)
  }
}

function tableRow(cells: Cell[], align: (string | null)[], head: boolean): HTMLElement {
  const row = document.createElement('div')
  row.className = head ? 'cm-md-table-row cm-md-table-head' : 'cm-md-table-row'
  row.style.gridTemplateColumns = `repeat(${Math.max(cells.length, 1)}, minmax(0, 1fr))`
  cells.forEach((source, index) => {
    const cell = document.createElement('div')
    cell.className = 'cm-md-table-cell'
    cell.dataset.pos = String(source.from)
    const alignment = align[index]
    if (alignment) cell.style.textAlign = alignment
    for (const piece of source.pieces) {
      if (piece.kind === 'mention') {
        cell.appendChild(mentionChip(piece.pubkey))
      } else if (piece.cls) {
        const span = document.createElement('span')
        span.className = piece.cls
        span.textContent = piece.text
        cell.appendChild(span)
      } else {
        cell.appendChild(document.createTextNode(piece.text))
      }
    }
    row.appendChild(cell)
  })
  return row
}

/**
 * The effect the extension makes out of a focus change — exported because that
 * is the mechanism, not an implementation detail: the editor dispatches it via
 * `EditorView.focusChangeEffect` on gaining and losing focus, and the table
 * field reads it, because a state field cannot see the view.
 */
export const editorFocus = StateEffect.define<boolean>()

function tableDecorations(state: EditorState, focused: boolean): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const regions = revealedLines(state, focused)
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return
      // The whole construct reveals at once — the grid only exists as a whole,
      // and half a table over half its source is neither. The source is back
      // the moment the cursor is anywhere in the table, and the table is drawn
      // whenever it is not: the line rule, one construct up, and the one place
      // this file has an exception to it.
      if (regions.some((region) => node.from <= region.to && node.to >= region.from)) return
      const table = tableData(node.node, state.doc)
      if (!table) return
      ranges.push(Decoration.replace({ widget: new TableWidget(table) }).range(node.from, node.to))
    },
  })
  return Decoration.set(ranges, true)
}

type TableState = { focused: boolean; decorations: DecorationSet }

const tableState = StateField.define<TableState>({
  create: (state) => ({ focused: false, decorations: tableDecorations(state, false) }),
  update: (value, transaction) => {
    let focused = value.focused
    for (const effect of transaction.effects) {
      if (effect.is(editorFocus)) focused = effect.value
    }
    if (
      !transaction.docChanged &&
      !transaction.selection &&
      focused === value.focused &&
      // The parser finishes lazily and announces the finished tree with an
      // empty transaction. This is not a shortcut: without it the field would
      // keep the tree from before the table was parsed and never draw it.
      syntaxTree(transaction.startState) === syntaxTree(transaction.state)
    ) {
      return value
    }
    return { focused, decorations: tableDecorations(transaction.state, focused) }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

class LivePreview {
  decorations: DecorationSet
  atomic: DecorationSet

  constructor(view: EditorView) {
    const built = build(view)
    this.decorations = built.decorations
    this.atomic = built.atomic
  }

  update(update: ViewUpdate) {
    // focusChanged matters because an unfocused editor reveals no markup at
    // all; a changed tree because the parser finishes lazily.
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.focusChanged ||
      syntaxTree(update.startState) !== syntaxTree(update.state)
    ) {
      const built = build(update.view)
      this.decorations = built.decorations
      this.atomic = built.atomic
    }
  }
}

/**
 * The editor's live formatting, as one extension: the line-by-line decorations,
 * the focus fact a state field cannot see, and the tables — which a plugin is
 * not allowed to draw.
 */
export const liveMarkdown: Extension = [
  EditorView.focusChangeEffect.of((_state, focusing) => editorFocus.of(focusing)),
  tableState,
  ViewPlugin.fromClass(LivePreview, {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  }),
]

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
