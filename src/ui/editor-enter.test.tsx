// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { MarkdownEditor, continueList } from './MarkdownEditor'
import { NO_SETEXT_HEADINGS } from './markdown-flavour'
import { ThemeProvider } from '../theme/theme'

// jsdom has no matchMedia, and the theme asks it which mode the system is in.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

/**
 * Enter in a list. The command is checked on its own, and then once through the
 * assembled editor — the language binds Enter as well, so the binding losing
 * the race would be invisible to every test that only calls the command.
 */
function mount(doc: string) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: NO_SETEXT_HEADINGS })] }),
    parent,
  })
  view.dispatch({ selection: { anchor: doc.length } })
  return view
}

/** the document after pressing Enter `times` times at the end of `doc` */
function press(doc: string, times: number): string {
  const view = mount(doc)
  for (let i = 0; i < times; i++) continueList(view)
  const result = view.state.doc.toString()
  view.destroy()
  return result
}

describe('continueList', () => {
  it('carries the marker to the next line', () => {
    expect(press('- milk', 1)).toBe('- milk\n- ')
    expect(press('- [ ] task', 1)).toBe('- [ ] task\n- [ ] ')
    expect(press('1. one', 1)).toBe('1. one\n2. ')
  })

  it('starts the next task unticked, however the one above ended', () => {
    expect(press('- [x] done', 1)).toBe('- [x] done\n- [ ] ')
  })

  it('ends the list on the empty item, in one press', () => {
    // The one-item case is the one the language's default gets wrong: it
    // inserts a blank line and writes the marker again, so the marker only
    // goes on the press after that.
    expect(press('- milk', 2)).toBe('- milk\n')
    expect(press('- [ ] task', 2)).toBe('- [ ] task\n')
    expect(press('1. one', 2)).toBe('1. one\n')
  })

  it('ends it the same way once the list is longer', () => {
    expect(press('- a\n- b', 2)).toBe('- a\n- b\n')
    expect(press('- [ ] a\n- [ ] b', 2)).toBe('- [ ] a\n- [ ] b\n')
  })

  it('steps out one level at a time out of a nested list', () => {
    expect(press('- a\n  - b', 2)).toBe('- a\n  - b\n- ')
    expect(press('- a\n  - b', 3)).toBe('- a\n  - b\n')
  })

  it('leaves no empty line behind in a list that is already loose', () => {
    // A loose list — one with a blank line in it — makes the command keep it
    // loose by putting a blank line in front of the new item, so the cursor
    // would land two lines down. An empty line is something the writer types.
    expect(press('- a\n\n- b', 1)).toBe('- a\n\n- b\n- ')
    expect(press('- [ ] a\n\n- [ ] b', 1)).toBe('- [ ] a\n\n- [ ] b\n- [ ] ')
    expect(press('1. a\n\n2. b', 1)).toBe('1. a\n\n2. b\n3. ')
  })

  it('ends a loose list in one press too', () => {
    expect(press('- a\n\n- b', 2)).toBe('- a\n\n- b\n')
  })

  it('does nothing outside a list, so the default Enter still runs', () => {
    const view = mount('plain text')
    expect(continueList(view)).toBe(false)
    view.destroy()
  })
})

describe('the editor as it is assembled', () => {
  it.each([
    ['- [ ] task', '- [ ] task\n- [ ] ', '- [ ] task\n'],
    ['- stichpunkt', '- stichpunkt\n- ', '- stichpunkt\n'],
    ['1. eins', '1. eins\n2. ', '1. eins\n'],
  ])('binds Enter above the language\'s own, for %s', (start, continued, ended) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let value = start
    act(() => {
      root.render(
        <ThemeProvider>
          <MarkdownEditor value={value} onChange={(next) => (value = next)} ariaLabel="content" />
        </ThemeProvider>,
      )
    })

    const content = host.querySelector<HTMLElement>('.cm-content')!
    const view = EditorView.findFromDOM(content)!
    view.dispatch({ selection: { anchor: view.state.doc.length } })

    const enter = () =>
      act(() => {
        content.dispatchEvent(
          new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        )
      })

    enter()
    expect(view.state.doc.toString()).toBe(continued)
    enter()
    expect(view.state.doc.toString()).toBe(ended)

    act(() => root.unmount())
  })

  it("gives a table's edge the editor's Enter, not the language's", () => {
    // Both Enter bindings are high precedence and `continueList` is earlier:
    // for a table it has to decline so the table's own command runs, and only
    // the assembled editor shows that order. src/ui/markdown-live.ts
    const TABLE = '| Name | Value |\n| --- | ---: |\n| a | 1 |'
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let value = TABLE + '\n\n'
    act(() => {
      root.render(
        <ThemeProvider>
          <MarkdownEditor value={value} onChange={(next) => (value = next)} ariaLabel="content" />
        </ThemeProvider>,
      )
    })

    const content = host.querySelector<HTMLElement>('.cm-content')!
    const view = EditorView.findFromDOM(content)!
    view.dispatch({ selection: { anchor: TABLE.length } })
    act(() => {
      content.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
    })

    expect(view.state.doc.toString()).toBe(TABLE + '\n\n')
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(5)
    act(() => root.unmount())
  })
})
