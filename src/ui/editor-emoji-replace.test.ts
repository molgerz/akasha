// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ensureSyntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { NO_SETEXT_HEADINGS } from './markdown-flavour'
import { emojiOnTyping, emojiReplacement } from './editor-emoji-replace'

/**
 * docs/13 left this open with one named risk — firing inside `a:b:c` — so most
 * of what is pinned here is where the rule must *not* fire. A replacement that
 * happens once too often eats somebody's timestamp, their YAML key or their
 * Ruby symbol, and it does it silently.
 */
function mount(doc: string) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: NO_SETEXT_HEADINGS }),
        emojiOnTyping,
      ],
    }),
    parent,
  })
  // The code guard reads the syntax tree, and a lazily parsed one would report
  // no code block at all.
  ensureSyntaxTree(view.state, view.state.doc.length, 5000)
  return view
}

/** What typing `:` at the end of `doc` would do. */
function closing(doc: string, text = ':') {
  const view = mount(doc)
  const end = view.state.doc.length
  const change = emojiReplacement(view.state, end, end, text)
  view.destroy()
  return change
}

/** The same, but through the editor — the wiring, not just the rule. */
function type(doc: string, text = ':'): string {
  const view = mount(doc)
  const end = view.state.doc.length
  view.dispatch({ selection: { anchor: end } })
  const handled = view.state
    .facet(EditorView.inputHandler)
    .some((handler) => handler(view, end, end, text, () => view.state.update({})))
  const result = handled ? view.state.doc.toString() : `${doc}${text}`
  view.destroy()
  return result
}

describe('emojiReplacement', () => {
  it('turns a shortcode typed out in full into the character', () => {
    expect(closing(':smile')).toEqual({ from: 0, to: 6, insert: '😄' })
    expect(closing('ship it :rocket')).toEqual({ from: 8, to: 15, insert: '🚀' })
  })

  it('leaves a:b:c alone — the colon has a word character in front of it', () => {
    // Every name here is one we know, deliberately: with `a:b` or `12:30` the
    // name guard answers first and the boundary rule — the one the ticket is
    // actually about — is never reached, so the case would pass with the
    // boundary check deleted.
    expect(closing('a:smile')).toBeNull()
    expect(closing('a:b:smile')).toBeNull()
    expect(closing('12:30:cat')).toBeNull()
    expect(closing('https://host:smile')).toBeNull()
    expect(closing('host:8080/x:cat')).toBeNull()
  })

  it('reads the character in front of the colon even past the look-back window', () => {
    // The 64-character window is a slice, not a line start. A word running
    // past it must not come out looking like a boundary, or `a:b:c` would be
    // replaced again on long lines.
    const long = 'x'.repeat(80)
    expect(closing(`${long}:smile`)).toBeNull()
    expect(closing(`${long} :smile`)).toEqual({ from: 81, to: 87, insert: '😄' })
  })

  it('replaces mid-line, with text still standing behind the caret', () => {
    const view = mount('ship it :rocket today')
    expect(emojiReplacement(view.state, 15, 15, ':')).toEqual({ from: 8, to: 15, insert: '🚀' })
    view.destroy()
  })

  it('opens after a bracket as well, where a shortcode really can start', () => {
    expect(closing('(:tada')).toEqual({ from: 1, to: 6, insert: '🎉' })
  })

  it('leaves a shortcode nobody knows as it was typed', () => {
    expect(closing(':notanemoji')).toBeNull()
    expect(closing(':')).toBeNull()
  })

  it('accepts the name however it was capitalised', () => {
    expect(closing(':SMILE')?.insert).toBe('😄')
  })

  it('fires on the typed colon only, never on a paste or over a selection', () => {
    expect(closing(':smile', ':smile:')).toBeNull()
    expect(closing(':smile', 'x')).toBeNull()

    const view = mount('hello :smile')
    // a selection, not a cursor: somebody is replacing text, not writing
    expect(emojiReplacement(view.state, 6, 12, ':')).toBeNull()
    view.destroy()
  })

  it('stays out of code, where a shortcode is a literal', () => {
    expect(closing('```\nkey: :smile')).toBeNull()
    expect(closing('    indented :smile')).toBeNull()
    // an inline span that is already closed, with the caret typing inside it
    const view = mount('`a :smile:`')
    expect(emojiReplacement(view.state, 9, 9, ':')).toBeNull()
    view.destroy()

    // …and it is the code around them that stops those three, not their text:
    // the same words outside a code block are replaced as usual.
    expect(closing('key: :smile')).toEqual({ from: 5, to: 11, insert: '😄' })
    expect(closing('indented :smile')).toEqual({ from: 9, to: 15, insert: '😄' })
    expect(closing('a :smile')).toEqual({ from: 2, to: 8, insert: '😄' })
  })

  it('stays out of an inline code span that is still being typed', () => {
    // The tree cannot answer this one: at the moment the closing colon is
    // typed the line reads `` `a :smile `` and lezer sees a plain paragraph,
    // so the backticks have to be counted. Before that, the replacement fired
    // and swallowed a code literal somebody meant to keep.
    expect(closing('`a :smile')).toBeNull()
    expect(closing('write `:smile')).toBeNull()

    // A span that was opened and closed again leaves the rest of the line free…
    expect(closing('`code` then :smile')).toEqual({ from: 12, to: 18, insert: '😄' })
    // …and a run of two backticks is closed by a run of two, not by the single
    // one it encloses.
    expect(closing('``a ` b`` then :smile')).toEqual({ from: 15, to: 21, insert: '😄' })
  })
})

describe('emojiOnTyping', () => {
  it('is wired into the editor: typing the closing colon replaces the shortcode', () => {
    // jsdom does not drive CodeMirror's own text input, so the handler the
    // editor would call is called directly — the registration is what matters.
    expect(type('ship it :rocket')).toBe('ship it 🚀')
  })

  it('undoes to the shortcode without its closing colon', () => {
    // What undo can give back, pinned, because docs/13 used to promise more
    // than it does: the typed colon never enters the document, so no Ctrl+Z
    // can produce `:smile:`. `newGroupDelay: 0` keeps the steps apart here —
    // with the default grouping the one undo takes the typing with it too.
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          markdown({ base: markdownLanguage, extensions: NO_SETEXT_HEADINGS }),
          history({ newGroupDelay: 0 }),
          emojiOnTyping,
        ],
      }),
      parent,
    })
    for (const char of ':smile') {
      const at = view.state.doc.length
      view.dispatch({
        changes: { from: at, insert: char },
        selection: { anchor: at + 1 },
        userEvent: 'input.type',
      })
    }
    const end = view.state.doc.length
    view.state
      .facet(EditorView.inputHandler)
      .some((handler) => handler(view, end, end, ':', () => view.state.update({})))
    expect(view.state.doc.toString()).toBe('😄')
    undo(view)
    expect(view.state.doc.toString()).toBe(':smile')
    view.destroy()
  })

  it('puts the caret behind the emoji, not where the colon would have gone', () => {
    const view = mount(':smile')
    const end = view.state.doc.length
    view.dispatch({ selection: { anchor: end } })
    view.state
      .facet(EditorView.inputHandler)
      .some((handler) => handler(view, end, end, ':', () => view.state.update({})))
    expect(view.state.selection.main.head).toBe(view.state.doc.length)
    view.destroy()
  })

  it('passes an ordinary colon through untouched', () => {
    expect(type('12:30')).toBe('12:30:')
    expect(type('note')).toBe('note:')
  })
})
