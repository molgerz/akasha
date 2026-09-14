// @vitest-environment jsdom
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { completionStatus } from '@codemirror/autocomplete'
import { MarkdownEditor } from './MarkdownEditor'
import { TABLE_SKELETON } from './editor-slash'
import { ThemeProvider } from '../theme/theme'

// jsdom has no matchMedia, and the theme asks it which mode the system is in.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

// jsdom's Range has no getClientRects, and CodeMirror measures the popup's text
// when it opens. Without this the measure throws asynchronously, after the test.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList

function mount(onAttach?: () => void) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(
      <ThemeProvider>
        <MarkdownEditor value="" onChange={() => {}} ariaLabel="content" onAttach={onAttach} />
      </ThemeProvider>,
    )
  })
  const content = host.querySelector<HTMLElement>('.cm-content')!
  const view = EditorView.findFromDOM(content)!
  const close = () => {
    act(() => root.unmount())
    host.remove()
  }
  return { host, content, view, close }
}

/** Type text the way the editor sees typing, then let the dropdown settle. */
async function type(view: EditorView, text: string) {
  for (const char of text) {
    act(() => {
      const head = view.state.selection.main.head
      view.dispatch({
        changes: { from: head, insert: char },
        selection: { anchor: head + char.length },
        userEvent: 'input.type',
      })
    })
  }
  // `activateOnTypingDelay` is 100ms: wait for the dropdown rather than for a
  // fixed span, so the test is not racing it.
  const deadline = Date.now() + 2000
  while (Date.now() < deadline && completionStatus(view.state) !== 'active') {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  // …and `interactionDelay` is 75ms: a pick is ignored while the popup is
  // younger than that.
  await new Promise((resolve) => setTimeout(resolve, 100))
}

function pressEnter(content: HTMLElement) {
  act(() => {
    content.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
  })
}

/**
 * The source is only useful once `MarkdownEditor` puts it in the
 * `autocompletion` override list. That is invisible to a test that calls the
 * source on its own, so this file drives the assembled editor: type a slash,
 * accept with the key the completion popup binds, and look at the document.
 */
describe('the / menu in the assembled editor', () => {
  it('inserts the table skeleton when the first entry is accepted', async () => {
    const { host, content, view, close } = mount()
    await type(view, '/')
    expect(host.querySelector('.cm-tooltip-autocomplete')).not.toBeNull()

    pressEnter(content)
    // …and the two newlines under it: the blank line the table needs to end at,
    // and the line the writer goes on writing on.
    expect(view.state.doc.toString()).toBe(TABLE_SKELETON + '\n\n')
    close()
  })

  it('accepts the attachment entry after the query narrowed to it', async () => {
    const onAttach = vi.fn()
    const { view, close } = mount(onAttach)
    await type(view, '/image')

    pressEnter(view.contentDOM)
    expect(onAttach).toHaveBeenCalledTimes(1)
    // the query is gone and nothing was written in its place
    expect(view.state.doc.toString()).toBe('')
    close()
  })

  it('leaves Enter alone when the menu is not open', () => {
    const { content, view, close } = mount()
    pressEnter(content)
    expect(view.state.doc.toString()).not.toBe(TABLE_SKELETON)
    close()
  })
})
