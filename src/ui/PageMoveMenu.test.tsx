// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { buildPages } from '../domain/pages'
import type { Page } from '../domain/pages'
import type { Revision } from '../domain/revision'
import type { TreeMove } from '../domain/move-tree'
import { PageMoveMenu } from './PageMoveMenu'
import { moveEntries } from './move-page'

/**
 * The menu is the only way to move a page without a pointer that can drag, so
 * what is pinned here is that it is reachable at all: a real button, entries
 * that say which page they move past, and the ones that lead nowhere disabled
 * rather than silently failing. docs/06-ui-information-architecture.md
 */
function rev(partial: Partial<Revision> & { id: string }): Revision {
  return {
    author: 'alice',
    createdAt: 1000,
    group: 'engineering',
    slug: partial.id,
    title: partial.id.toUpperCase(),
    parentSlug: null,
    order: null,
    parentRevs: [],
    summary: null,
    content: '',
    ...partial,
  }
}

function tree(...spec: [slug: string, parent: string | null][]): Page[] {
  return buildPages(spec.map(([slug, parent]) => rev({ id: slug, parentSlug: parent })))
}

const PAGES = tree(['a', null], ['b', null], ['x', 'b'])

function render(page: Page, pages = PAGES, onMove: (move: TreeMove) => void = vi.fn()) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<PageMoveMenu page={page} pages={pages} busy={false} onMove={onMove} />)
  })
  return host
}

const pageOf = (slug: string, pages = PAGES) => pages.find((page) => page.slug === slug)!
const trigger = (host: HTMLElement) => host.querySelector('button')!
const items = (host: HTMLElement) => [...host.querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[]

describe('moveEntries', () => {
  it('names the page a move would land under or come out of', () => {
    const labels = moveEntries(PAGES, 'x').map((entry) => entry.label)
    expect(labels).toContain('Move out of B')

    const deep = tree(['a', null], ['b', null], ['c', null])
    expect(moveEntries(deep, 'c').map((entry) => entry.label)).toContain('Move under B')
  })

  it('keeps the generic label for a move that has nowhere to go', () => {
    const entries = moveEntries(PAGES, 'a')
    const up = entries.find((entry) => entry.direction === 'up')!
    expect(up.move).toBeNull()
    expect(up.label).toBe('Move up')
  })
})

describe('PageMoveMenu', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('is a button, not a gesture — the whole point of it', () => {
    const host = render(pageOf('b'))
    expect(trigger(host).getAttribute('aria-label')).toBe('Move B')
    expect(trigger(host).getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger(host).disabled).toBe(false)
  })

  it('opens on a click and offers the four steps', () => {
    const host = render(pageOf('b'))
    act(() => trigger(host).click())
    expect(items(host).map((item) => item.textContent)).toEqual([
      'Move up',
      'Move down',
      'Move under A',
      'Move out',
    ])
  })

  it('disables the steps that lead nowhere instead of failing on the click', () => {
    const host = render(pageOf('b'))
    act(() => trigger(host).click())
    const [up, down, moveIn, out] = items(host)
    expect(up!.disabled).toBe(false) // B can swap with A
    expect(down!.disabled).toBe(true) // nothing below it
    expect(moveIn!.disabled).toBe(false)
    expect(out!.disabled).toBe(true) // already at the top level
  })

  it('hands the destination up and closes again', () => {
    const onMove = vi.fn()
    const host = render(pageOf('x'), PAGES, onMove)
    act(() => trigger(host).click())
    const out = items(host).find((item) => item.textContent?.startsWith('Move out'))!
    act(() => out.click())
    expect(onMove).toHaveBeenCalledWith({ parentSlug: null, order: expect.any(String) })
    expect(items(host)).toHaveLength(0)
  })

  it('closes on Escape and gives the focus back to the trigger', () => {
    const host = render(pageOf('b'))
    act(() => trigger(host).click())
    act(() => {
      items(host)[0]!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(items(host)).toHaveLength(0)
    expect(document.activeElement).toBe(trigger(host))
  })

  it('walks the entries with the arrow keys, skipping the disabled ones', () => {
    const host = render(pageOf('b'))
    act(() => trigger(host).click())
    // opening already focused the first usable entry
    expect(document.activeElement).toBe(items(host)[0])
    act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      )
    })
    // "Move down" and "Move out" are disabled for B, so "Move under A" is next
    expect(document.activeElement?.textContent).toBe('Move under A')
  })

  it('has nothing to offer for the only page in a space, and says so', () => {
    const alone = tree(['a', null])
    const host = render(pageOf('a', alone), alone)
    expect(trigger(host).disabled).toBe(true)
    expect(trigger(host).title).toContain('nowhere to move it')
  })
})
