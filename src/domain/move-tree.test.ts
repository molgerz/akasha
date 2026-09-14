import { describe, expect, it } from 'vitest'
import { buildPages, buildTree, flattenTree, orderKeyOf } from './pages'
import { planMove, siblingsOf } from './move-tree'
import type { MoveDirection } from './move-tree'
import type { Page } from './pages'
import type { Revision } from './revision'

function rev(partial: Partial<Revision> & { id: string }): Revision {
  return {
    author: 'alice',
    createdAt: 1000,
    group: 'engineering',
    slug: partial.id,
    title: partial.id,
    parentSlug: null,
    order: null,
    parentRevs: [],
    summary: null,
    content: '',
    ...partial,
  }
}

/** A tree from `slug:parent` pairs, with each page's title as its own slug. */
function tree(...spec: [slug: string, parent: string | null][]): Page[] {
  return buildPages(spec.map(([slug, parent]) => rev({ id: slug, parentSlug: parent })))
}

/**
 * The move applied, as `buildPages` would hand the result back.
 *
 * The re-sort is the point, not bookkeeping: `planMove` reads a level by
 * filtering an already globally sorted array, which is what `buildPages`
 * produces and what `space.pages` always is. A test that changed one key and
 * left the array where it was would be asking the function a question it never
 * gets in the app — and would answer the second move from the tree as it
 * looked before the first.
 */
function applyMove(pages: Page[], slug: string, direction: MoveDirection): Page[] {
  const move = planMove(pages, slug, direction)
  if (!move) throw new Error(`${direction} was not available for ${slug}`)
  return pages
    .map((page) =>
      page.slug === slug ? { ...page, parentSlug: move.parentSlug, order: move.order } : page,
    )
    .sort((a, b) => {
      const left = orderKeyOf(a)
      const right = orderKeyOf(b)
      if (left !== right) return left < right ? -1 : 1
      return a.slug < b.slug ? -1 : 1
    })
}

/**
 * The tree somebody would see after the move, indented — an order key is not
 * what anybody is checking, the row it puts the page on is.
 */
function after(pages: Page[], slug: string, direction: MoveDirection): string[] {
  return flattenTree(buildTree(applyMove(pages, slug, direction))).map(
    (node) => `${'  '.repeat(node.depth)}${node.slug}`,
  )
}

const FLAT = tree(['a', null], ['b', null], ['c', null], ['d', null])

describe('siblingsOf', () => {
  it('keeps the level in the order the tree draws it', () => {
    expect(siblingsOf(FLAT, null).map((page) => page.slug)).toEqual(['a', 'b', 'c', 'd'])
    const nested = tree(['a', null], ['x', 'a'], ['y', 'a'])
    expect(siblingsOf(nested, 'a').map((page) => page.slug)).toEqual(['x', 'y'])
  })
})

describe('planMove — up and down', () => {
  it('swaps with the row above, and with the row below', () => {
    expect(after(FLAT, 'c', 'up')).toEqual(['a', 'c', 'b', 'd'])
    expect(after(FLAT, 'b', 'down')).toEqual(['a', 'c', 'b', 'd'])
  })

  it('reaches the first and the last position, not just the middle', () => {
    expect(after(FLAT, 'b', 'up')).toEqual(['b', 'a', 'c', 'd'])
    expect(after(FLAT, 'c', 'down')).toEqual(['a', 'b', 'd', 'c'])
  })

  it('is a round trip: up and back down leaves the order it found', () => {
    expect(after(applyMove(FLAT, 'c', 'up'), 'c', 'down')).toEqual(['a', 'b', 'c', 'd'])
    expect(after(applyMove(FLAT, 'b', 'down'), 'b', 'up')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('has nowhere to go at the ends of a level', () => {
    expect(planMove(FLAT, 'a', 'up')).toBeNull()
    expect(planMove(FLAT, 'd', 'down')).toBeNull()
  })

  it('counts siblings, not rows: a subtree in between is stepped over whole', () => {
    const nested = tree(['a', null], ['b', null], ['deep', 'b'], ['c', null])
    // `a` moving down passes `b` and everything hanging under it in one step
    expect(after(nested, 'a', 'down')).toEqual(['b', '  deep', 'a', 'c'])
  })

  it('stays where it is when the level holds only one page', () => {
    const only = tree(['a', null], ['x', 'a'])
    expect(planMove(only, 'x', 'up')).toBeNull()
    expect(planMove(only, 'x', 'down')).toBeNull()
  })
})

describe('planMove — in and out', () => {
  it('files the page under the sibling above it', () => {
    expect(after(FLAT, 'b', 'in')).toEqual(['a', '  b', 'c', 'd'])
  })

  it('writes no key of its own — the new level sorts it by its title', () => {
    // The same answer dropping the page onto that row with a mouse gives, so
    // the tree does not depend on which input device moved the page.
    const nested = tree(['a', null], ['x', 'a'], ['y', 'a'], ['b', null])
    expect(planMove(nested, 'b', 'in')).toEqual({ parentSlug: 'a', order: null })
    expect(after(nested, 'b', 'in')).toEqual(['a', '  b', '  x', '  y'])
  })

  it('has no sibling above it to go in under', () => {
    expect(planMove(FLAT, 'a', 'in')).toBeNull()
  })

  it('puts the page directly behind its parent, not at the end of that level', () => {
    const nested = tree(['a', null], ['x', 'a'], ['b', null], ['c', null])
    expect(after(nested, 'x', 'out')).toEqual(['a', 'x', 'b', 'c'])
  })

  it('keeps the page ahead of its parent-level neighbour it was never behind', () => {
    const nested = tree(['a', null], ['x', 'a'], ['y', 'a'], ['b', null])
    // both children come out one after the other and stay in their order
    expect(after(applyMove(nested, 'x', 'out'), 'y', 'out')).toEqual(['a', 'y', 'x', 'b'])
  })

  it('cannot come out of the top level', () => {
    expect(planMove(FLAT, 'a', 'out')).toBeNull()
  })

  it('takes the page and its own subtree along, in and out', () => {
    const nested = tree(['a', null], ['b', null], ['deep', 'b'], ['deeper', 'deep'])
    expect(after(nested, 'b', 'in')).toEqual(['a', '  b', '    deep', '      deeper'])
  })

  it('answers null for a slug the space does not have', () => {
    expect(planMove(FLAT, 'nope', 'up')).toBeNull()
  })
})
