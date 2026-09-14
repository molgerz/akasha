import { describe, expect, it } from 'vitest'
import {
  buildPages,
  buildTree,
  canMoveUnder,
  descendantSlugs,
  findCommonAncestor,
  flattenTree,
} from './pages'
import { keyBetween } from './order'
import type { Revision } from './revision'

function rev(partial: Partial<Revision> & { id: string }): Revision {
  return {
    author: 'alice',
    createdAt: 1000,
    group: 'engineering',
    slug: 'page',
    title: 'Page',
    parentSlug: null,
    order: null,
    parentRevs: [],
    summary: null,
    content: '',
    tombstone: false,
    ...partial,
  }
}

describe('buildPages — head resolution', () => {
  it('takes the tip of a linear chain as the head', () => {
    const pages = buildPages([
      rev({ id: 'r1', createdAt: 100 }),
      rev({ id: 'r2', createdAt: 200, parentRevs: ['r1'] }),
      rev({ id: 'r3', createdAt: 300, parentRevs: ['r2'] }),
    ])
    expect(pages).toHaveLength(1)
    expect(pages[0].head.id).toBe('r3')
    expect(pages[0].leaves.map((leaf) => leaf.id)).toEqual(['r3'])
    expect(pages[0].revisions).toHaveLength(3)
  })

  it('detects a fork and keeps both leaves', () => {
    const pages = buildPages([
      rev({ id: 'r1', createdAt: 100 }),
      rev({ id: 'mine', createdAt: 200, parentRevs: ['r1'] }),
      rev({ id: 'theirs', createdAt: 250, parentRevs: ['r1'] }),
    ])
    expect(pages[0].leaves.map((leaf) => leaf.id).sort()).toEqual(['mine', 'theirs'])
    // the newest leaf is displayed, but the fork is not hidden
    expect(pages[0].head.id).toBe('theirs')
  })

  it('breaks timestamp ties deterministically by id', () => {
    const a = buildPages([
      rev({ id: 'bbb', createdAt: 100 }),
      rev({ id: 'aaa', createdAt: 100 }),
    ])
    const b = buildPages([
      rev({ id: 'aaa', createdAt: 100 }),
      rev({ id: 'bbb', createdAt: 100 }),
    ])
    expect(a[0].head.id).toBe(b[0].head.id)
    expect(a[0].head.id).toBe('aaa')
  })

  it('brings a merge revision with two parents back to a single leaf', () => {
    const pages = buildPages([
      rev({ id: 'r1', createdAt: 100 }),
      rev({ id: 'mine', createdAt: 200, parentRevs: ['r1'] }),
      rev({ id: 'theirs', createdAt: 250, parentRevs: ['r1'] }),
      rev({ id: 'merge', createdAt: 300, parentRevs: ['mine', 'theirs'] }),
    ])
    expect(pages[0].leaves.map((leaf) => leaf.id)).toEqual(['merge'])
    expect(pages[0].head.id).toBe('merge')
  })

  it('separates pages by slug and takes title and parent from the head', () => {
    const pages = buildPages([
      rev({ id: 'h1', slug: 'handbook', title: 'Handbook' }),
      rev({ id: 'o1', slug: 'onboarding', title: 'Old', parentSlug: null, createdAt: 100 }),
      rev({
        id: 'o2',
        slug: 'onboarding',
        title: 'Onboarding',
        parentSlug: 'handbook',
        createdAt: 200,
        parentRevs: ['o1'],
      }),
    ])
    const onboarding = pages.find((page) => page.slug === 'onboarding')
    expect(onboarding?.title).toBe('Onboarding')
    expect(onboarding?.parentSlug).toBe('handbook')
    expect(pages).toHaveLength(2)
  })
})

describe('buildPages — revisions removed by a NIP-09 request', () => {
  it('moves the head back to the parent when the head was removed', () => {
    const pages = buildPages(
      [
        rev({ id: 'r1', createdAt: 100 }),
        rev({ id: 'r2', createdAt: 200, parentRevs: ['r1'] }),
        rev({ id: 'r3', createdAt: 300, parentRevs: ['r2'] }),
      ],
      new Map(),
      new Set(['r3']),
    )
    expect(pages[0].head.id).toBe('r2')
    expect(pages[0].revisions.map((r) => r.id)).toEqual(['r2', 'r1'])
    expect(pages[0].leaves.map((r) => r.id)).toEqual(['r2'])
  })

  // The chain must not tear: r3 keeps pointing at r1 after r2 is skipped,
  // instead of becoming an orphan that blame can no longer walk.
  it('does not tear the chain when a middle revision was removed', () => {
    const pages = buildPages(
      [
        rev({ id: 'r1', createdAt: 100 }),
        rev({ id: 'r2', createdAt: 200, parentRevs: ['r1'] }),
        rev({ id: 'r3', createdAt: 300, parentRevs: ['r2'] }),
      ],
      new Map(),
      new Set(['r2']),
    )
    expect(pages[0].head.id).toBe('r3')
    expect(pages[0].revisions.map((r) => r.id)).toEqual(['r3', 'r1'])
    expect(pages[0].revisions[0].parentRevs).toEqual(['r1'])
    expect(pages[0].leaves.map((r) => r.id)).toEqual(['r3'])
  })

  // Fails without collecting parent references over *all* revisions: r1 would
  // look like a leaf again because only its removed child pointed at it.
  it('does not mistake the removed revision’s parent for a leaf', () => {
    const pages = buildPages(
      [
        rev({ id: 'r1', createdAt: 100 }),
        rev({ id: 'r2', createdAt: 200, parentRevs: ['r1'] }),
        rev({ id: 'r3', createdAt: 300, parentRevs: ['r2'] }),
      ],
      new Map(),
      new Set(['r2']),
    )
    expect(pages[0].leaves.map((r) => r.id)).toEqual(['r3'])
  })

  it('bridges two consecutive removals to the first surviving ancestor', () => {
    const pages = buildPages(
      [
        rev({ id: 'r1', createdAt: 100 }),
        rev({ id: 'r2', createdAt: 200, parentRevs: ['r1'] }),
        rev({ id: 'r3', createdAt: 300, parentRevs: ['r2'] }),
        rev({ id: 'r4', createdAt: 400, parentRevs: ['r3'] }),
      ],
      new Map(),
      new Set(['r2', 'r3']),
    )
    expect(pages[0].head.id).toBe('r4')
    expect(pages[0].revisions[0].parentRevs).toEqual(['r1'])
    expect(pages[0].leaves.map((r) => r.id)).toEqual(['r4'])
  })

  it('keeps a merge a single leaf when one parent was removed', () => {
    const pages = buildPages(
      [
        rev({ id: 'r1', createdAt: 100 }),
        rev({ id: 'mine', createdAt: 200, parentRevs: ['r1'] }),
        rev({ id: 'theirs', createdAt: 250, parentRevs: ['r1'] }),
        rev({ id: 'merge', createdAt: 300, parentRevs: ['mine', 'theirs'] }),
      ],
      new Map(),
      new Set(['mine']),
    )
    expect(pages[0].head.id).toBe('merge')
    // The removed first parent bridged to r1; the surviving parent stays.
    expect(pages[0].revisions[0].parentRevs).toEqual(['r1', 'theirs'])
    expect(pages[0].leaves.map((r) => r.id)).toEqual(['merge'])
  })

  it('drops a page once its only revision was removed', () => {
    expect(buildPages([rev({ id: 'r1' })], new Map(), new Set(['r1']))).toEqual([])
  })

  it('terminates on a parent cycle between removed revisions', () => {
    const pages = buildPages(
      [
        rev({ id: 'a', createdAt: 100, parentRevs: ['b'] }),
        rev({ id: 'b', createdAt: 200, parentRevs: ['a'] }),
        rev({ id: 'c', createdAt: 300, parentRevs: ['a'] }),
      ],
      new Map(),
      new Set(['a', 'b']),
    )
    expect(pages[0].head.id).toBe('c')
    expect(pages[0].revisions[0].parentRevs).toEqual([])
    expect(pages[0].leaves.map((r) => r.id)).toEqual(['c'])
  })

  it('keeps a predecessor that was never loaded as a missing link', () => {
    const pages = buildPages(
      [
        rev({ id: 'r1', createdAt: 100, parentRevs: ['missing'] }),
        rev({ id: 'r2', createdAt: 200, parentRevs: ['r1'] }),
        rev({ id: 'r3', createdAt: 300, parentRevs: ['r2'] }),
      ],
      new Map(),
      new Set(['r2']),
    )
    // r3 bridges past the removed r2 to r1; the unknown link on r1 survives.
    expect(pages[0].revisions.find((r) => r.id === 'r1')?.parentRevs).toEqual(['missing'])
    expect(pages[0].revisions.find((r) => r.id === 'r3')?.parentRevs).toEqual(['r1'])
  })

  it('leaves revisions and parents untouched when nothing was removed', () => {
    const revisions = [
      rev({ id: 'r1', createdAt: 100 }),
      rev({ id: 'r2', createdAt: 200, parentRevs: ['r1'] }),
    ]
    const pages = buildPages(revisions, new Map(), new Set())
    expect(pages[0].revisions[0]).toBe(revisions[1])
  })
})

describe('buildTree', () => {
  it('nests children under their parent page and counts the depth', () => {
    const pages = buildPages([
      rev({ id: 'h', slug: 'handbook', title: 'Handbook' }),
      rev({ id: 'o', slug: 'onboarding', title: 'Onboarding', parentSlug: 'handbook' }),
      rev({ id: 'z', slug: 'access', title: 'Access', parentSlug: 'onboarding' }),
    ])
    const tree = buildTree(pages)
    expect(tree.map((node) => node.slug)).toEqual(['handbook'])
    const flat = flattenTree(tree)
    expect(flat.map((node) => [node.slug, node.depth])).toEqual([
      ['handbook', 0],
      ['onboarding', 1],
      ['access', 2],
    ])
  })

  it('puts pages with an unknown parent at the top instead of hiding them', () => {
    const pages = buildPages([rev({ id: 'x', slug: 'orphan', parentSlug: 'nonexistent' })])
    expect(buildTree(pages).map((node) => node.slug)).toEqual(['orphan'])
  })

  it('survives a page that names itself as its parent', () => {
    const pages = buildPages([rev({ id: 'x', slug: 'itself', parentSlug: 'itself' })])
    const tree = buildTree(pages)
    expect(tree.map((node) => node.slug)).toEqual(['itself'])
    expect(flattenTree(tree)).toHaveLength(1)
  })
})

describe('findCommonAncestor', () => {
  it('finds the root of two branches', () => {
    const r1 = rev({ id: 'r1' })
    const mine = rev({ id: 'mine', parentRevs: ['r1'] })
    const theirs = rev({ id: 'theirs', parentRevs: ['r1'] })
    expect(findCommonAncestor([r1, mine, theirs], mine, theirs)?.id).toBe('r1')
  })

  it('finds the most recent common ancestor, not the root', () => {
    const r1 = rev({ id: 'r1' })
    const r2 = rev({ id: 'r2', parentRevs: ['r1'] })
    const mine = rev({ id: 'mine', parentRevs: ['r2'] })
    const theirs = rev({ id: 'theirs', parentRevs: ['r2'] })
    expect(findCommonAncestor([r1, r2, mine, theirs], mine, theirs)?.id).toBe('r2')
  })

  it('returns null when there are two independent roots', () => {
    const a = rev({ id: 'a' })
    const b = rev({ id: 'b' })
    expect(findCommonAncestor([a, b], a, b)).toBeNull()
  })

  it('recognises a revision that is itself an ancestor of the other', () => {
    const r1 = rev({ id: 'r1' })
    const r2 = rev({ id: 'r2', parentRevs: ['r1'] })
    expect(findCommonAncestor([r1, r2], r2, r1)?.id).toBe('r1')
  })
})

describe('moving a page', () => {
  const pages = buildPages([
    rev({ id: 'h', slug: 'handbook', title: 'Handbook' }),
    rev({ id: 'o', slug: 'onboarding', title: 'Onboarding', parentSlug: 'handbook' }),
    rev({ id: 'z', slug: 'access', title: 'Access', parentSlug: 'onboarding' }),
    rev({ id: 'p', slug: 'minutes', title: 'Minutes' }),
  ])

  it('counts a page and its whole subtree as its own descendants', () => {
    expect([...descendantSlugs(pages, 'handbook')].sort()).toEqual([
      'access',
      'handbook',
      'onboarding',
    ])
    expect([...descendantSlugs(pages, 'access')]).toEqual(['access'])
  })

  it('refuses a move into its own subtree, and onto itself', () => {
    expect(canMoveUnder(pages, 'handbook', 'access')).toBe(false)
    expect(canMoveUnder(pages, 'handbook', 'handbook')).toBe(false)
    expect(canMoveUnder(pages, 'handbook', 'minutes')).toBe(true)
    // the top level is always allowed
    expect(canMoveUnder(pages, 'handbook', null)).toBe(true)
  })

  it('terminates on a cycle that is already in the data', () => {
    const cyclic = buildPages([
      rev({ id: 'a', slug: 'a', parentSlug: 'b' }),
      rev({ id: 'b', slug: 'b', parentSlug: 'a' }),
    ])
    expect([...descendantSlugs(cyclic, 'a')].sort()).toEqual(['a', 'b'])
  })
})

describe('sibling order', () => {
  it('sorts a level by its order key instead of by title', () => {
    const pages = buildPages([
      rev({ id: 'z', slug: 'zebra', title: 'Zebra', order: 'a' }),
      rev({ id: 'a', slug: 'apple', title: 'Apple', order: 'b' }),
    ])
    expect(pages.map((page) => page.slug)).toEqual(['zebra', 'apple'])
  })

  it('orders pages without a key by their title', () => {
    const pages = buildPages([
      rev({ id: 'z', slug: 'zebra', title: 'Zebra' }),
      rev({ id: 'a', slug: 'apple', title: 'Apple' }),
    ])
    expect(pages.map((page) => page.slug)).toEqual(['apple', 'zebra'])
  })

  it('drops a keyed page between two pages that have no key', () => {
    // What the sidebar does on a drop into the gap between the two: the key
    // is measured against their implicit keys, which are their titles.
    const order = keyBetween('handbook', 'onboarding')
    const pages = buildPages([
      rev({ id: 'h', slug: 'handbook', title: 'Handbook' }),
      rev({ id: 'o', slug: 'onboarding', title: 'Onboarding' }),
      rev({ id: 'n', slug: 'notes', title: 'Notes', order }),
    ])
    expect(pages.map((page) => page.slug)).toEqual(['handbook', 'notes', 'onboarding'])
  })

  it('applies the order inside the tree, not just to the flat list', () => {
    const pages = buildPages([
      rev({ id: 'h', slug: 'handbook', title: 'Handbook' }),
      rev({ id: 'a', slug: 'appendix', title: 'Appendix', parentSlug: 'handbook', order: 'z' }),
      rev({ id: 'b', slug: 'basics', title: 'Basics', parentSlug: 'handbook', order: 'a' }),
    ])
    const tree = buildTree(pages)
    expect(tree[0].children.map((node) => node.slug)).toEqual(['basics', 'appendix'])
  })

  it('breaks a tie between two identical keys by slug, on every client', () => {
    const first = buildPages([
      rev({ id: '1', slug: 'bravo', title: 'Same', order: 'm' }),
      rev({ id: '2', slug: 'alpha', title: 'Same', order: 'm' }),
    ])
    const second = buildPages([
      rev({ id: '2', slug: 'alpha', title: 'Same', order: 'm' }),
      rev({ id: '1', slug: 'bravo', title: 'Same', order: 'm' }),
    ])
    expect(first.map((page) => page.slug)).toEqual(['alpha', 'bravo'])
    expect(second.map((page) => page.slug)).toEqual(first.map((page) => page.slug))
  })
})

describe('a hidden page', () => {
  const hidden = (slug: string, parent: string | null = null) =>
    rev({ id: `${slug}-2`, slug, title: slug, parentSlug: parent, tombstone: true, createdAt: 2000, parentRevs: [`${slug}-1`] })
  const visible = (slug: string, parent: string | null = null) =>
    rev({ id: `${slug}-1`, slug, title: slug, parentSlug: parent })

  it('is hidden by its head, so a later revision brings it back', () => {
    const gone = buildPages([visible('notes'), hidden('notes')])
    expect(gone[0].hidden).toBe(true)

    const back = buildPages([
      visible('notes'),
      hidden('notes'),
      rev({ id: 'notes-3', slug: 'notes', title: 'notes', createdAt: 3000, parentRevs: ['notes-2'] }),
    ])
    expect(back[0].hidden).toBe(false)
    // nothing was thrown away: the tombstone is still part of the history
    expect(back[0].revisions).toHaveLength(3)
  })

  it('stays in `pages` — its history and its own URL still have to find it', () => {
    const pages = buildPages([visible('notes'), hidden('notes')])
    expect(pages.map((page) => page.slug)).toEqual(['notes'])
  })

  it('is left out of the tree', () => {
    const pages = buildPages([visible('a'), visible('notes'), hidden('notes')])
    expect(flattenTree(buildTree(pages)).map((node) => node.slug)).toEqual(['a'])
  })

  it('does not take its subpages with it — they come up to the top level', () => {
    // Hiding a page is a statement about that page. A subpage somebody else
    // wrote is not covered by it, and taking the branch off screen would
    // remove pages nobody asked to remove.
    const pages = buildPages([
      visible('handbook'),
      hidden('handbook'),
      visible('onboarding', 'handbook'),
    ])
    const tree = buildTree(pages)
    expect(tree.map((node) => node.slug)).toEqual(['onboarding'])
    expect(tree[0].depth).toBe(0)
  })

  it('follows the newer leaf on a fork, the same revision the content follows', () => {
    const base = rev({ id: 'r1', slug: 'notes', title: 'notes' })
    const keep = rev({ id: 'keep', slug: 'notes', title: 'notes', createdAt: 2000, parentRevs: ['r1'] })
    const drop = rev({ id: 'drop', slug: 'notes', title: 'notes', createdAt: 3000, parentRevs: ['r1'], tombstone: true })
    const pages = buildPages([base, keep, drop])
    expect(pages[0].leaves).toHaveLength(2)
    expect(pages[0].head.id).toBe('drop')
    expect(pages[0].hidden).toBe(true)
  })
})

