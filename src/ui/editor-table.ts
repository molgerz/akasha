import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { StateField } from '@codemirror/state'
import type { EditorState, Extension, Range, Text } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { findMentions } from '../nostr/mentions'
import { mentionChip, releaseMention } from './mention-chip'

/**
 * A table, drawn as the grid it is — and edited in that grid.
 *
 * A pipe table is the one piece of Markdown nobody can hold in their head: the
 * pipes only line up if every row is laid out against all the others, and the
 * `---` line is a second copy of the column count. So it never falls back to
 * its source: the grid *is* the editor. A cell is clicked and typed into, Tab
 * walks the cells and hangs one more row on the bottom when it leaves the last
 * one, and the click brings out the handles Confluence has: one on
 * the table's left edge level with the cell's row, one on its top edge above
 * the cell's column. Each opens the operations for its axis — in and out,
 * delete, alignment — and a right-click on a cell opens the whole set at once.
 * Under it all the document stays the plain Markdown table any other client
 * renders; this is a view of it.
 *
 * **Why a StateField and not the line plugin.** Replacing the table spans line
 * breaks, and a ViewPlugin may not do that ("Decorations that replace line
 * breaks may not be specified via plugins") — the same reason CodeMirror's own
 * folding is a state field. Nothing in here depends on the view any more: the
 * table is drawn wherever it is, cursor inside it or not.
 *
 * **How a cell is edited without touching the document model.** Every cell
 * holds its rendered text under a transparent `<input>` that covers it. Clicking
 * the cell focuses that input — an element with `opacity: 0` is still focusable,
 * which a `display: none` one is not — and CSS swaps the two while it has the
 * caret. The document changes once, when the caret leaves: one edit, one undo
 * step, no per-keystroke rewriting of the source. The editor ignores every
 * event inside a widget (`WidgetType.ignoreEvent` defaults to true, and
 * `eventBelongsToEditor` walks up to it), so none of these reach CodeMirror's
 * own input handling. docs/13-editing.md
 */

/** One run of text in a cell, or a mention chip in it. */
export type Piece = { kind: 'text'; text: string; cls: string } | { kind: 'mention'; pubkey: string }

/** One cell: where it stands in the document, and what is drawn in it. */
export type Cell = {
  from: number
  to: number
  /** the cell's Markdown, exactly as the document has it */
  source: string
  pieces: Piece[]
  /**
   * The space between the cell's pipes, for a cell the parser gave no node to
   * — an empty one. Its content range is empty and the whitespace around it
   * belongs to nobody, so writing into it replaces the whole slot and the line
   * comes out `| x |` rather than `|x  |`. See rowCells.
   */
  slot?: { from: number; to: number }
}

export type TableData = {
  from: number
  to: number
  /**
   * The table exactly as the document had it when this widget was built.
   *
   * Everything the widget does to the document — a row, a column, a cell — is
   * done at the ranges below, and a widget can outlive the document it was built
   * from: a menu is opened, the parser moves something, the grid is redrawn and
   * the open menu still holds the old ranges. Replacing those then takes text
   * with it that was never part of the table. Before anything is written, this
   * text has to still be there. src/ui/editor-table.ts
   */
  source: string
  /** the `---` line: it carries the alignment and is never drawn */
  delimiter: { from: number; to: number; source: string }
  head: Cell[]
  rows: Cell[][]
  /** the alignment each column asks for with `:---`, `:---:` or `---:` */
  align: (string | null)[]
}

/**
 * The inline classes a cell carries — the same ones the editor puts on a
 * paragraph, because a cell is read the same way. A link shows its label; its
 * target is markup, exactly as in the LinkMark case in markdown-live.ts.
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

/**
 * A cell's text for editing: those escapes hold the table together, they are
 * not something to read. `\|` is the pipe the writer meant.
 */
function unescapeCell(source: string): string {
  return source.replace(/\\([|\\])/g, '$1')
}

/** The same text back into a row — a pipe would end the cell, a break cannot be in one. */
function escapeCell(value: string): string {
  return value.replace(/[|\\]/g, '\\$&').replace(/[\r\n]+/g, ' ')
}

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

function cellOf(node: SyntaxNode, doc: Text): Cell {
  return {
    from: node.from,
    to: node.to,
    source: doc.sliceString(node.from, node.to),
    pieces: cellPieces(node, doc),
  }
}

/**
 * A row's cells, in column order — including the ones with nothing in them.
 *
 * Those are the reason this is not a plain walk over `TableCell` nodes: the
 * parser emits a cell only when there is something in it, so an empty one is
 * nothing but the two pipes around it. Skipping it would drop a column out of
 * that row — the header would have two and the row under it one — and the
 * skeleton `/table` writes (`|  |  |`) would come out with no editable cells
 * at all. So the cells are located by the pipes, and an empty slot between two
 * of them becomes a cell with an empty range at the slot's start.
 */
function rowCells(row: SyntaxNode, doc: Text): Cell[] {
  const children: SyntaxNode[] = []
  for (let child = row.firstChild; child; child = child.nextSibling) children.push(child)

  // The slots between the pipes; the first and the last only hold a cell when
  // the row has no leading or trailing pipe to open and close it.
  const pipes = children.filter((child) => child.name === 'TableDelimiter')
  const slots: [number, number][] = []
  let start = row.from
  for (const pipe of pipes) {
    slots.push([start, pipe.from])
    start = pipe.to
  }
  slots.push([start, row.to])

  const cells: Cell[] = []
  slots.forEach(([from, to], index) => {
    const cell = children.find(
      (child) => child.name === 'TableCell' && child.from >= from && child.to <= to,
    )
    if (cell) {
      cells.push(cellOf(cell, doc))
      return
    }
    // Only a slot *between* two pipes is a cell of its own; text outside them
    // belongs to no column.
    if (pipes.length === 0 || index === 0 || index >= slots.length - 1) return
    const raw = doc.sliceString(from, to)
    const text = raw.trim()
    const content = from + (raw.length - raw.trimStart().length)
    cells.push({
      from: content,
      to: text ? to - (raw.length - raw.trimEnd().length) : content,
      source: text,
      pieces: [],
      slot: { from, to },
    })
  })
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
  let delimiter = { from: table.from, to: table.from, source: '' }
  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableHeader') head = rowCells(child, doc)
    else if (child.name === 'TableDelimiter') {
      delimiter = { from: child.from, to: child.to, source: doc.sliceString(child.from, child.to) }
      align = delimiterAlign(child, doc)
    } else if (child.name === 'TableRow') rows.push(rowCells(child, doc))
  }
  if (head.length === 0) return null
  return {
    from: table.from,
    to: table.to,
    source: doc.sliceString(table.from, table.to),
    delimiter,
    head,
    rows,
    align,
  }
}

/** A table as plain text, one string per cell — what the writing operations work on. */
type TableText = { head: string[]; rows: string[][]; align: (string | null)[] }

/**
 * The table's cells as text, squared off to the header's column count. A row
 * that came in short (or long) is not thrown away — it is a table with the wrong
 * number of cells, and the only useful thing to do with it is to make it a table
 * again.
 */
function tableText(table: TableData): TableText {
  const head = table.head.map((cell) => cell.source)
  const columns = head.length
  const rows = table.rows.map((row) => {
    const cells = row.map((cell) => cell.source)
    while (cells.length < columns) cells.push('')
    cells.length = columns
    return cells
  })
  const align = table.align.slice()
  while (align.length < columns) align.push(null)
  align.length = columns
  return { head, rows, align }
}

function delimiterLine(align: (string | null)[]): string {
  const marks = align.map((value) =>
    value === 'center' ? ':---:' : value === 'right' ? '---:' : value === 'left' ? ':---' : '---',
  )
  return '| ' + marks.join(' | ') + ' |'
}

function serialize(text: TableText): string {
  const line = (cells: string[]) => '| ' + cells.join(' | ') + ' |'
  return [line(text.head), delimiterLine(text.align), ...text.rows.map(line)].join('\n')
}

/** The menu's document listeners, per table — see TableWidget.destroy. */
const menuCleanup = new WeakMap<HTMLElement, () => void>()

/**
 * What the next look at a table should do with the caret.
 *
 * A row or column the menu has just added — or the one Tab grew — does not
 * exist in the grid the edit was made from, so the cell to land in is named
 * here and picked up by the widget built from the *new* document. `null` says
 * the opposite: leave the caret alone. That is what an edit inside a cell
 * means — the widget is redrawn, the caret belongs to the widget (a cell input
 * holds the focus, and the text cursor has not moved), and without it the
 * redraw would pull the caret back to the first cell while Tab walks away.
 * Nothing at all is the `/table` case: the caret came in from the document,
 * and the cell it stands in has to be picked up.
 *
 * Matching on the table's start keeps it to that one table, and the entry is
 * consumed as soon as it is used, so a later redraw cannot act on it twice.
 */
let caret: { table: number; cell: string | null } | null = null

/**
 * The cell a blur is handing the focus to, as "row-column" for the DOM — or
 * `null` when the focus is going anywhere else, the document included.
 *
 * Read *before* the redraw the blur is about to cause: the event carries the
 * element that is receiving the focus, and a click on another cell only works
 * out because that element still knows which cell it was.
 */
function nextCell(root: HTMLElement, to: EventTarget | null): string | null {
  const box = to instanceof Element ? to.closest<HTMLElement>('[data-cell]') : null
  return box && root.contains(box) ? box.dataset.cell ?? null : null
}

/**
 * Whether a focus target is a cell of a table — the caret staying inside the
 * grid rather than going back to the document.
 */
function isCell(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-cell]') !== null
}

/**
 * The attribute on an editor's DOM that says a cell input holds the focus.
 *
 * Only then may a table reach for the caret. A focused cell input means an edit
 * is going on somewhere: every table in the document is redrawn for it, and a
 * table that opened a cell of its own from that redraw would pull the caret out
 * of the cell being typed in.
 *
 * Written from the focus events and not read off `document.activeElement` while
 * a table is drawn, because by then the redraw may have removed the input that
 * had the focus; a detached element reads as "the document has it", which is
 * exactly the wrong answer. It hangs on the editor's own DOM so that it belongs
 * to one editor and cannot outlive it.
 */
const EDITING = 'tableEditing'

/** Which cell of the table a cell object is, as "row-column" for the DOM. */
function cellIndex(table: TableData, cell: Cell): string {
  for (const [index, entry] of table.head.entries()) {
    if (entry === cell) return '0-' + index
  }
  for (const [row, cells] of table.rows.entries()) {
    for (const [index, entry] of cells.entries()) {
      if (entry === cell) return row + 1 + '-' + index
    }
  }
  return '0-0'
}

/**
 * Which half of the operations a click asked for: the whole set (a right-click
 * on a cell), the row's, or the column's.
 */
type MenuScope = 'cell' | 'row' | 'column'

/**
 * The icon that opens a row's or a column's operations: a chevron on a small
 * bordered square, pointing away from the table edge it sits on. Drawn here
 * rather than taken from `src/ui/icons.tsx`, which is React and cannot be
 * dropped into a widget's own DOM.
 */
function handleButton(kind: 'row' | 'column', label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'cm-md-table-handle cm-md-table-handle-' + kind
  button.setAttribute('aria-label', label)
  button.setAttribute('aria-haspopup', 'menu')

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', kind === 'row' ? 'M9 6l6 6-6 6' : 'M6 9l6 6 6-6')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '2')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(path)
  button.appendChild(svg)
  return button
}

/**
 * The table, with the input that makes each cell editable.
 *
 * A grid, not a `table` element: a table's own layout does not survive being put
 * inside a line of text. The columns are equal fractions of the measure, the same
 * count on every row — that is what lines them up.
 */
export class TableWidget extends WidgetType {
  constructor(readonly table: TableData) {
    super()
  }

  eq(other: TableWidget) {
    return JSON.stringify(other.table) === JSON.stringify(this.table)
  }

  toDOM(view: EditorView) {
    const root = document.createElement('div')
    root.className = 'cm-md-table'
    // Where the table stands, so a later redraw can be told from another one —
    // focusCell, and no other key of the DOM.
    root.dataset.table = String(this.table.from)
    root.appendChild(this.row(view, root, this.table.head, 0, true))
    this.table.rows.forEach((cells, index) => {
      root.appendChild(this.row(view, root, cells, index + 1, false))
    })

    // The handles follow the caret: the row's on the left edge, level with the
    // row, and the column's on the top edge, above the column. Which two are
    // out is one class on them and nothing else — no menu, no stored state.
    const handles = [...root.querySelectorAll<HTMLButtonElement>('.cm-md-table-handle')]
    const highlight = (row: number, column: number) => {
      for (const handle of handles) {
        handle.classList.toggle(
          'cm-md-table-handle-visible',
          handle.dataset.handleRow === String(row) || handle.dataset.handleColumn === String(column),
        )
      }
    }
    root.addEventListener('focusin', (event) => {
      const box = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-cell]')
      if (!box?.dataset.cell) return
      view.dom.dataset[EDITING] = '1'
      const [row, column] = box.dataset.cell.split('-').map(Number)
      highlight(row, column)
    })
    root.addEventListener('focusout', (event) => {
      // Stepping from one cell to the next is not leaving the table.
      if (root.contains(event.relatedTarget as Node | null)) return
      highlight(-1, -1)
    })

    root.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      const box = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-cell]')
      if (!box?.dataset.cell) return
      const [row, column] = box.dataset.cell.split('-').map(Number)
      this.openMenu(view, root, row, column, 'cell', event)
    })

    // Where the caret goes — see `caret`. An edit inside the table (a named
    // `null`) hands the widget nothing to do: Tab and Enter have already
    // worked out the next cell and are about to focus it themselves.
    const asked = caret && caret.table === this.table.from ? caret : null
    if (asked) caret = null
    if (asked?.cell) {
      const target = asked.cell
      queueMicrotask(() => {
        if (!root.isConnected) return
        root
          .querySelector<HTMLInputElement>('[data-cell="' + target + '"] .cm-md-table-input')
          ?.focus()
      })
    } else if (!asked && view.dom.dataset[EDITING] !== '1') {
      // `/table` leaves the cursor in a header cell that is not reachable as
      // text any more, so the cell the cursor stands in is the one to open.
      const head = view.state.selection.main.head
      const under = [...this.table.head, ...this.table.rows.flat()].find(
        (entry) => head >= entry.from && head <= entry.to,
      )
      if (under || (head >= this.table.from && head <= this.table.to)) {
        const target = under ? cellIndex(this.table, under) : null
        queueMicrotask(() => {
          if (!root.isConnected) return
          const input = target
            ? root.querySelector<HTMLInputElement>('[data-cell="' + target + '"] .cm-md-table-input')
            : root.querySelector<HTMLInputElement>('.cm-md-table-input')
          input?.focus()
          // The skeleton's first cell holds a placeholder word, and the entry
          // meant it to be typed over rather than typed after.
          // src/ui/editor-slash.ts, the table command's `select`
          input?.select()
        })
      }
    }

    return root
  }

  destroy(dom: HTMLElement) {
    for (const chip of dom.querySelectorAll<HTMLElement>('.cm-md-mention')) releaseMention(chip)
    // The menu listens on the document (a click anywhere has to close it), so it
    // has to be taken down here too — a widget can be replaced while it is open.
    menuCleanup.get(dom)?.()
    menuCleanup.delete(dom)
  }

  private row(
    view: EditorView,
    root: HTMLElement,
    cells: Cell[],
    row: number,
    head: boolean,
  ): HTMLElement {
    const element = document.createElement('div')
    element.className = head ? 'cm-md-table-row cm-md-table-head' : 'cm-md-table-row'
    element.style.gridTemplateColumns = 'repeat(' + Math.max(cells.length, 1) + ', minmax(0, 1fr))'

    cells.forEach((cell, column) => {
      const box = document.createElement('div')
      box.className = 'cm-md-table-cell'
      // The four corner cells carry the card's rounding: the table itself is
      // not clipped, so that the handles can sit outside its border.
      if (column === 0) box.classList.add('cm-md-table-cell-first')
      if (column === cells.length - 1) box.classList.add('cm-md-table-cell-last')
      box.dataset.cell = row + '-' + column
      const alignment = this.table.align[column]
      if (alignment) box.style.textAlign = alignment

      const text = document.createElement('div')
      text.className = 'cm-md-table-text'
      for (const piece of cell.pieces) {
        if (piece.kind === 'mention') {
          text.appendChild(mentionChip(piece.pubkey))
        } else if (piece.cls) {
          const span = document.createElement('span')
          span.className = piece.cls
          span.textContent = piece.text
          text.appendChild(span)
        } else {
          text.appendChild(document.createTextNode(piece.text))
        }
      }
      box.appendChild(text)

      // The editing surface: transparent, exactly over the text, and swapped in
      // only while it has the caret. src/ui/MarkdownEditor.tsx, the theme
      const input = document.createElement('input')
      input.className = 'cm-md-table-input'
      input.value = unescapeCell(cell.source)
      input.setAttribute('aria-label', 'Row ' + (row + 1) + ', column ' + (column + 1))
      input.addEventListener('keydown', (event) => this.key(view, input, cell, row, column, event))
      input.addEventListener('blur', (event) => {
        // Moving to another cell keeps the caret in the grid; anywhere else
        // hands it back to the document, which may then open a cell again.
        if (!isCell(event.relatedTarget)) delete view.dom.dataset[EDITING]
        this.commit(view, input, cell, { root, to: event.relatedTarget })
      })
      box.appendChild(input)

      // The column's handle lives in its own header cell: it is then above the
      // column it belongs to, without a second grid to keep in step.
      if (head) {
        const handle = handleButton('column', 'Column ' + (column + 1) + ' actions')
        handle.dataset.handleColumn = String(column)
        handle.addEventListener('mousedown', (event) => {
          // Taking the default would move the caret off the cell and take the
          // handle away before the click could land.
          event.preventDefault()
          event.stopPropagation()
          const rect = handle.getBoundingClientRect()
          this.openMenu(view, root, 0, column, 'column', { x: rect.left, y: rect.bottom + 6 })
        })
        box.appendChild(handle)
      }

      element.appendChild(box)
    })

    // A child of the row, so it is level with it however tall the row is.
    const rowHandle = handleButton('row', 'Row ' + (row + 1) + ' actions')
    rowHandle.dataset.handleRow = String(row)
    rowHandle.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const rect = rowHandle.getBoundingClientRect()
      this.openMenu(view, root, row, 0, 'row', { x: rect.right + 6, y: rect.top })
    })
    element.appendChild(rowHandle)

    return element
  }

  /**
   * Write one cell back. Nothing happens when the text did not change, which is
   * what makes this idempotent: the caret leaving a cell, Tab moving on and a
   * rebuild in between can all land here more than once.
   *
   * The document is checked first, because a handler can fire after an earlier
   * edit moved the cell — writing at a stale offset would corrupt a line that
   * has nothing to do with this table.
   */
  private commit(
    view: EditorView,
    input: HTMLInputElement,
    cell: Cell,
    /**
     * Where the focus is going, for a blur. Clicking another cell has already
     * chosen one, and the redraw the write causes would otherwise pull the caret
     * back to the first cell of the table.
     */
    blur?: { root: HTMLElement; to: EventTarget | null },
  ) {
    const change = this.cellChange(view, input, cell)
    if (!change) return
    // Everything else leaves the caret where it is: the text cursor has not
    // moved, and Tab or Enter has the next cell in hand already.
    caret = { table: this.table.from, cell: blur ? nextCell(blur.root, blur.to) : null }
    view.dispatch({ changes: change, userEvent: 'input' })
  }

  /**
   * The change an input asks for, or `null` when there is nothing to write.
   *
   * Shared by the caret leaving a cell and by Tab growing the table, which puts
   * both into one transaction. An empty cell — one the parser gave no node to —
   * writes over its whole slot, so the text lands the way a structural edit
   * would put it there: `| x |`, not `|x  |`. See rowCells.
   */
  private cellChange(
    view: EditorView,
    input: HTMLInputElement,
    cell: Cell,
  ): { from: number; to: number; insert: string } | null {
    const source = escapeCell(input.value)
    if (source === cell.source) return null
    if (view.state.doc.sliceString(cell.from, cell.to) !== cell.source) return null
    if (cell.slot && source) {
      return { from: cell.slot.from, to: cell.slot.to, insert: ' ' + source + ' ' }
    }
    return { from: cell.from, to: cell.to, insert: source }
  }

  private key(
    view: EditorView,
    input: HTMLInputElement,
    cell: Cell,
    row: number,
    column: number,
    event: KeyboardEvent,
  ): void {
    if (event.key === 'Escape') {
      // Put the text back: Escape means "I did not mean that".
      input.value = unescapeCell(cell.source)
      input.blur()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      this.commit(view, input, cell)
      if (!this.focusCell(view, row + 1, column)) input.blur()
      return
    }
    if (event.key !== 'Tab') return
    event.preventDefault()
    const columns = Math.max(this.table.head.length, 1)
    const flat = row * columns + column + (event.shiftKey ? -1 : 1)
    if (flat < 0) {
      this.commit(view, input, cell)
      input.blur()
      return
    }
    // Tab out of the last cell grows the table instead of leaving it: one more
    // row at the bottom, with the caret in its first cell. That is where the
    // writing continues, and it saves the trip to the row handle for the case
    // it is needed most.
    if (flat >= (this.table.rows.length + 1) * columns) {
      this.appendRow(view, input, cell, row + 1)
      return
    }
    this.commit(view, input, cell)
    if (!this.focusCell(view, Math.floor(flat / columns), flat % columns)) input.blur()
  }

  /**
   * One more row at the bottom, and the caret in its first cell.
   *
   * The cell being left and the new row go into **one** transaction. Two would
   * mean the second working from offsets the first may have moved: a cell whose
   * text grew would push the end of the table out from under the append.
   */
  private appendRow(view: EditorView, input: HTMLInputElement, cell: Cell, newRow: number) {
    // The row goes on the end of the table as this widget knows it; if that is
    // not where the table ends any more, the append would land somewhere else.
    if (!this.isCurrent(view)) return
    const changes: { from: number; to: number; insert: string }[] = []
    const change = this.cellChange(view, input, cell)
    if (change) changes.push(change)
    const line = '| ' + this.table.head.map(() => '').join(' | ') + ' |'
    changes.push({ from: this.table.to, to: this.table.to, insert: '\n' + line })
    // The new row's first cell is where the caret belongs, and the grid that has
    // it is the one drawn from the document this transaction is about to make.
    caret = { table: this.table.from, cell: newRow + '-0' }
    view.dispatch({ changes, userEvent: 'input' })
  }

  /**
   * Put the caret into a cell of *this* table as it stands **now** — after an
   * edit.
   *
   * Found through the editor rather than through the widget that started this,
   * because a write redraws the table and the DOM the key came from is gone. The
   * table is picked out by where it stands in the document, which a cell edit
   * does not move: `data-cell` alone would not do, since it counts from the top
   * of each table and a page can hold more than one.
   */
  private focusCell(view: EditorView, row: number, column: number): boolean {
    const table = view.contentDOM.querySelector<HTMLElement>(
      '.cm-md-table[data-table="' + this.table.from + '"]',
    )
    const input = table?.querySelector<HTMLInputElement>(
      '[data-cell="' + row + '-' + column + '"] .cm-md-table-input',
    )
    if (!input) return false
    input.focus()
    return true
  }

  /**
   * Is this still the table this widget was built from? `false` when the
   * document has moved on — see `TableData.source`.
   */
  private isCurrent(view: EditorView): boolean {
    return view.state.doc.sliceString(this.table.from, this.table.to) === this.table.source
  }

  private edit(view: EditorView, change: (text: TableText) => void, userEvent = 'input') {
    // A range that has moved since this widget was built replaces text that was
    // never part of the table. Doing nothing is the only safe answer: the menu
    // was opened against a document that no longer exists.
    if (!this.isCurrent(view)) return
    const text = tableText(this.table)
    change(text)
    view.dispatch({
      changes: { from: this.table.from, to: this.table.to, insert: serialize(text) },
      userEvent,
    })
  }

  private openMenu(
    view: EditorView,
    root: HTMLElement,
    row: number,
    column: number,
    scope: MenuScope,
    at: { x: number; y: number },
  ) {
    menuCleanup.get(root)?.()

    const menu = document.createElement('div')
    menu.className = 'cm-md-table-menu'
    menu.setAttribute('role', 'menu')

    const close = () => {
      menu.remove()
      root.classList.remove('cm-md-table-menu-open')
      document.removeEventListener('mousedown', outside, true)
      document.removeEventListener('keydown', onKey, true)
      if (menuCleanup.get(root) === close) menuCleanup.delete(root)
    }
    const outside = (event: Event) => {
      if (!menu.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    for (const entry of this.entries(view, row, column, scope)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'cm-md-table-menu-item'
      button.setAttribute('role', 'menuitem')
      button.textContent = entry.label
      if (entry.current) button.classList.add('cm-md-table-menu-current')
      if (entry.disabled) button.disabled = true
      else
        button.addEventListener('click', () => {
          close()
          entry.run()
        })
      menu.appendChild(button)
    }

    // Where the click landed: under a right-click on a cell, beside the row's
    // handle, below the column's.
    const rect = root.getBoundingClientRect()
    menu.style.left = at.x - rect.left + 'px'
    menu.style.top = at.y - rect.top + 'px'
    root.appendChild(menu)
    document.addEventListener('mousedown', outside, true)
    document.addEventListener('keydown', onKey, true)
    menuCleanup.set(root, close)
  }

  /**
   * The operations, grouped the way the handles ask for them: the row's, the
   * column's, or — a right-click on a cell — both at once, in Confluence's
   * order. `row` counts the way the grid counts: 0 is the header, because GFM
   * has no row above it to insert into.
   */
  private entries(
    view: EditorView,
    row: number,
    column: number,
    scope: MenuScope,
  ): { label: string; run: () => void; disabled?: boolean; current?: boolean }[] {
    const columns = this.table.head.length
    const body = row - 1
    const entry = this.edit.bind(this, view)
    const empty = () => this.table.head.map(() => '')

    // What a new row or column hands the caret to: the leftmost cell of the new
    // row, the topmost cell of the new column, in the numbering the new document
    // will have.
    const thenFocus = (targetRow: number, targetColumn: number) => {
      caret = { table: this.table.from, cell: targetRow + '-' + targetColumn }
    }

    const insertRowAbove = {
      label: 'Insert row above',
      disabled: row === 0,
      run: () => {
        thenFocus(row, 0)
        entry((text) => {
          text.rows.splice(body, 0, empty())
        })
      },
    }
    const insertRowBelow = {
      label: 'Insert row below',
      run: () => {
        thenFocus(row === 0 ? 1 : row + 1, 0)
        entry((text) => {
          text.rows.splice(row === 0 ? 0 : body + 1, 0, empty())
        })
      },
    }
    const insertColumnLeft = {
      label: 'Insert column left',
      run: () => {
        thenFocus(0, column)
        entry((text) => {
          text.head.splice(column, 0, '')
          for (const cells of text.rows) cells.splice(column, 0, '')
          text.align.splice(column, 0, null)
        })
      },
    }
    const insertColumnRight = {
      label: 'Insert column right',
      run: () => {
        thenFocus(0, column + 1)
        entry((text) => {
          const at = column + 1
          text.head.splice(at, 0, '')
          for (const cells of text.rows) cells.splice(at, 0, '')
          text.align.splice(at, 0, null)
        })
      },
    }
    const deleteRow = {
      label: 'Delete row',
      disabled: row === 0,
      run: () =>
        entry((text) => {
          text.rows.splice(body, 1)
        }, 'delete'),
    }
    const deleteColumn = {
      label: 'Delete column',
      disabled: columns <= 1,
      run: () =>
        entry((text) => {
          text.head.splice(column, 1)
          for (const cells of text.rows) cells.splice(column, 1)
          text.align.splice(column, 1)
        }, 'delete'),
    }
    const align = ['left', 'center', 'right'].map((alignment) => ({
      label: 'Align ' + alignment,
      current: this.table.align[column] === alignment,
      run: () => {
        // Only the delimiter line changes: the rows are left exactly as they
        // are, so aligning a column is not a rewrite of the whole table. That
        // one line has to still be there as well — see `TableData.source`.
        if (!this.isCurrent(view)) return
        const { from, to, source } = this.table.delimiter
        if (view.state.doc.sliceString(from, to) !== source) return
        view.dispatch({
          changes: {
            from,
            to,
            insert: delimiterLine(
              this.table.align.map((value, index) => (index === column ? alignment : value)),
            ),
          },
          userEvent: 'input',
        })
      },
    }))
    const deleteTable = {
      label: 'Delete table',
      run: () => {
        if (!this.isCurrent(view)) return
        // The blank line under the table is the table's own tail (see
        // `separatorLine`), so it goes with it — otherwise deleting a table
        // would leave an empty line behind. What is left is the blocks that
        // stood around it, separated by the blank line that was above it.
        const separator = separatorLine(view.state, this.table.to)
        view.dispatch({
          changes: {
            from: this.table.from,
            to: separator ? separator.to + 1 : this.table.to,
            insert: '',
          },
          userEvent: 'delete',
        })
      },
    }

    if (scope === 'row') return [insertRowAbove, insertRowBelow, deleteRow]
    if (scope === 'column') return [insertColumnLeft, insertColumnRight, deleteColumn, ...align]
    return [
      insertRowAbove,
      insertRowBelow,
      insertColumnLeft,
      insertColumnRight,
      deleteRow,
      deleteColumn,
      ...align,
      deleteTable,
    ]
  }
}

/**
 * The blank line a table needs under it — the one that keeps a paragraph from
 * being read as another row.
 *
 * GFM reads a plain line directly under a row as another row, so a paragraph
 * under a table only exists if a blank line separates the two. That line is
 * part of the table's syntax, not of the writer's text: it is where the table
 * ends, and the writer has no business putting a caret in it. It is not hidden
 * with the table either — a replaced range that reaches it would reach the end
 * of the document, and then the line the writer *does* write on stops being
 * drawn at all and the grid is left with no typeable line under it. So it stays
 * a real line, and is only taken out of the picture and out of the caret's
 * path. See the .cm-md-table-separator rules in MarkdownEditor.tsx.
 */
export function separatorLine(
  state: EditorState,
  tableTo: number,
): { from: number; to: number } | null {
  const doc = state.doc
  if (tableTo >= doc.length || doc.sliceString(tableTo, tableTo + 1) !== '\n') return null
  const after = tableTo + 1
  const next = doc.lineAt(after)
  if (next.from !== after || next.text.trim().length > 0) return null
  // A document that stops right there has no line *after* the blank one: that
  // empty final line is the writer's line, not a separator, and hiding it would
  // leave the grid with nothing under it at all. src/ui/MarkdownEditor.tsx
  if (next.to + 1 > doc.length) return null
  return { from: next.from, to: next.to }
}

function tableDecorations(state: EditorState): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return
      const table = tableData(node.node, state.doc)
      if (!table) return
      ranges.push(Decoration.replace({ widget: new TableWidget(table) }).range(node.from, node.to))
      const separator = separatorLine(state, node.to)
      if (!separator) return
      // A line with no height at all, and a stretch the caret steps over, so
      // the blank line is neither seen nor stood in. The air under the grid
      // then belongs to the line after it, which is the one the writer uses.
      ranges.push(Decoration.line({ class: 'cm-md-table-separator' }).range(separator.from))
      ranges.push(
        Decoration.mark({}).range(separator.from, Math.min(separator.to + 1, state.doc.length)),
      )
    },
  })
  return ranges
}

/**
 * The tables, one replaced range each. Rebuilt when the text changes and when
 * the parser finishes: the parser announces a finished tree with an empty
 * transaction, and without that check the field would keep the tree from before
 * the table was parsed and never draw it.
 */
export const tableState = StateField.define<DecorationSet>({
  create: (state) => Decoration.set(tableDecorations(state), true),
  update: (value, transaction) => {
    if (
      !transaction.docChanged &&
      syntaxTree(transaction.startState) === syntaxTree(transaction.state)
    ) {
      return value
    }
    return Decoration.set(tableDecorations(transaction.state), true)
  },
  provide: (field) => EditorView.decorations.from(field),
})

/**
 * Does the document stop at the last row of a table, with no line under it?
 *
 * A page saved before the table skeleton grew its trailing line ends exactly
 * there. The grid is then the last line of the document, so there is no text
 * position under it to put a caret in: a click beneath the card selects an
 * offset the browser cannot type at, and the writer sees a cursor they cannot
 * write from. The only honest answer is to open the line the click asked for —
 * `MarkdownEditor.tsx` appends the two newlines and puts the caret on the
 * second one, which is the paragraph line under the table.
 */
export function needsLineUnderTable(state: EditorState): boolean {
  let to: number | null = null
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Table') to = node.to
    },
  })
  return to !== null && to === state.doc.length
}

/**
 * A table is one thing, like a mention chip: the caret steps over it, a
 * selection takes it whole, and one Backspace removes it. The cell inputs are
 * how it is edited, not the text underneath them.
 */
export const tableAtomicRanges: Extension = EditorView.atomicRanges.of(
  (view) => view.state.field(tableState),
)
