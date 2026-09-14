// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { buildPages } from '../domain/pages'
import type { Page } from '../domain/pages'
import type { Revision } from '../domain/revision'
import type { TreeMove } from '../domain/move-tree'
import { PageMoveMenu } from './PageMoveMenu'
import { moveEntries, moveTargets } from './move-page'

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

/**
 * Typing into a controlled input. Assigning `value` alone never reaches React:
 * it tracks the value through its own setter and reads an unchanged one as no
 * change, so the native setter has to be called before the event is fired.
 */
function typeInto(field: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
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

  it('opens on a click and offers the four steps, plus the long way', () => {
    const host = render(pageOf('b'))
    act(() => trigger(host).click())
    expect(items(host).map((item) => item.textContent)).toEqual([
      'Move up',
      'Move down',
      'Move under A',
      'Move out',
      'Move to…',
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

  it('offers every page it may land under, and the top level when it is nested', () => {
    const host = render(pageOf('x'))
    act(() => trigger(host).click())
    act(() => items(host).find((item) => item.textContent === 'Move to…')!.click())
    expect(items(host).map((item) => item.textContent)).toEqual(['Top level', 'A'])
  })

  it('files the page under the destination that was picked', () => {
    const onMove = vi.fn()
    const host = render(pageOf('x'), PAGES, onMove)
    act(() => trigger(host).click())
    act(() => items(host).find((item) => item.textContent === 'Move to…')!.click())
    act(() => items(host).find((item) => item.textContent === 'A')!.click())
    // a parent, not a position: the new level sorts it by title, exactly as a
    // drop onto that row would
    expect(onMove).toHaveBeenCalledWith({ parentSlug: 'a', order: null })
  })

  it('filters the destinations by name, and says so when none is left', () => {
    const host = render(pageOf('x'))
    act(() => trigger(host).click())
    act(() => items(host).find((item) => item.textContent === 'Move to…')!.click())
    act(() => typeInto(host.querySelector('input')!, 'zz'))
    expect(items(host)).toHaveLength(0)
    expect(host.textContent).toContain('no page matches')
  })

  it('closes the whole menu on Escape, not just the destination list', () => {
    const host = render(pageOf('x'))
    act(() => trigger(host).click())
    act(() => items(host).find((item) => item.textContent === 'Move to…')!.click())
    act(() => {
      host.querySelector('input')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(host.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger(host))
  })
})

describe('moveTargets', () => {
  it('leaves out the page itself, its own subtree and the parent it has', () => {
    const deep = tree(['a', null], ['b', null], ['x', 'b'], ['deep', 'x'])
    // for `b`: not itself, not x or deep (its subtree), and it has no parent
    expect(moveTargets(deep, 'b').map((target) => target.slug)).toEqual(['a'])
  })

  it('offers the top level only to a page that is not already there', () => {
    expect(moveTargets(PAGES, 'x')[0]).toMatchObject({ slug: null, title: 'Top level' })
    expect(moveTargets(PAGES, 'a').some((target) => target.slug === null)).toBe(false)
  })

  it('has nothing to offer when the space holds a single page', () => {
    const alone = tree(['a', null])
    expect(moveTargets(alone, 'a')).toEqual([])
  })
})
