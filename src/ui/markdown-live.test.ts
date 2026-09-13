// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { nip19 } from 'nostr-tools'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { editorFocus, liveMarkdown } from './markdown-live'
import { NO_SETEXT_HEADINGS } from './markdown-flavour'

// A mention chip warms the profile cache through the real store, which opens a
// WebSocket to VITE_PROFILE_RELAYS — a local relay while developing, and in
// jsdom that is a real connection whose events belong to another realm (the
// sporadic "event argument must be an instance of Event" from undici). These
// tests assert the chip's text, never a fetched name, so the store is replaced
// and the suite stays off the network.
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
 * The live formatting is decorations over a real document, so it can only be
 * checked against a real editor. jsdom is enough: what is asserted here is
 * which classes and widgets end up in the DOM, not how they are painted.
 */
const NPUB = nip19.npubEncode('1'.repeat(64))

/** A 2×2 table with the second column right-aligned. */
const TABLE = '| Name | Value |\n| --- | ---: |\n| a | 1 |'

/**
 * An editor on `doc`. Unfocused, so nothing is revealed — the tests about
 * revealing say so explicitly.
 */
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

/**
 * jsdom reports no focus for a contenteditable, so it is asserted directly —
 * and the focus change is dispatched the way the editor dispatches it
 * (`EditorView.focusChangeEffect`), because the table field is a state field
 * and cannot see the view's `hasFocus`.
 */
function focus(view: EditorView, at: number) {
  Object.defineProperty(view, 'hasFocus', { value: true })
  view.dispatch({ effects: editorFocus.of(true), selection: { anchor: at } })
}

/** the rendered text of the line, with hidden markup actually gone */
function lineText(view: EditorView, index: number): string {
  return view.contentDOM.children[index]?.textContent ?? ''
}

function lineClasses(view: EditorView, index: number): string {
  return view.contentDOM.children[index]?.className ?? ''
}

describe('liveMarkdown', () => {
  it('sizes a heading line and hides the # together with its space', () => {
    const view = mount('# Release notes\n\nBody')
    expect(lineClasses(view, 0)).toContain('cm-md-h1')
    expect(lineText(view, 0)).toBe('Release notes')
    view.destroy()
  })

  it('gives each heading level its own class', () => {
    const view = mount('# a\n## b\n### c\n#### d\n##### e\n###### f')
    for (const [index, level] of [1, 2, 3, 4, 5, 6].entries()) {
      expect(lineClasses(view, index)).toContain(`cm-md-h${level}`)
    }
    view.destroy()
  })

  it('shows the markup again on the line the cursor is on', () => {
    const view = mount('# Release notes')
    focus(view, 4)
    expect(lineText(view, 0)).toBe('# Release notes')
    view.destroy()
  })

  it('replaces a bullet marker with a bullet and keeps a number as it is', () => {
    const view = mount('- milk\n\n1. first')
    // The space behind the marker goes with it: the gap to the text is the
    // width of the gutter the marker fills, not a character that happens to
    // be there — that is what lines both kinds of list up on the same step.
    expect(lineText(view, 0)).toBe('•milk')
    expect(lineClasses(view, 0)).toContain('cm-md-item')
    expect(lineText(view, 2)).toBe('1.first')
    expect(view.contentDOM.innerHTML).toContain('cm-md-number')
    view.destroy()
  })

  it('indents a list by depth rather than by the spaces in the source', () => {
    const view = mount('- outer\n  - inner\n    - deep')
    expect(lineClasses(view, 0)).toContain('cm-md-depth-1')
    expect(lineClasses(view, 1)).toContain('cm-md-depth-2')
    expect(lineClasses(view, 2)).toContain('cm-md-depth-3')
    // the two spaces that nest the item are markup as well and go away, or
    // the line would be indented once by the padding and once by the source
    expect(lineText(view, 1)).toBe('◦inner')
    expect(lineText(view, 2)).toBe('▪deep')
    view.destroy()
  })

  it('shows the indentation again on the line being edited', () => {
    const view = mount('- outer\n  - inner')
    focus(view, 10)
    expect(lineText(view, 1)).toBe('  - inner')
    view.destroy()
  })

  it('draws a task list as real checkboxes that carry their state', () => {
    const view = mount('- [ ] open\n- [x] done')
    const boxes = view.contentDOM.querySelectorAll<HTMLInputElement>('input.cm-md-task')
    expect(boxes).toHaveLength(2)
    expect(boxes[0].checked).toBe(false)
    expect(boxes[1].checked).toBe(true)
    view.destroy()
  })

  it('keeps the box a box on the line being typed — a checklist is written on it', () => {
    const view = mount('- [ ] milk')
    focus(view, 10)
    // Every other marker falls back to raw text while the cursor is on its
    // line. This one does not: a box that appears only once the cursor has
    // left reads as "it did not work", and `[ ]` is not edited by hand.
    expect(view.contentDOM.querySelectorAll('input.cm-md-task')).toHaveLength(1)
    // marker and box are one thing, so the `- ` goes with it
    expect(lineText(view, 0)).toBe(' milk')
    view.destroy()
  })

  it('ticks the box in the document when it is clicked', () => {
    const view = mount('- [ ] open')
    const box = view.contentDOM.querySelector<HTMLInputElement>('input.cm-md-task')
    box?.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    expect(view.state.doc.toString()).toBe('- [x] open')
    view.destroy()
  })

  it('marks a quote and drops the > that produced it', () => {
    const view = mount('> quoted')
    expect(lineClasses(view, 0)).toContain('cm-md-quote')
    expect(lineText(view, 0)).toBe('quoted')
    view.destroy()
  })

  it('hides emphasis markers but keeps the emphasis', () => {
    const view = mount('a **bold** and *thin* and ~~gone~~ word')
    expect(lineText(view, 0)).toBe('a bold and thin and gone word')
    const html = view.contentDOM.innerHTML
    expect(html).toContain('cm-md-strong')
    expect(html).toContain('cm-md-em')
    expect(html).toContain('cm-md-strike')
    view.destroy()
  })

  it('shows a link by its label and keeps a bare URL visible', () => {
    const view = mount('see [the docs](https://example.com)\n\nhttps://example.com')
    expect(lineText(view, 0)).toBe('see the docs')
    expect(lineText(view, 2)).toBe('https://example.com')
    view.destroy()
  })

  it('keeps brackets that are not a link — they are two characters, not markup', () => {
    // Any bracket pair parses as a Link, because it *might* refer to a
    // definition further down. Almost always there is none, and the page then
    // prints the brackets. Hiding them is what made a checkbox impossible to
    // type: `[` and `]` vanished the moment they were closed.
    const view = mount('a [b] c\n\n- [X]')
    expect(lineText(view, 0)).toBe('a [b] c')
    expect(lineText(view, 2)).toBe('•[X]')
    view.destroy()
  })

  it('draws a checkbox while it is being written, and no bullet beside it', () => {
    const view = mount('- [ ] aufgabe')
    expect(view.contentDOM.querySelectorAll('input.cm-md-task')).toHaveLength(1)
    expect(view.contentDOM.querySelectorAll('.cm-md-bullet')).toHaveLength(0)
    view.destroy()
  })

  it('draws an image, whichever host it comes from and without a click', () => {
    // No gate on the origin, in the editor or on the page: a picture that only
    // appears after a click is not a picture of anything. The cost — the host
    // learns who reads which page and when — is the accepted trade in
    // docs/09-security-privacy.md, not an oversight.
    const view = mount(
      '![a diagram](https://example.com/a.png)\n\n![dot](data:image/gif;base64,R0lGOD)',
    )
    const images = [...view.contentDOM.querySelectorAll<HTMLImageElement>('.cm-md-image img')]
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'https://example.com/a.png',
      'data:image/gif;base64,R0lGOD',
    ])
    expect(images[0].getAttribute('alt')).toBe('a diagram')
    expect(view.contentDOM.querySelector('.cm-md-image-load')).toBeNull()
    view.destroy()
  })

  it('puts the cursor on the image when the picture is clicked', () => {
    const view = mount('a ![dot](data:image/gif;base64,R0lGOD) b')
    view.contentDOM
      .querySelector('.cm-md-image img')
      ?.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    expect(view.state.selection.main.head).toBe(2)
    focus(view, 2)
    expect(view.contentDOM.querySelector('.cm-md-image')).toBeNull()
    view.destroy()
  })

  it('shows the image as written on the line the cursor is on', () => {
    const view = mount('![dot](data:image/gif;base64,R0lGOD)')
    focus(view, 3)
    expect(lineText(view, 0)).toBe('![dot](data:image/gif;base64,R0lGOD)')
    expect(view.contentDOM.querySelector('.cm-md-image')).toBeNull()
    view.destroy()
  })

  it('turns a rule into a rule and a fence into a code band', () => {
    const view = mount('---\n\n```js\nlet a = 1\n```')
    expect(view.contentDOM.querySelector('.cm-md-rule')).not.toBeNull()
    expect(lineClasses(view, 2)).toContain('cm-md-code-first')
    expect(lineClasses(view, 4)).toContain('cm-md-code-last')
    // the fence backticks are markup and go away; the language stays
    expect(lineText(view, 2)).toBe('js')
    expect(lineText(view, 3)).toBe('let a = 1')
    view.destroy()
  })

  it('draws a mention as a chip carrying the npub, and inside code does not', () => {
    const view = mount(`hi nostr:${NPUB}\n\n\`nostr:${NPUB}\``)
    const chip = view.contentDOM.querySelector<HTMLElement>('.cm-md-mention')
    expect(chip?.title).toBe(NPUB)
    expect(chip?.textContent?.startsWith('@')).toBe(true)
    // exactly one — the second occurrence is inline code
    expect(view.contentDOM.querySelectorAll('.cm-md-mention')).toHaveLength(1)
    view.destroy()
  })

  it('leaves a nostr link alone — its target is already hidden as markup', () => {
    const view = mount(`see [Alice](nostr:${NPUB}) now`)
    expect(lineText(view, 0)).toBe('see Alice now')
    expect(view.contentDOM.querySelectorAll('.cm-md-mention')).toHaveLength(0)
    view.destroy()
  })

  it('keeps the mention as one unit: it is atomic, unlike every other marker', () => {
    const view = mount(`nostr:${NPUB}`)
    focus(view, 5)
    // still a chip even with the cursor in the middle of it
    expect(view.contentDOM.querySelectorAll('.cm-md-mention')).toHaveLength(1)
    view.destroy()
  })

  it('reveals nothing while the editor is unfocused', () => {
    const view = mount('# Title')
    expect(lineText(view, 0)).toBe('Title')
    view.destroy()
  })

  it('never turns the line above a `-` into a heading', () => {
    // `-` under a paragraph is a Setext H2 in CommonMark — and the first
    // keystroke of `- milk`. The construct is off in both parsers, so the
    // paragraph stays one, cursor there or not. src/ui/markdown-flavour.ts
    const typing = mount('Shopping\n-')
    focus(typing, 10)
    expect(lineClasses(typing, 0)).not.toContain('cm-md-h2')
    typing.destroy()

    const left = mount('Shopping\n-')
    expect(lineClasses(left, 0)).not.toContain('cm-md-h2')
    expect(lineText(left, 0)).toBe('Shopping')
    left.destroy()
  })

  it('reads a line of dashes under a paragraph as the divider it looks like', () => {
    const view = mount('Shopping\n---')
    expect(lineClasses(view, 0)).not.toContain('cm-md-h2')
    expect(view.contentDOM.querySelector('.cm-md-rule')).not.toBeNull()
    view.destroy()
  })

  it('leaves an `=` underline as plain text — no longer a heading either', () => {
    const view = mount('Title\n=====')
    expect(lineClasses(view, 0)).not.toContain('cm-md-h1')
    expect(lineText(view, 1)).toBe('=====')
    view.destroy()
  })

  it('draws a table — header, rows and all — instead of its source', () => {
    const view = mount(TABLE)
    const table = view.contentDOM.querySelector('.cm-md-table')
    expect(table).not.toBeNull()
    expect(table?.querySelector('.cm-md-table-head')?.textContent).toBe('NameValue')
    const cells = [...(table?.querySelectorAll('.cm-md-table-cell') ?? [])].map((c) => c.textContent)
    // the delimiter row (`---`) is read for its alignment and never drawn
    expect(cells).toEqual(['Name', 'Value', 'a', '1'])
    view.destroy()
  })

  it('lines the columns up: every row is a grid with the same count', () => {
    const view = mount(TABLE)
    const rows = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-table-row')]
    expect(rows).toHaveLength(2)
    // Same count and same fractions on every row — that is what puts the
    // columns under one another, in place of a `table` element's own layout.
    for (const row of rows) expect(row.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
    view.destroy()
  })

  it('takes each column\'s alignment off the delimiter row', () => {
    const view = mount(TABLE)
    const head = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-table-head .cm-md-table-cell')]
    expect(head[0].style.textAlign).toBe('')
    expect(head[1].style.textAlign).toBe('right')
    expect(view.contentDOM.querySelector<HTMLElement>('.cm-md-table-row:not(.cm-md-table-head) .cm-md-table-cell')).not.toBeNull()
    view.destroy()
  })

  it('draws what is inside a cell the way the editor draws it', () => {
    const view = mount('| Name |\n| --- |\n| **bold** [docs](https://example.com) |')
    const cells = view.contentDOM.querySelectorAll('.cm-md-table-cell')
    expect(cells[1].querySelector('.cm-md-strong')?.textContent).toBe('bold')
    // a link shows its label; the target is markup, as everywhere else
    expect(cells[1].querySelector('.cm-md-link')?.textContent).toBe('docs')
    expect(cells[1].textContent).toBe('bold docs')
    view.destroy()
  })

  it('draws a mention inside a cell as the same chip', () => {
    const view = mount(`| Who |\n| --- |\n| nostr:${NPUB} |`)
    expect(view.contentDOM.querySelectorAll('.cm-md-table-cell .cm-md-mention')).toHaveLength(1)
    view.destroy()
  })

  it('reveals the whole table, not one line of it, while the cursor is in it', () => {
    const view = mount(TABLE)
    focus(view, 3)
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
    expect(lineText(view, 0)).toBe('| Name | Value |')
    // the row below as well: half a table over half its source is neither
    expect(lineText(view, 2)).toBe('| a | 1 |')
    view.destroy()
  })

  it('puts the cursor in the cell that was clicked', () => {
    const view = mount(TABLE)
    const cells = view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-table-cell')
    // A replaced range takes no clicks otherwise: the editor ignores every
    // event inside a widget, so the widget places the cursor itself.
    cells[3].dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    expect(view.state.selection.main.head).toBe(TABLE.indexOf('1'))
    // In a browser the click also focuses the editor and the focus event
    // follows; jsdom fires none, so it is dispatched here as the editor does.
    focus(view, TABLE.indexOf('1'))
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
    view.destroy()
  })

  it('draws the table again once the cursor has left it', () => {
    const view = mount(`${TABLE}\n\nafter`)
    focus(view, 3)
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
    focus(view, view.state.doc.length - 2)
    expect(view.contentDOM.querySelector('.cm-md-table')).not.toBeNull()
    view.destroy()
  })

  it('draws a table that is not a table at all — a paragraph with pipes — as it is', () => {
    const view = mount('a | b\nnot a delimiter')
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
    expect(lineText(view, 0)).toBe('a | b')
    view.destroy()
  })
})
