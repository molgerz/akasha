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
 * walks the cells, and the click brings out the handles Confluence has: one on
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
}

export type TableData = {
  from: number
  to: number
  /** the `---` line: it carries the alignment and is never drawn */
  delimiter: { from: number; to: number }
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

function rowCells(row: SyntaxNode, doc: Text): Cell[] {
  const cells: Cell[] = []
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableCell') cells.push(cellOf(child, doc))
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
  let delimiter = { from: table.from, to: table.from }
  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableHeader') head = rowCells(child, doc)
    else if (child.name === 'TableDelimiter') {
      delimiter = { from: child.from, to: child.to }
      align = delimiterAlign(child, doc)
    } else if (child.name === 'TableRow') rows.push(rowCells(child, doc))
  }
  if (head.length === 0) return null
  return { from: table.from, to: table.to, delimiter, head, rows, align }
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

    // `/table` leaves the cursor in the first header cell, and that cell is not
    // reachable as text any more — so the caret goes into it. Without this the
    // next keystroke would land in Markdown nobody can see.
    const head = view.state.selection.main.head
    if (head >= this.table.from && head <= this.table.to) {
      const cell = [...this.table.head, ...this.table.rows.flat()].find(
        (entry) => head >= entry.from && head <= entry.to,
      )
      queueMicrotask(() => {
        if (!root.isConnected) return
        const target = cell
          ? root.querySelector<HTMLInputElement>(
              '[data-cell="' + cellIndex(this.table, cell) + '"] .cm-md-table-input',
            )
          : null
        const input = target ?? root.querySelector<HTMLInputElement>('.cm-md-table-input')
        input?.focus()
        // The skeleton's first cell holds a placeholder word, and the entry
        // meant it to be typed over rather than typed after.
        // src/ui/editor-slash.ts, the table command's `select`
        input?.select()
      })
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
      input.addEventListener('blur', () => this.commit(view, input, cell))
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
  private commit(view: EditorView, input: HTMLInputElement, cell: Cell) {
    const source = escapeCell(input.value)
    if (source === cell.source) return
    if (view.state.doc.sliceString(cell.from, cell.to) !== cell.source) return
    view.dispatch({
      changes: { from: cell.from, to: cell.to, insert: source },
      userEvent: 'input',
    })
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
    this.commit(view, input, cell)
    const columns = Math.max(this.table.head.length, 1)
    const flat = row * columns + column + (event.shiftKey ? -1 : 1)
    if (flat < 0) {
      input.blur()
      return
    }
    if (!this.focusCell(view, Math.floor(flat / columns), flat % columns)) input.blur()
  }

  /** Put the caret into a cell of the table as it stands *now* — after an edit. */
  private focusCell(view: EditorView, row: number, column: number): boolean {
    const input = view.contentDOM.querySelector<HTMLInputElement>(
      '[data-cell="' + row + '-' + column + '"] .cm-md-table-input',
    )
    if (!input) return false
    input.focus()
    return true
  }

  private edit(view: EditorView, change: (text: TableText) => void, userEvent = 'input') {
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

    const insertRowAbove = {
      label: 'Insert row above',
      disabled: row === 0,
      run: () =>
        entry((text) => {
          text.rows.splice(body, 0, empty())
        }),
    }
    const insertRowBelow = {
      label: 'Insert row below',
      run: () =>
        entry((text) => {
          text.rows.splice(row === 0 ? 0 : body + 1, 0, empty())
        }),
    }
    const insertColumnLeft = {
      label: 'Insert column left',
      run: () =>
        entry((text) => {
          text.head.splice(column, 0, '')
          for (const cells of text.rows) cells.splice(column, 0, '')
          text.align.splice(column, 0, null)
        }),
    }
    const insertColumnRight = {
      label: 'Insert column right',
      run: () =>
        entry((text) => {
          const at = column + 1
          text.head.splice(at, 0, '')
          for (const cells of text.rows) cells.splice(at, 0, '')
          text.align.splice(at, 0, null)
        }),
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
      run: () =>
        // Only the delimiter line changes: the rows are left exactly as they
        // are, so aligning a column is not a rewrite of the whole table.
        view.dispatch({
          changes: {
            from: this.table.delimiter.from,
            to: this.table.delimiter.to,
            insert: delimiterLine(
              this.table.align.map((value, index) => (index === column ? alignment : value)),
            ),
          },
          userEvent: 'input',
        }),
    }))
    const deleteTable = {
      label: 'Delete table',
      run: () =>
        view.dispatch({
          changes: { from: this.table.from, to: this.table.to, insert: '' },
          userEvent: 'delete',
        }),
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

function tableDecorations(state: EditorState): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return
      const table = tableData(node.node, state.doc)
      if (!table) return
      ranges.push(Decoration.replace({ widget: new TableWidget(table) }).range(node.from, node.to))
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
 * A table is one thing, like a mention chip: the caret steps over it, a
 * selection takes it whole, and one Backspace removes it. The cell inputs are
 * how it is edited, not the text underneath them.
 */
export const tableAtomicRanges: Extension = EditorView.atomicRanges.of(
  (view) => view.state.field(tableState),
)
