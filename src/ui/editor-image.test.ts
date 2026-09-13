// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { liveMarkdown } from './markdown-live'
import { NO_SETEXT_HEADINGS } from './markdown-flavour'

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

/** An image, as the editor draws it: the picture, never the Markdown. */
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

const IMAGE = '![dot](https://example.com/a.png)'

function picture(view: EditorView): HTMLImageElement {
  const img = view.contentDOM.querySelector<HTMLImageElement>('.cm-md-image img')
  if (!img) throw new Error('no picture')
  return img
}

function drag(view: EditorView, by: number) {
  const handle = view.contentDOM.querySelector<HTMLElement>('.cm-md-image-handle')
  if (!handle) throw new Error('no handle')
  handle.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 100, bubbles: true }))
  document.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 100 + by, bubbles: true }))
  document.dispatchEvent(new window.MouseEvent('mouseup', { clientX: 100 + by, bubbles: true }))
}

describe('an image in the editor', () => {
  it('is the picture, from wherever it points — no gate, no Markdown', () => {
    const view = mount(IMAGE)
    expect(picture(view).getAttribute('src')).toBe('https://example.com/a.png')
    expect(picture(view).getAttribute('alt')).toBe('dot')
    expect(view.contentDOM.querySelector('.cm-md-image-load')).toBeNull()
    view.destroy()
  })

  it('stays the picture with the caret in it — the source is never the view', () => {
    const view = mount(IMAGE)
    Object.defineProperty(view, 'hasFocus', { value: true })
    view.dispatch({ selection: { anchor: 4 } })
    expect(view.contentDOM.querySelector('.cm-md-image img')).not.toBeNull()
    expect(view.state.doc.toString()).toBe(IMAGE)
    view.destroy()
  })

  it('is one thing the caret steps over: a single atomic range', () => {
    const view = mount(IMAGE)
    const ranges: [number, number][] = []
    for (const source of view.state.facet(EditorView.atomicRanges)) {
      source(view).between(0, view.state.doc.length, (from, to) => {
        ranges.push([from, to])
      })
    }
    expect(ranges).toEqual([[0, IMAGE.length]])
    view.destroy()
  })

  it('draws the width the URL asks for', () => {
    const view = mount('![dot](https://example.com/a.png#width=480)')
    expect(picture(view).style.width).toBe('480px')
    view.destroy()
  })

  it('measures a picture with no size of its own where the page draws it', () => {
    // An SVG written `width="100%"` has no width to shrink-wrap against, and
    // inside a box as wide as the picture it lays out to nothing. jsdom does no
    // layout, so the size the browser would report is stubbed in.
    const view = mount('![logo](https://example.com/logo.svg)')
    const img = picture(view)
    Object.defineProperty(img, 'naturalWidth', { value: 158 })
    img.getBoundingClientRect = () => ({ width: 640, height: 480 }) as unknown as DOMRect
    img.dispatchEvent(new window.Event('load'))

    expect(img.style.width).toBe('640px')
    // …and the box is left to shrink-wrap it, so the handle sits on the corner
    expect(view.contentDOM.querySelector<HTMLElement>('.cm-md-image')?.style.width).toBe('')
    view.destroy()
  })

  it('leaves a width the URL already asked for alone', () => {
    const view = mount('![dot](https://example.com/a.svg#width=480)')
    const img = picture(view)
    Object.defineProperty(img, 'naturalWidth', { value: 158 })
    img.dispatchEvent(new window.Event('load'))
    window.dispatchEvent(new window.Event('resize'))
    expect(img.style.width).toBe('480px')
    view.destroy()
  })

  it('shows a handle only once it is selected, and puts it away on Escape', () => {
    const view = mount(IMAGE)
    const wrapper = view.contentDOM.querySelector<HTMLElement>('.cm-md-image')
    expect(wrapper?.classList.contains('cm-md-image-selected')).toBe(false)

    picture(view).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    expect(wrapper?.classList.contains('cm-md-image-selected')).toBe(true)

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper?.classList.contains('cm-md-image-selected')).toBe(false)
    view.destroy()
  })

  it('puts it away when something else is clicked', () => {
    const view = mount(IMAGE)
    picture(view).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    expect(view.contentDOM.querySelector('.cm-md-image-selected')).toBeNull()
    view.destroy()
  })

  it('writes the dragged width into the URL — and only there', () => {
    const view = mount(IMAGE)
    picture(view).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    drag(view, 240)
    expect(view.state.doc.toString()).toBe('![dot](https://example.com/a.png#width=240)')
    // and the widget comes back at that width, still selected
    expect(picture(view).style.width).toBe('240px')
    expect(view.contentDOM.querySelector('.cm-md-image-selected')).not.toBeNull()
    view.destroy()
  })

  it('drags from the width it already has', () => {
    const view = mount('![dot](https://example.com/a.png#width=400)')
    picture(view).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    drag(view, -100)
    expect(view.state.doc.toString()).toBe('![dot](https://example.com/a.png#width=300)')
    view.destroy()
  })

  it('keeps the rest of the fragment, and never shrinks the picture away', () => {
    // A fragment with a space in it is not a Markdown link target at all — the
    // destination would end at the space — so this is a plain parameter.
    const view = mount('![dot](https://example.com/a.svg#v=1)')
    picture(view).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    drag(view, -1000)
    expect(view.state.doc.toString()).toBe('![dot](https://example.com/a.svg#v=1&width=80)')
    view.destroy()
  })

  it('leaves the document alone when it is only clicked', () => {
    const view = mount('before ' + IMAGE + ' after')
    picture(view).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    expect(view.state.doc.toString()).toBe('before ' + IMAGE + ' after')
    view.destroy()
  })
})
