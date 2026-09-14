// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ensureSyntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
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
    expect(closing('a:b')).toBeNull()
    expect(closing('12:30')).toBeNull()
    expect(closing('https://host:8080')).toBeNull()
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
})

describe('emojiOnTyping', () => {
  it('is wired into the editor: typing the closing colon replaces the shortcode', () => {
    // jsdom does not drive CodeMirror's own text input, so the handler the
    // editor would call is called directly — the registration is what matters.
    expect(type('ship it :rocket')).toBe('ship it 🚀')
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
