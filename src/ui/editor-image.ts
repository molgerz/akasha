import { WidgetType } from '@codemirror/view'
import type { EditorView } from '@codemirror/view'
import { clampImageWidth, imageWidth, withImageWidth } from './image-width'

/**
 * An image in the editor: the picture, always.
 *
 * Every other construct hands its Markdown back when the caret reaches it — an
 * image must not. `![alt](url)` on screen is exactly the "weird Markdown view"
 * the live editor exists to avoid, and there is nothing in it anybody wants to
 * edit by hand. So the picture stays the picture, under the caret too, and is
 * *atomic*: the caret steps over it and one Backspace removes the whole thing
 * (src/ui/markdown-live.ts, the atoms set).
 *
 * What is edited instead is the size. Clicking selects the image and shows a
 * handle in its corner; dragging the handle scales it, and letting go writes the
 * width into the URL — `#width=480`, a fragment no server ever sees. Nothing
 * else about the picture changes: the alt text, a title and the rest of the line
 * stay as the writer had them. A picture that carries no size of its own — an
 * SVG drawn `width="100%"` — is measured once at the width the page would give
 * it and pinned there, so both sides agree on how big it is.
 * src/ui/image-width.ts, docs/13-editing.md
 */

/**
 * The image the caret was last put into, by URL without its width.
 *
 * It outlives the widget: resizing changes the document, the table and image
 * widgets are rebuilt from scratch, and without this the handle would vanish
 * under the finger that just dragged it. Keyed on the URL *without* the width
 * because the width is the one thing that changes while it is selected.
 */
let selectedImage: string | null = null

/** The document listeners a selection left behind — see ImageWidget.destroy. */
const selectionCleanup = new WeakMap<HTMLElement, () => void>()

/** The window listener a fitted picture left behind — see ImageWidget.destroy. */
const fitCleanup = new WeakMap<HTMLElement, () => void>()

export class ImageWidget extends WidgetType {
  constructor(
    /** the target as it stands in the document, fragment and all */
    readonly src: string,
    readonly alt: string,
    /** the target's own range: a resize rewrites this and nothing else */
    readonly urlFrom: number,
    readonly urlTo: number,
  ) {
    super()
  }

  eq(other: ImageWidget) {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      other.urlFrom === this.urlFrom &&
      other.urlTo === this.urlTo
    )
  }

  toDOM(view: EditorView) {
    const identity = withImageWidth(this.src, null)

    const wrapper = document.createElement('span')
    wrapper.className = 'cm-md-image'

    const width = imageWidth(this.src)

    const img = document.createElement('img')
    img.alt = this.alt
    img.loading = 'lazy'
    if (width !== null) img.style.width = width + 'px'
    wrapper.appendChild(img)

    // A source with no size of its own — an SVG drawn `width="100%"` is the
    // usual one — has nothing to shrink-wrap against: measured inside this box,
    // which is exactly as wide as the picture in it, it lays out to nothing,
    // and the page, where it sits in a full-width block, draws it at the whole
    // measure. So it is measured at that measure once and pinned to the
    // picture; both sides then show the same thing. docs/13-editing.md
    const fit = () => {
      if (width !== null || !wrapper.isConnected || img.naturalWidth === 0) return
      wrapper.style.width = '100%'
      img.style.width = ''
      const measured = Math.round(img.getBoundingClientRect().width)
      wrapper.style.width = ''
      if (measured > 0) img.style.width = measured + 'px'
      view.requestMeasure()
    }
    if (width === null) {
      img.addEventListener('load', fit)
      const onResize = () => fit()
      window.addEventListener('resize', onResize)
      fitCleanup.set(wrapper, () => window.removeEventListener('resize', onResize))
    }
    // Set last, so a cached picture cannot finish before the listener is on.
    img.src = this.src
    if (width === null) queueMicrotask(fit)

    const handle = document.createElement('span')
    handle.className = 'cm-md-image-handle'
    handle.title = 'Drag to resize'
    wrapper.appendChild(handle)

    const deselect = () => {
      if (selectedImage === identity) selectedImage = null
      wrapper.classList.remove('cm-md-image-selected')
      release()
    }
    const release = () => {
      selectionCleanup.get(wrapper)?.()
      selectionCleanup.delete(wrapper)
    }
    const select = () => {
      selectedImage = identity
      wrapper.classList.add('cm-md-image-selected')
      if (selectionCleanup.has(wrapper)) return
      // A click anywhere else puts it away again — the editor ignores events
      // inside a widget, so nothing else would.
      const outside = (event: MouseEvent) => {
        if (!wrapper.contains(event.target as Node)) deselect()
      }
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        deselect()
        view.focus()
      }
      document.addEventListener('mousedown', outside, true)
      document.addEventListener('keydown', onKey, true)
      selectionCleanup.set(wrapper, () => {
        document.removeEventListener('mousedown', outside, true)
        document.removeEventListener('keydown', onKey, true)
      })
    }

    if (selectedImage === identity) select()

    img.addEventListener('mousedown', (event) => {
      event.preventDefault()
      select()
    })

    handle.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const startX = event.clientX
      // Whatever it is drawn at now — its own width if it has one, otherwise the
      // size the browser gave it. Zero while it is still loading, and then the
      // drag simply starts at the minimum.
      const startWidth = imageWidth(this.src) ?? (img.getBoundingClientRect().width || img.naturalWidth)
      let dragged: number | null = null

      const move = (moveEvent: MouseEvent) => {
        dragged = clampImageWidth(startWidth + (moveEvent.clientX - startX))
        img.style.width = dragged + 'px'
        // The line grew or shrank under the caret; the editor's own idea of the
        // layout has to follow, or clicking below the picture lands elsewhere.
        view.requestMeasure()
      }
      const up = () => {
        document.removeEventListener('mousemove', move, true)
        document.removeEventListener('mouseup', up, true)
        if (dragged === null || dragged === imageWidth(this.src)) return
        view.dispatch({
          changes: { from: this.urlFrom, to: this.urlTo, insert: withImageWidth(this.src, dragged) },
          userEvent: 'input',
        })
      }

      document.addEventListener('mousemove', move, true)
      document.addEventListener('mouseup', up, true)
    })

    return wrapper
  }

  destroy(dom: HTMLElement) {
    // A selection hangs its listeners on the document, and a widget can be
    // replaced while one is open.
    selectionCleanup.get(dom)?.()
    selectionCleanup.delete(dom)
    // Same for the fit, which listens on the window.
    fitCleanup.get(dom)?.()
    fitCleanup.delete(dom)
  }
}
