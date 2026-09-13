// @vitest-environment jsdom
// The guard tests mount a real editor, so the syntax tree is parsed.
import { describe, expect, it, vi } from 'vitest'
import { CompletionContext } from '@codemirror/autocomplete'
import type { Completion, CompletionResult } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { SLASH_COMMANDS, TABLE_SKELETON, slashInsertCompletion } from './editor-slash'
import { emojiCompletion, mentionCompletion } from './editor-complete'

const slash = slashInsertCompletion()

/** the context the editor would hand a source: cursor at the end of `doc` */
function at(doc: string) {
  return new CompletionContext(EditorState.create({ doc }), doc.length, false)
}

/** the labels the source offers for a document whose cursor is at its end */
function options(doc: string): string[] | null {
  const result = slash(at(doc)) as CompletionResult | null
  return result ? result.options.map((option) => option.label) : null
}

/**
 * Apply one entry to a real editor and report what came out. `apply` is run
 * exactly the way CodeMirror runs it (`applyCompletion`), so a forgotten
 * function — which would insert the label instead — is caught here.
 */
function apply(doc: string, label: string, onAttach?: () => void) {
  const result = slashInsertCompletion(onAttach)(at(doc)) as CompletionResult
  const option = result.options.find((entry) => entry.label === label)
  expect(option, `no "${label}" entry`).toBeDefined()

  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({ state: EditorState.create({ doc }), parent })
  const run = option!.apply as (
    view: EditorView,
    completion: Completion,
    from: number,
    to: number,
  ) => void
  run(view, option!, result.from, result.to ?? result.from)

  const text = view.state.doc.toString()
  const selection = view.state.selection.main
  view.destroy()
  return { text, from: selection.from, to: selection.to }
}

/** a context built on a mounted editor, so `ifNotIn` sees a parsed tree */
function inEditor(doc: string, pos: number) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage })],
    }),
    parent,
  })
  const context = new CompletionContext(view.state, pos, false)
  const result = slash(context)
  view.destroy()
  return result
}

describe('the / trigger', () => {
  it('opens at the start of a line and offers the five blocks, in order', () => {
    expect(options('/')).toEqual(['table', 'image', 'code', 'quote', 'divider'])
    expect(SLASH_COMMANDS).toHaveLength(5)
  })

  it('opens on a later line of the document too', () => {
    expect(options('hello\n/ta')).toEqual(['table'])
  })

  it('narrows to the typed query, by label and by alias', () => {
    expect(options('/ta')).toEqual(['table'])
    expect(options('/img')).toEqual(['image'])
    expect(options('/blo')).toEqual(['quote'])
    expect(options('/rule')).toEqual(['divider'])
    expect(options('/zzz')).toBeNull()
  })

  it('needs the slash to be the first thing on the line', () => {
    // prose, a URL and a fraction are the false positives that would make the
    // menu feel like it is fighting you
    expect(slash(at('see /'))).toBeNull()
    expect(slash(at('https://'))).toBeNull()
    expect(slash(at('1/2'))).toBeNull()
    expect(slash(at('and/or'))).toBeNull()
    expect(slash(at('  /ta'))).toBeNull()
  })

  it('closes once a space ends the query', () => {
    expect(slash(at('/ ta'))).toBeNull()
  })

  it('stays out of a fenced code block', () => {
    const doc = '```\n/ta\n```'
    expect(inEditor(doc, doc.indexOf('/ta') + 3)).toBeNull()
  })

  it('stays out of an inline code span', () => {
    // A code span may run across lines, which is the only way its slash can be
    // the first character of a line — so the line-start check alone is not what
    // keeps the menu out of it.
    const doc = '`\n/ta\n`'
    expect(inEditor(doc, doc.indexOf('/ta') + 3)).toBeNull()
  })

  it('does not answer for the @ and : triggers', () => {
    expect(slash(at('@'))).toBeNull()
    expect(slash(at(':smile'))).toBeNull()
    // …and the two sources that own those triggers do not answer for /
    expect(mentionCompletion(() => ['1'.repeat(64)])(at('/'))).toBeNull()
    expect(emojiCompletion(at('/'))).toBeNull()
  })
})

describe('what a / entry writes', () => {
  it('writes the 3×2 table skeleton and selects the first header cell', () => {
    const { text, from, to } = apply('/', 'table')
    expect(text).toBe(TABLE_SKELETON)
    // a header and *two* body rows — one row would be a table to extend before
    // it could be typed into
    expect(TABLE_SKELETON.split('\n')).toEqual([
      '| Column | Value |',
      '| --- | --- |',
      '|  |  |',
      '|  |  |',
    ])
    // the placeholder is selected, so typing replaces it instead of jamming
    // against the word "Column"
    expect(text.slice(from, to)).toBe('Column')
    expect(from).toBe(TABLE_SKELETON.indexOf('Column'))
  })

  it('writes the table where the slash was, on the line it stood on', () => {
    // The slash is the first character of its line, so the table already has a
    // line of its own: a blank line before it would only push it down and leave
    // the empty line behind. A table under a paragraph is a table to GFM.
    expect(apply('hello\n/ta', 'table').text).toBe('hello\n' + TABLE_SKELETON)
  })

  it('writes a fenced pair with the cursor on the language line', () => {
    const { text, from } = apply('/', 'code')
    expect(text).toBe('```\n\n```\n')
    expect(text.slice(0, from)).toBe('```')
  })

  it('writes a quote marker and puts the cursor after it', () => {
    const { text, from } = apply('/', 'quote')
    expect(text).toBe('> ')
    expect(from).toBe(2)
  })

  it('writes a divider and puts the cursor at the end of its line', () => {
    const { text, from } = apply('/', 'divider')
    expect(text).toBe('---\n')
    expect(from).toBe(3)
  })

  it('gives the divider a blank line above only when a paragraph is there', () => {
    // `text` over `---` is a Setext heading to every client that does not turn
    // that off the way this app does — the one block that needs the blank line.
    expect(apply('hello\n/di', 'divider').text).toBe('hello\n\n---\n')
    // with a blank line already there, one is enough
    expect(apply('hello\n\n/di', 'divider').text).toBe('hello\n\n---\n')
  })

  it('inserts nothing for the attachment entry and calls the picker', () => {
    const onAttach = vi.fn()
    const { text } = apply('/image', 'image', onAttach)
    expect(onAttach).toHaveBeenCalledTimes(1)
    // the typed query goes, the embed comes later, when the URL exists
    expect(text).toBe('')
  })

  it('removes the typed /query without touching the text above it', () => {
    const onAttach = vi.fn()
    expect(apply('hello\n/image', 'image', onAttach).text).toBe('hello\n')
  })
})
