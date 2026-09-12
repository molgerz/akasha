// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { liveMarkdown } from './markdown-live'
import { NO_SETEXT_HEADINGS } from './markdown-flavour'
import { emojiCompletion, mentionCompletion } from './editor-complete'
import { slashInsertCompletion } from './editor-slash'
import { FORMATTING_RULES } from './formatting-help'

/**
 * The `Formatting` fold is the answer to "why did that not do anything", so
 * every line in it is typed into a real editor here and has to draw what it
 * claims. An entry that is almost right — `- []`, which gives a bullet and a
 * literal `[]` — is worse than no entry at all. docs/13-editing.md
 */
function draws(document: string, check: (view: EditorView) => boolean): boolean {
  const parent = window.document.createElement('div')
  window.document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({
      doc: document,
      extensions: [markdown({ base: markdownLanguage, extensions: NO_SETEXT_HEADINGS }), liveMarkdown],
    }),
    parent,
  })
  const result = check(view)
  view.destroy()
  return result
}

const has = (selector: string) => (view: EditorView) =>
  view.contentDOM.querySelector(selector) !== null

const firstLineHas = (cls: string) => (view: EditorView) =>
  (view.contentDOM.children[0]?.className ?? '').includes(cls)

/** the context a completion source would be handed: cursor at the end */
const at = (doc: string) => new CompletionContext(EditorState.create({ doc }), doc.length, false)

/**
 * What each line of the fold has to produce. Keyed by the syntax exactly as it
 * is offered — add a rule to the fold and this fails until it is checked here.
 */
const PROOF: Record<string, () => boolean> = {
  '# ': () => draws('# Title', firstLineHas('cm-md-h1')),
  '- ': () => draws('- milk', has('.cm-md-bullet')),
  '1. ': () => draws('1. milk', has('.cm-md-number')),
  '- [ ] ': () => draws('- [ ] milk', has('input.cm-md-task')),
  '**text**': () => draws('**text**', has('.cm-md-strong')),
  '*text*': () => draws('*text*', has('.cm-md-em')),
  '~~text~~': () => draws('~~text~~', has('.cm-md-strike')),
  '`code`': () => draws('`code`', has('.cm-md-inline-code')),
  '[text](url)': () =>
    draws('[text](https://example.com)', (view) => view.contentDOM.textContent === 'text'),
  '> ': () => draws('> quoted', firstLineHas('cm-md-quote')),
  '```': () => draws('```js\nlet a = 1\n```', firstLineHas('cm-md-code-first')),
  '---': () => draws('Text\n\n---', has('.cm-md-rule')),
  '@': () => mentionCompletion(() => ['1'.repeat(64)])(at('@')) !== null,
  ':smile': () => emojiCompletion(at(':smile')) !== null,
  '/': () => slashInsertCompletion()(at('/')) !== null,
}

describe('the Formatting fold', () => {
  it.each(FORMATTING_RULES)('$syntax really does: $meaning', ({ syntax }) => {
    const proof = PROOF[syntax]
    expect(proof, `no check for "${syntax}" — add one`).toBeDefined()
    expect(proof()).toBe(true)
  })

  it('checks every entry and nothing that is no longer offered', () => {
    expect(Object.keys(PROOF).sort()).toEqual(FORMATTING_RULES.map((r) => r.syntax).sort())
  })

  it('does not offer the checkbox without the space — that is a literal []', () => {
    expect(draws('- [] milk', has('input.cm-md-task'))).toBe(false)
    expect(FORMATTING_RULES.some((rule) => rule.syntax.includes('[]'))).toBe(false)
  })

  it('means "on a line of its own" literally — under text it is a divider too', () => {
    // It used to be a Setext heading for the line above, which is why the
    // entry once carried a caveat. src/ui/markdown-flavour.ts
    expect(draws('Text\n---', has('.cm-md-rule'))).toBe(true)
  })
})
