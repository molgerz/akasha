// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { nip19 } from 'nostr-tools'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { liveMarkdown } from './markdown-live'
import { NO_SETEXT_HEADINGS } from './markdown-flavour'
import { TABLE_SKELETON } from './editor-slash'

// A chip in a cell warms the profile cache through the real store, which opens
// a WebSocket to VITE_PROFILE_RELAYS — a local relay during development, and in
// jsdom that is a real connection whose events belong to another realm. These
// tests assert the chip's text, never a fetched name.
vi.mock('../nostr/profile-store', () => ({
  peekProfile: () => null,
  primeProfiles: () => {},
  cacheProfile: () => {},
  useProfile: () => null,
  observeProfile: (_pubkey: string, listener: (profile: null) => void) => {
    listener(null)
    return () => {}
  },
}))

/**
 * The table is a real editor's widget, so it is checked against a real editor.
 * jsdom has no layout: what is asserted is the DOM, the document it writes and
 * where the caret ends up — not how it is painted.
 */
const TABLE = '| Name | Value |\n| --- | ---: |\n| a | 1 |'

/** Two tables, so a key that is only unique inside one can be caught. */
const TWO_TABLES = TABLE + '\n\nA paragraph between them.\n\n' + TABLE

function mount(doc: string) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: NO_SETEXT_HEADINGS }), liveMarkdown],
    }),
    parent,
  })
}

function cell(view: EditorView, row: number, column: number): HTMLInputElement {
  const input = view.contentDOM.querySelector<HTMLInputElement>(
    '[data-cell="' + row + '-' + column + '"] .cm-md-table-input',
  )
  if (!input) throw new Error('no cell ' + row + '-' + column)
  return input
}

/** A table on the page, by position — a document can hold more than one. */
function tableAt(view: EditorView, index: number): HTMLElement {
  const table = view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-table')[index]
  if (!table) throw new Error('no table ' + index)
  return table
}

function cellIn(table: HTMLElement, row: number, column: number): HTMLInputElement {
  const input = table.querySelector<HTMLInputElement>(
    '[data-cell="' + row + '-' + column + '"] .cm-md-table-input',
  )
  if (!input) throw new Error('no cell ' + row + '-' + column)
  return input
}

/** Type into a cell and let the caret leave it — what the browser does on blur. */
function type(input: HTMLInputElement, text: string) {
  input.value = text
  input.dispatchEvent(new window.Event('blur'))
}

function key(input: HTMLInputElement, name: string, shiftKey = false) {
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true }))
}

function openMenu(view: EditorView, row: number, column: number): HTMLElement {
  cell(view, row, column).dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }))
  const menu = view.contentDOM.querySelector<HTMLElement>('.cm-md-table-menu')
  if (!menu) throw new Error('no menu')
  return menu
}

function handle(view: EditorView, kind: 'row' | 'column', index: number): HTMLButtonElement {
  const found = view.contentDOM.querySelector<HTMLButtonElement>(
    '.cm-md-table-handle-' + kind + '[data-handle-' + kind + '="' + index + '"]',
  )
  if (!found) throw new Error('no ' + kind + ' handle ' + index)
  return found
}

function menu(view: EditorView): HTMLElement {
  const found = view.contentDOM.querySelector<HTMLElement>('.cm-md-table-menu')
  if (!found) throw new Error('no menu')
  return found
}

function entry(menu: HTMLElement, label: string): HTMLButtonElement {
  const found = [...menu.querySelectorAll<HTMLButtonElement>('.cm-md-table-menu-item')].find(
    (button) => button.textContent === label,
  )
  if (!found) throw new Error('no entry ' + label)
  return found
}

function atomicRanges(view: EditorView): [number, number][] {
  const ranges: [number, number][] = []
  for (const source of view.state.facet(EditorView.atomicRanges)) {
    source(view).between(0, view.state.doc.length, (from, to) => {
      ranges.push([from, to])
    })
  }
  return ranges
}

describe('the table in the editor', () => {
  it('draws the grid, with an editable cell for every cell of the source', () => {
    const view = mount(TABLE)
    const inputs = [...view.contentDOM.querySelectorAll<HTMLInputElement>('.cm-md-table-input')]
    expect(inputs.map((input) => input.value)).toEqual(['Name', 'Value', 'a', '1'])
    expect(view.contentDOM.querySelector('.cm-md-table-head')).not.toBeNull()
    // the delimiter row is read for its alignment and never drawn
    expect(view.contentDOM.textContent).not.toContain('---')
    view.destroy()
  })

  it('draws a cell with nothing in it, which the parser leaves as two pipes', () => {
    // `| a |  | c |`: the middle cell has no TableCell node of its own at all
    const view = mount('| a |  | c |\n| --- | --- | --- |\n| d |  | f |')
    const rows = view.contentDOM.querySelectorAll('.cm-md-table-row')
    expect(rows[0].querySelectorAll('.cm-md-table-cell')).toHaveLength(3)
    expect(rows[1].querySelectorAll('.cm-md-table-cell')).toHaveLength(3)
    expect(cell(view, 1, 1).value).toBe('')
    view.destroy()
  })

  it('draws the skeleton /table writes as a header and two whole rows', () => {
    const view = mount(TABLE_SKELETON.trim())
    const rows = view.contentDOM.querySelectorAll('.cm-md-table-row')
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.querySelectorAll('.cm-md-table-cell')).toHaveLength(2)
    view.destroy()
  })

  it('writes into a cell that was empty the shape a structural edit writes', () => {
    const view = mount('| a |  | c |\n| --- | --- | --- |\n| d |  | f |')
    type(cell(view, 1, 1), 'e')
    expect(view.state.doc.toString()).toBe('| a |  | c |\n| --- | --- | --- |\n| d | e | f |')
    view.destroy()
  })

  it('labels every cell for whoever cannot see the grid', () => {
    const view = mount(TABLE)
    expect(cell(view, 0, 1).getAttribute('aria-label')).toBe('Row 1, column 2')
    expect(cell(view, 1, 0).getAttribute('aria-label')).toBe('Row 2, column 1')
    view.destroy()
  })

  it('draws what is inside a cell the way the editor draws it', () => {
    const view = mount('| Name |\n| --- |\n| **bold** [docs](https://example.com) |')
    const box = view.contentDOM.querySelectorAll('.cm-md-table-cell')[1]
    expect(box.querySelector('.cm-md-strong')?.textContent).toBe('bold')
    // a link shows its label; the target is markup, as everywhere else
    expect(box.querySelector('.cm-md-link')?.textContent).toBe('docs')
    expect(box.querySelector<HTMLInputElement>('.cm-md-table-input')?.value).toBe(
      '**bold** [docs](https://example.com)',
    )
    view.destroy()
  })

  it('writes a cell back into the Markdown when the caret leaves it', () => {
    const view = mount(TABLE)
    type(cell(view, 1, 0), 'milk')
    expect(view.state.doc.toString()).toBe('| Name | Value |\n| --- | ---: |\n| milk | 1 |')
    view.destroy()
  })

  it('changes nothing when the text did not change', () => {
    const view = mount(TABLE)
    type(cell(view, 0, 0), 'Name')
    expect(view.state.doc.toString()).toBe(TABLE)
    view.destroy()
  })

  it('escapes a pipe, so it stays inside its cell — and reads back as a pipe', () => {
    const view = mount(TABLE)
    type(cell(view, 1, 1), 'a|b')
    expect(view.state.doc.toString()).toBe('| Name | Value |\n| --- | ---: |\n| a | a\\|b |')
    expect(cell(view, 1, 1).value).toBe('a|b')
    view.destroy()
  })

  it('puts a cell back when Escape is pressed', () => {
    const view = mount(TABLE)
    const input = cell(view, 1, 0)
    input.value = 'nonsense'
    key(input, 'Escape')
    expect(view.state.doc.toString()).toBe(TABLE)
    view.destroy()
  })

  it('walks the cells with Tab, writing each one on the way', async () => {
    const view = mount(TABLE)
    const input = cell(view, 1, 0)
    input.focus()
    input.value = 'milk'
    key(input, 'Tab')
    expect(view.state.doc.toString()).toContain('| milk | 1 |')
    // Writing the cell redraws the whole table. The caret has to end up in the
    // cell to the right all the same — the redraw must not take it back to the
    // first one, which it did as long as the widget's own hand-over ran for it.
    await Promise.resolve()
    expect(document.activeElement).toBe(cell(view, 1, 1))
    view.destroy()
  })

  it('walks back with Shift-Tab, writing on the way', async () => {
    const view = mount(TABLE)
    const input = cell(view, 1, 1)
    input.focus()
    input.value = 'two'
    key(input, 'Tab', true)
    expect(view.state.doc.toString()).toContain('| a | two |')
    await Promise.resolve()
    expect(document.activeElement).toBe(cell(view, 1, 0))
    view.destroy()
  })

  it('hangs a new row on the bottom when Tab leaves the last cell', async () => {
    const view = mount(TABLE)
    key(cell(view, 1, 1), 'Tab')
    expect(view.state.doc.toString()).toBe(TABLE + '\n|  |  |')
    // and the caret is in the new row's first cell, where the writing goes on
    await Promise.resolve()
    expect(document.activeElement).toBe(cell(view, 2, 0))
    view.destroy()
  })

  it('writes the cell it is leaving while it grows the table', async () => {
    const view = mount(TABLE)
    const input = cell(view, 1, 1)
    input.value = 'last'
    key(input, 'Tab')
    expect(view.state.doc.toString()).toBe(
      '| Name | Value |\n| --- | ---: |\n| a | last |\n|  |  |',
    )
    await Promise.resolve()
    expect(document.activeElement).toBe(cell(view, 2, 0))
    view.destroy()
  })

  it('does not grow the table when Shift-Tab leaves it at the front', () => {
    const view = mount(TABLE)
    key(cell(view, 0, 0), 'Tab', true)
    expect(view.state.doc.toString()).toBe(TABLE)
    expect(document.activeElement).not.toBe(cell(view, 0, 0))
    view.destroy()
  })

  it('does not pull the caret into another table while a cell is being written', async () => {
    const view = mount(TWO_TABLES)
    // The text cursor stands at the end of the document, which is inside the
    // last table — a redraw of every table then offers that one a caret to
    // take, and it took it.
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    const input = cellIn(tableAt(view, 0), 1, 0)
    input.focus()
    input.value = 'milk'
    key(input, 'Tab')
    await Promise.resolve()
    expect(document.activeElement).toBe(cellIn(tableAt(view, 0), 1, 1))
    view.destroy()
  })

  it('walks the cells of the table the caret is in, not of the one above it', () => {
    const view = mount(TWO_TABLES)
    const second = tableAt(view, 1)
    key(cellIn(second, 1, 0), 'Tab')
    expect(document.activeElement).toBe(cellIn(second, 1, 1))
    // `data-cell` counts from the top of a table, so the first table has a
    // cell with the same key — and a lookup from the editor finds that one
    expect(document.activeElement).not.toBe(cellIn(tableAt(view, 0), 1, 1))
    view.destroy()
  })

  it('moves down with Enter, and stays put in the last row', () => {
    const view = mount(TABLE)
    key(cell(view, 0, 0), 'Enter')
    expect(document.activeElement).toBe(cell(view, 1, 0))
    key(cell(view, 1, 0), 'Enter')
    expect(document.activeElement).not.toBe(cell(view, 1, 0))
    view.destroy()
  })

  it('writes the cell and moves down with Enter, not back to the top left', async () => {
    const view = mount(TABLE)
    const input = cell(view, 0, 0)
    input.focus()
    input.value = 'Heading'
    key(input, 'Enter')
    expect(view.state.doc.toString()).toContain('| Heading | Value |')
    await Promise.resolve()
    expect(document.activeElement).toBe(cell(view, 1, 0))
    view.destroy()
  })

  it('takes the caret into the cell the cursor was left in — what /table needs', async () => {
    const view = mount('')
    const skeleton = TABLE_SKELETON
    view.dispatch({
      changes: { from: 0, insert: skeleton },
      selection: { anchor: skeleton.indexOf('Column') },
    })
    await Promise.resolve()
    expect(document.activeElement).toBe(cell(view, 0, 0))
    view.destroy()
  })

  it('is one thing the caret steps over: a single atomic range', () => {
    const view = mount(TABLE)
    expect(atomicRanges(view)).toEqual([[0, TABLE.length]])
    view.destroy()
  })

  it('leaves a paragraph that only looks like a pipe table alone', () => {
    const view = mount('a | b\nnot a delimiter')
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
    view.destroy()
  })

  it('draws a mention inside a cell as the same chip', () => {
    // A real npub: the fabricated kind has no checksum and is not a mention.
    const npub = nip19.npubEncode('1'.repeat(64))
    const view = mount('| Who |\n| --- |\n| nostr:' + npub + ' |')
    expect(view.contentDOM.querySelectorAll('.cm-md-table-cell .cm-md-mention')).toHaveLength(1)
    view.destroy()
  })
})

describe('the table\'s right-click menu', () => {
  it('inserts a row below, and above the row it was opened on', () => {
    const first = mount(TABLE)
    entry(openMenu(first, 1, 0), 'Insert row below').click()
    expect(first.state.doc.toString()).toBe(TABLE + '\n|  |  |')
    first.destroy()

    const second = mount(TABLE)
    entry(openMenu(second, 1, 1), 'Insert row above').click()
    expect(second.state.doc.toString()).toBe('| Name | Value |\n| --- | ---: |\n|  |  |\n| a | 1 |')
    second.destroy()
  })

  it('has no row above the header, and no way to delete the header', () => {
    const view = mount(TABLE)
    const menu = openMenu(view, 0, 0)
    expect(entry(menu, 'Insert row above').disabled).toBe(true)
    expect(entry(menu, 'Delete row').disabled).toBe(true)
    expect(entry(menu, 'Delete column').disabled).toBe(false)
    view.destroy()
  })

  it('inserts a column on either side of the one that was clicked', () => {
    const view = mount(TABLE)
    entry(openMenu(view, 0, 1), 'Insert column right').click()
    expect(view.state.doc.toString()).toBe('| Name | Value |  |\n| --- | ---: | --- |\n| a | 1 |  |')
    view.destroy()

    const left = mount(TABLE)
    entry(openMenu(left, 0, 0), 'Insert column left').click()
    expect(left.state.doc.toString()).toBe('|  | Name | Value |\n| --- | --- | ---: |\n|  | a | 1 |')
    left.destroy()
  })

  it('deletes a row, and a column with its alignment', () => {
    const row = mount(TABLE)
    entry(openMenu(row, 1, 0), 'Delete row').click()
    expect(row.state.doc.toString()).toBe('| Name | Value |\n| --- | ---: |')
    row.destroy()

    const column = mount(TABLE)
    entry(openMenu(column, 0, 1), 'Delete column').click()
    expect(column.state.doc.toString()).toBe('| Name |\n| --- |\n| a |')
    column.destroy()
  })

  it('keeps the last column: a table with no columns is not a table', () => {
    const view = mount('| Name |\n| --- |\n| a |')
    expect(entry(openMenu(view, 0, 0), 'Delete column').disabled).toBe(true)
    view.destroy()
  })

  it('aligns a column by rewriting the delimiter line and nothing else', () => {
    const view = mount(TABLE)
    entry(openMenu(view, 0, 0), 'Align center').click()
    expect(view.state.doc.toString()).toBe('| Name | Value |\n| :---: | ---: |\n| a | 1 |')
    view.destroy()
  })

  it('marks the alignment the column already has', () => {
    const view = mount(TABLE)
    const menu = openMenu(view, 0, 1)
    expect(entry(menu, 'Align right').classList.contains('cm-md-table-menu-current')).toBe(true)
    expect(entry(menu, 'Align left').classList.contains('cm-md-table-menu-current')).toBe(false)
    view.destroy()
  })

  it('does nothing when the table it was opened on has moved since', () => {
    const view = mount('before\n\n' + TABLE)
    const menu = openMenu(view, 1, 0)
    // Something edits the document above the table. The widget that opened the
    // menu is older than the table now, and its range reaches into the
    // paragraph — replacing it would take the paragraph's last characters with
    // it. A table operation from a stale widget is refused.
    view.dispatch({ changes: { from: 0, insert: 'xxxxx' }, userEvent: 'input' })
    entry(menu, 'Delete row').click()
    expect(view.state.doc.toString()).toBe('xxxxxbefore\n\n' + TABLE)
    view.destroy()
  })
  it('deletes the whole table', () => {
    const view = mount('before\n\n' + TABLE + '\n\nafter')
    entry(openMenu(view, 0, 0), 'Delete table').click()
    expect(view.state.doc.toString()).toBe('before\n\n\n\nafter')
    view.destroy()
  })

  it('closes on Escape and on a click anywhere else', () => {
    const view = mount(TABLE)
    const menu = openMenu(view, 0, 0)
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(menu.isConnected).toBe(false)

    const again = openMenu(view, 0, 0)
    document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    expect(again.isConnected).toBe(false)
    view.destroy()
  })

  it('is not clipped, and rounds its corners on the corner cells instead', () => {
    const view = mount(TABLE)
    // The table has no `overflow: hidden` any more — the handles sit outside
    // its border — so the card's rounding comes from these four cells.
    expect(view.contentDOM.querySelector('.cm-md-table-head .cm-md-table-cell-first')).not.toBeNull()
    expect(view.contentDOM.querySelector('.cm-md-table-head .cm-md-table-cell-last')).not.toBeNull()
    expect(
      view.contentDOM.querySelector('.cm-md-table-row:last-child .cm-md-table-cell-first'),
    ).not.toBeNull()
    expect(
      view.contentDOM.querySelector('.cm-md-table-row:last-child .cm-md-table-cell-last'),
    ).not.toBeNull()
    view.destroy()
  })
})

describe('the row and column handles', () => {
  it('puts one handle beside every row and above every column', () => {
    const view = mount(TABLE)
    expect(view.contentDOM.querySelectorAll('.cm-md-table-handle-row')).toHaveLength(2)
    expect(view.contentDOM.querySelectorAll('.cm-md-table-handle-column')).toHaveLength(2)
    view.destroy()
  })

  it('brings out the handles of the row and the column the caret is in', () => {
    const view = mount(TABLE)
    const visible = (kind: 'row' | 'column', index: number) =>
      handle(view, kind, index).classList.contains('cm-md-table-handle-visible')
    expect(visible('row', 1)).toBe(false)

    cell(view, 1, 1).focus()
    expect(visible('row', 1)).toBe(true)
    expect(visible('column', 1)).toBe(true)
    expect(visible('row', 0)).toBe(false)
    expect(visible('column', 0)).toBe(false)
    view.destroy()
  })

  it('opens the row operations from the left handle, and no column ones', () => {
    const view = mount(TABLE)
    handle(view, 'row', 1).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    const opened = menu(view)
    expect([...opened.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Insert row above',
      'Insert row below',
      'Delete row',
    ])
    entry(opened, 'Delete row').click()
    expect(view.state.doc.toString()).toBe('| Name | Value |\n| --- | ---: |')
    view.destroy()
  })

  it('opens the column operations from the top handle, alignment included', () => {
    const view = mount(TABLE)
    handle(view, 'column', 1).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    const opened = menu(view)
    expect([...opened.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Insert column left',
      'Insert column right',
      'Delete column',
      'Align left',
      'Align center',
      'Align right',
    ])
    entry(opened, 'Align left').click()
    expect(view.state.doc.toString()).toBe('| Name | Value |\n| --- | :--- |\n| a | 1 |')
    view.destroy()
  })

  it('keeps the caret in the cell when a handle is clicked', () => {
    const view = mount(TABLE)
    const input = cell(view, 1, 0)
    input.focus()
    handle(view, 'row', 1).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    expect(document.activeElement).toBe(input)
    view.destroy()
  })
})
describe('where an insert leaves the caret', () => {
  it('goes to the leftmost cell of a row inserted below', async () => {
    const view = mount(TABLE)
    entry(openMenu(view, 1, 0), 'Insert row below').click()
    await Promise.resolve()
    expect(document.activeElement).toBe(cell(view, 2, 0))
    view.destroy()
  })

  it('goes to the leftmost cell of a row inserted above', async () => {
    const view = mount(TABLE)
    entry(openMenu(view, 1, 1), 'Insert row above').click()
    await Promise.resolve()
    expect(document.activeElement).toBe(cell(view, 1, 0))
    view.destroy()
  })

  it('goes to the topmost cell of a column inserted on either side', async () => {
    const left = mount(TABLE)
    entry(openMenu(left, 0, 0), 'Insert column left').click()
    await Promise.resolve()
    expect(document.activeElement).toBe(cell(left, 0, 0))
    left.destroy()

    const right = mount(TABLE)
    entry(openMenu(right, 0, 1), 'Insert column right').click()
    await Promise.resolve()
    expect(document.activeElement).toBe(cell(right, 0, 2))
    right.destroy()
  })

  it('gives a new row every column the others have', () => {
    const below = mount(TABLE)
    entry(openMenu(below, 1, 0), 'Insert row below').click()
    const rows = below.contentDOM.querySelectorAll('.cm-md-table-row')
    expect(rows).toHaveLength(3)
    expect(rows[2].querySelectorAll('.cm-md-table-cell')).toHaveLength(2)
    below.destroy()

    // the header has no row above it, so its menu inserts below — and the new
    // row still gets every column
    const header = mount(TABLE)
    entry(openMenu(header, 0, 0), 'Insert row below').click()
    const headRows = header.contentDOM.querySelectorAll('.cm-md-table-row')
    expect(headRows[1].querySelectorAll('.cm-md-table-cell')).toHaveLength(2)
    header.destroy()
  })
})
describe('where a click leaves the caret', () => {
  it('keeps the cell the focus is going to, not the first one', async () => {
    const view = mount(TABLE)
    const from = cell(view, 1, 0)
    from.value = 'milk'
    // A click elsewhere in the table blurs this cell with the element that is
    // receiving the focus attached to the event — the cell that was clicked.
    from.dispatchEvent(new window.FocusEvent('blur', { relatedTarget: cell(view, 1, 1) }))
    expect(view.state.doc.toString()).toContain('| milk | 1 |')
    await Promise.resolve()
    expect(document.activeElement).toBe(cell(view, 1, 1))
    view.destroy()
  })

  it('leaves the caret alone when the focus goes outside the table', async () => {
    const view = mount(TABLE)
    const from = cell(view, 1, 0)
    from.value = 'milk'
    // clicking the page: the write still happens, but nothing may pull the
    // caret back into the grid
    from.dispatchEvent(new window.FocusEvent('blur', { relatedTarget: document.body }))
    await Promise.resolve()
    expect(document.activeElement).not.toBe(cell(view, 0, 0))
    expect(document.activeElement).not.toBe(cell(view, 1, 1))
    view.destroy()
  })
})
