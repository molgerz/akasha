// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { NO_SETEXT_HEADINGS } from './markdown-flavour'
import { Markdown } from './Markdown'

// The mention chip and the live editor warm the profile cache via the real
// store, which would open a WebSocket to VITE_PROFILE_RELAYS (a local relay
// during development). These tests assert the chip's text, never a fetched
// name, so the store is replaced to keep the suite off the network.
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
 * Turning a construct off in the editor's parser is the sort of change that is
 * blamed for anything that breaks afterwards — this one was, wrongly, for task
 * lists. So GFM is pinned down here: with the flavour and without it, the tree
 * has to be the same for everything except the heading it removes.
 */
function nodes(doc: string, extensions?: unknown): string {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: extensions as never })],
  })
  const out: string[] = []
  syntaxTree(state).iterate({
    enter: (n) => {
      out.push(n.name)
    },
  })
  return out.join(' ')
}

function page(markdownText: string): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<Markdown>{markdownText}</Markdown>))
  return host
}

describe('the editor parser, with Setext headings off', () => {
  it.each([
    ['task, open', '- [ ] milk'],
    ['task, ticked', '- [x] milk'],
    ['task, nested', '- [ ] a\n  - [ ] b'],
    ['table', '| a | b |\n|---|---|\n| 1 | 2 |'],
    ['strikethrough', '~~gone~~'],
    ['autolink', 'see https://example.com'],
    ['atx heading', '# Title'],
    ['bullet list', '- milk\n- bread'],
    ['numbered list', '1. one\n2. two'],
    ['quote', '> quoted'],
    ['fence', '```js\nlet a = 1\n```'],
  ])('leaves %s exactly as it was', (_label, doc) => {
    expect(nodes(doc, NO_SETEXT_HEADINGS)).toBe(nodes(doc))
  })

  it('removes the heading, and only that', () => {
    expect(nodes('Text\n-')).toContain('SetextHeading2')
    expect(nodes('Text\n-', NO_SETEXT_HEADINGS)).toBe('Document Paragraph')
    expect(nodes('Title\n===', NO_SETEXT_HEADINGS)).toBe('Document Paragraph')
  })

  it('gives a line of dashes back to the divider it looks like', () => {
    expect(nodes('Text\n---', NO_SETEXT_HEADINGS)).toBe('Document Paragraph HorizontalRule')
  })
})

describe('the page, told the same', () => {
  it('reads a `-` under a paragraph as a paragraph', () => {
    const rendered = page('Shopping\n-')
    expect(rendered.querySelector('h2')).toBeNull()
    // the newline under it is a line break (see below); the h2 that must not be
    // there is the point
    expect(rendered.querySelector('p br')).not.toBeNull()
  })

  it('reads a line of dashes under a paragraph as a divider', () => {
    const rendered = page('Shopping\n---')
    expect(rendered.querySelector('h2')).toBeNull()
    expect(rendered.querySelector('hr')).not.toBeNull()
    expect(rendered.querySelector('p')?.textContent).toBe('Shopping')
  })

  it('still makes a heading from a #, and a task from a box', () => {
    expect(page('# Title').querySelector('h1')?.textContent).toBe('Title')
    expect(page('- [ ] milk').querySelectorAll('input')).toHaveLength(1)
  })
})

describe('the page, on a single newline', () => {
  it('draws it as a line break, the way the editor does', () => {
    const rendered = page('Hallo\nTest')
    expect(rendered.querySelectorAll('p')).toHaveLength(1)
    // one paragraph with a <br> in it, exactly the two lines the editor draws
    expect(rendered.querySelectorAll('p br')).toHaveLength(1)
  })

  it('draws it inside a list item, a quote and a link too', () => {
    for (const doc of ['- first\n  second', '> first\n> second', '[first\nsecond](https://example.com)']) {
      expect(page(doc).querySelector('br')).not.toBeNull()
    }
  })

  it('does not touch the newlines inside a fenced code block', () => {
    const rendered = page('```\nHallo\nTest\n```')
    expect(rendered.querySelector('br')).toBeNull()
    expect(rendered.querySelector('code')?.textContent).toContain('Hallo\nTest')
  })
})
