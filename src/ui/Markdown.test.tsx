// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { nip19 } from 'nostr-tools'
import { Markdown } from './Markdown'

// A mention chip asks the profile store for a name, and the real store opens a
// WebSocket to VITE_PROFILE_RELAYS — in jsdom a real connection whose events
// belong to another realm, and whose retry timer outlives the test file. These
// tests assert the chip's npub, never a fetched name.
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
 * The rendered page, checked against the editor's live formatting: a mention
 * is a chip on both sides, and a list is indented the same way.
 * src/ui/markdown-live.test.ts
 */
const NPUB = nip19.npubEncode('1'.repeat(64))

function render(markdown: string): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<Markdown>{markdown}</Markdown>)
  })
  return host
}

describe('Markdown', () => {
  it('draws a mention as a chip carrying the npub, not as a bare link', () => {
    const page = render(`Ask nostr:${NPUB} please`)
    const chip = page.querySelector<HTMLElement>('[title]')
    expect(chip?.title).toBe(NPUB)
    expect(chip?.textContent?.startsWith('@')).toBe(true)
    // The whole point: react-markdown blanks an unknown scheme, and the
    // mention then arrives as a plain link showing all 63 characters.
    expect(page.querySelector('a')).toBeNull()
    expect(page.textContent).not.toContain(NPUB)
  })

  it('marks its tables so that an empty cell still gets a line box', () => {
    const page = render('| a | b |\n| --- | --- |\n|  |  |')
    // src/index.css is what gives the line box: a cell with nothing in it has
    // none, so an empty row would come out a line shorter than the header.
    expect(page.querySelector('table')?.classList.contains('page-table')).toBe(true)
  })
  it('draws an image at the width the editor wrote into its URL', () => {
    const page = render('![logo](https://example.com/logo.svg#width=320)')
    // What is made smaller in the editor is smaller on the page; `max-w-full`
    // still caps it, and the fragment is stripped from the request.
    expect(page.querySelector('img')?.style.width).toBe('320px')
  })

  it('leaves an image with no width in its URL at its own size', () => {
    const page = render('![logo](https://example.com/logo.svg)')
    expect(page.querySelector('img')?.style.width).toBe('')
  })

  it('draws a written nostr link as a chip as well', () => {
    const page = render(`see [Alice](nostr:${NPUB}) now`)
    expect(page.querySelector<HTMLElement>('[title]')?.title).toBe(NPUB)
    expect(page.querySelector('a')).toBeNull()
  })

  it('leaves an ordinary link alone and still drops an unsafe scheme', () => {
    const page = render('[docs](https://example.com) and [x](javascript:alert(1))')
    const links = [...page.querySelectorAll('a')]
    // the sanitiser drops the attribute outright — `nostr:` is let through
    // one step earlier, it is not an exception to this
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com', null])
  })

  it('draws a single empty line the way the editor does', () => {
    // The reported case. The writer typed one line between the two, so the page
    // shows one line — 17px over 1.75 — rather than letting the paragraph
    // margin stand in for it.
    const page = render('hallihallo\n\nneue zeile')
    const spacers = [...page.querySelectorAll('div[aria-hidden]')]
    expect(spacers.map((s) => (s as HTMLElement).style.height)).toEqual(['calc(29.75px)'])
    expect(spacers[0].nextElementSibling?.textContent).toBe('neue zeile')
  })

  it('keeps a longer run of empty lines at its own height', () => {
    const page = render('Para A\n\n\n\nPara B\n\nPara C\n\n\n')
    const spacers = [...page.querySelectorAll('div[aria-hidden]')]
    // Three lines before B (89.25px), one before C (29.75px), none at the end:
    // every empty line the writer typed is a line here too.
    expect(spacers.map((s) => (s as HTMLElement).style.height)).toEqual(['calc(89.25px)', 'calc(29.75px)'])
    expect(spacers[0].nextElementSibling?.textContent).toBe('Para B')
    expect(spacers[1].nextElementSibling?.textContent).toBe('Para C')
  })

  it('does not let an invisible "empty" line merge two paragraphs', () => {
    // U+00A0 — Option-Space. CommonMark counts it as text and collapses the
    // line break, so without normalising it the page would read `a b` while the
    // editor draws an empty line.
    const page = render('a\n\u00a0\nb')
    expect([...page.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['a', 'b'])
    const spacers = [...page.querySelectorAll('div[aria-hidden]')]
    expect(spacers.map((s) => (s as HTMLElement).style.height)).toEqual(['calc(29.75px)'])
  })

  it('draws a task as a checkbox, ticked or not', () => {
    const page = render('- [ ] one\n- [x] two')
    const boxes = [...page.querySelectorAll('input')]
    expect(boxes).toHaveLength(2)
    expect(boxes.map((b) => b.checked)).toEqual([false, true])
    // no bullet in front of the box — the box is the item's marker
    expect(page.querySelector('li')?.className).toContain('list-none')
  })

  it('prints brackets that are not a link, the way the editor shows them', () => {
    const page = render('a [b] c')
    expect(page.querySelector('a')).toBeNull()
    expect(page.querySelector('p')?.textContent).toBe('a [b] c')
  })

  it('makes a heading from a #', () => {
    expect(render('# Title').querySelector('h1')?.textContent).toBe('Title')
  })

  it('gives a nested list its own bullet shape, the way the editor does', () => {
    const page = render('- outer\n  - inner\n    - deep')
    const lists = [...page.querySelectorAll('ul')]
    expect(lists).toHaveLength(3)
    expect(lists[0].className).toContain('list-disc')
    // the nested levels are selected from the outermost list, so a level keeps
    // its shape however deep the tree already is
    expect(lists[0].className).toContain('[&_ul]:list-[circle]')
    expect(lists[0].className).toContain('[&_ul_ul]:list-[square]')
  })
})
