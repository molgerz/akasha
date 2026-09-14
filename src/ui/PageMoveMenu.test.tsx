// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { buildPages } from '../domain/pages'
import type { Page } from '../domain/pages'
import type { Revision } from '../domain/revision'
import type { TreeMove } from '../domain/move-tree'
import { planMove } from '../domain/move-tree'
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

/**
 * Every root is torn down again afterwards. An open menu of a root left
 * mounted keeps listening for the pointerdown that dismisses it, and its panel
 * lives in `document.body` rather than in the host — emptying the body under
 * it leaves React holding a node it can no longer remove.
 */
const mounted: Root[] = []

function render(
  page: Page,
  pages = PAGES,
  onMove: (move: TreeMove) => void = vi.fn(),
  busy = false,
) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => {
    root.render(<PageMoveMenu page={page} pages={pages} busy={busy} onMove={onMove} />)
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
/**
 * The open panel is portalled into `document.body` and is deliberately not
 * below the row any more (`PageMoveMenu.tsx`), so everything inside it is
 * looked for in the document rather than in the host the row was rendered
 * into.
 */
const panel = () => document.querySelector('[role="menu"],[role="dialog"]') as HTMLElement | null
const items = () => [...document.querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[]
const field = () => document.querySelector('input') as HTMLInputElement
const press = (target: Element, key: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

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

  afterEach(() => {
    act(() => {
      for (const root of mounted.splice(0)) root.unmount()
    })
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
    expect(items().map((item) => item.textContent)).toEqual([
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
    const [up, down, moveIn, out] = items()
    expect(up!.disabled).toBe(false) // B can swap with A
    expect(down!.disabled).toBe(true) // nothing below it
    expect(moveIn!.disabled).toBe(false)
    expect(out!.disabled).toBe(true) // already at the top level
  })

  it('hands the destination up and closes again', () => {
    const onMove = vi.fn()
    const host = render(pageOf('x'), PAGES, onMove)
    act(() => trigger(host).click())
    const out = items().find((item) => item.textContent?.startsWith('Move out'))!
    act(() => out.click())
    expect(onMove).toHaveBeenCalledWith({ parentSlug: null, order: expect.any(String) })
    expect(items()).toHaveLength(0)
  })

  it('hangs the open menu off the body, not off the row', () => {
    // The tree scrolls in an `overflow-y-auto` container and every row is a
    // drag source. Inside either, the panel is clipped at the bottom of the
    // bar and a press in it starts a drag — so it is portalled out.
    const host = render(pageOf('b'))
    act(() => trigger(host).click())
    expect(panel()!.parentElement).toBe(document.body)
    expect(host.contains(panel())).toBe(false)
  })

  it('hands up the step the domain planned, for each of the four', () => {
    const level = tree(['a', null], ['b', null], ['c', null])
    for (const [label, direction] of [
      ['Move up', 'up'],
      ['Move down', 'down'],
      ['Move under A', 'in'],
    ] as const) {
      const onMove = vi.fn()
      const host = render(pageOf('b', level), level, onMove)
      act(() => trigger(host).click())
      act(() => items().find((item) => item.textContent === label)!.click())
      expect(onMove).toHaveBeenCalledWith(planMove(level, 'b', direction))
      act(() => mounted.pop()!.unmount())
      host.remove()
    }
  })

  it('opens on ArrowDown, so the keyboard never has to guess at a click', () => {
    const host = render(pageOf('b'))
    act(() => press(trigger(host), 'ArrowDown'))
    expect(items()).not.toHaveLength(0)
    expect(document.activeElement).toBe(items()[0])
  })

  it('closes on Escape and gives the focus back to the trigger', () => {
    const host = render(pageOf('b'))
    act(() => trigger(host).click())
    act(() => {
      items()[0]!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(items()).toHaveLength(0)
    expect(document.activeElement).toBe(trigger(host))
  })

  it('walks the entries with the arrow keys, skipping the disabled ones', () => {
    const host = render(pageOf('b'))
    act(() => trigger(host).click())
    // opening already focused the first usable entry
    expect(document.activeElement).toBe(items()[0])
    act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      )
    })
    // "Move down" and "Move out" are disabled for B, so "Move under A" is next
    expect(document.activeElement?.textContent).toBe('Move under A')
  })

  it('reaches the last destination with ArrowUp out of the filter field', () => {
    // The field is not a menu entry, so "one step up from where I am" has no
    // meaning there — counting from index -1 stopped one short of the end.
    const host = render(pageOf('x'))
    act(() => trigger(host).click())
    act(() => items().find((item) => item.textContent === 'Move to…')!.click())
    expect(document.activeElement).toBe(field())
    act(() => press(field(), 'ArrowUp'))
    expect(document.activeElement).toBe(items()[items().length - 1])
  })

  it('keeps the focus when a click elsewhere closes it', () => {
    const host = render(pageOf('b'))
    act(() => trigger(host).click())
    const outside = document.body.appendChild(document.createElement('div'))
    act(() => {
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(items()).toHaveLength(0)
    // Not on <body>: the keyboard would otherwise start over at the top of
    // the page after every dismissed menu.
    expect(document.activeElement).toBe(trigger(host))
  })

  it('opens at the four steps again, with the filter it was left with cleared', () => {
    const host = render(pageOf('x'))
    act(() => trigger(host).click())
    act(() => items().find((item) => item.textContent === 'Move to…')!.click())
    act(() => typeInto(field(), 'zz'))
    act(() => trigger(host).click())
    act(() => trigger(host).click())
    expect(document.querySelector('input')).toBeNull()
    expect(items().map((item) => item.textContent)).toContain('Move to…')
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
    act(() => items().find((item) => item.textContent === 'Move to…')!.click())
    expect(items().map((item) => item.textContent)).toEqual(['Top level', 'A'])
  })

  it('files the page under the destination that was picked', () => {
    const onMove = vi.fn()
    const host = render(pageOf('x'), PAGES, onMove)
    act(() => trigger(host).click())
    act(() => items().find((item) => item.textContent === 'Move to…')!.click())
    act(() => items().find((item) => item.textContent === 'A')!.click())
    // a parent, not a position: the new level sorts it by title, exactly as a
    // drop onto that row would
    expect(onMove).toHaveBeenCalledWith({ parentSlug: 'a', order: null })
  })

  it('filters the destinations by name, and says so when none is left', () => {
    const host = render(pageOf('x'))
    act(() => trigger(host).click())
    act(() => items().find((item) => item.textContent === 'Move to…')!.click())
    act(() => typeInto(field(), 'zz'))
    expect(items()).toHaveLength(0)
    expect(panel()!.textContent).toContain('no page matches')
  })

  it('closes the whole menu on Escape, not just the destination list', () => {
    const host = render(pageOf('x'))
    act(() => trigger(host).click())
    act(() => items().find((item) => item.textContent === 'Move to…')!.click())
    act(() => {
      field().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(trigger(host))
  })

  it('shuts the trigger while a move of its own is still in flight', () => {
    // One signature per step, and the relay has not answered yet. A second
    // click would plan the next step against the tree as it still looks, so
    // the entry it offers is the one that has just been published.
    const host = render(pageOf('b'), PAGES, vi.fn(), true)
    expect(trigger(host).disabled).toBe(true)
    act(() => trigger(host).click())
    expect(panel()).toBeNull()
  })

  it('does not hang the filter field inside a role="menu"', () => {
    // `menu` admits menu items and nothing else, and a textbox in one is read
    // out by some screen readers and skipped by others. The panel around the
    // field is a dialog; the destinations below it are the menu.
    const host = render(pageOf('x'))
    act(() => trigger(host).click())
    act(() => items().find((item) => item.textContent === 'Move to…')!.click())
    const menu = document.querySelector('[role="menu"]')!
    expect(menu.querySelector('input')).toBeNull()
    expect(field().closest('[role="menu"]')).toBeNull()
    expect(field().closest('[role="dialog"]')).not.toBeNull()
  })
})

describe('moveTargets', () => {
  it('indents each destination by its depth in the tree', () => {
    const deep = tree(['a', null], ['b', null], ['x', 'b'], ['deep', 'x'])
    // `a` reads as a child of the top-level entry it is listed under, so the
    // list is a tree rather than a flat run of names: top level 0, the pages
    // below it one deeper than the node they hang from.
    expect(moveTargets(deep, 'deep')).toEqual([
      { slug: null, title: 'Top level', depth: 0 },
      { slug: 'a', title: 'A', depth: 1 },
      { slug: 'b', title: 'B', depth: 1 },
    ])
  })

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
