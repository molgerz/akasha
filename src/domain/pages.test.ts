import { describe, expect, it } from 'vitest'
import {
  archivedPages,
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
    archived: false,
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

describe('an archived page', () => {
  const archived = (slug: string, parent: string | null = null) =>
    rev({ id: `${slug}-2`, slug, title: slug, parentSlug: parent, archived: true, createdAt: 2000, parentRevs: [`${slug}-1`] })
  const visible = (slug: string, parent: string | null = null) =>
    rev({ id: `${slug}-1`, slug, title: slug, parentSlug: parent })

  it('is archived by its head, so a later revision brings it back', () => {
    const gone = buildPages([visible('notes'), archived('notes')])
    expect(gone[0].archived).toBe(true)

    const back = buildPages([
      visible('notes'),
      archived('notes'),
      rev({ id: 'notes-3', slug: 'notes', title: 'notes', createdAt: 3000, parentRevs: ['notes-2'] }),
    ])
    expect(back[0].archived).toBe(false)
    // nothing was thrown away: the archiving revision is still part of the history
    expect(back[0].revisions).toHaveLength(3)
  })

  it('stays in `pages` — its history and its own URL still have to find it', () => {
    const pages = buildPages([visible('notes'), archived('notes')])
    expect(pages.map((page) => page.slug)).toEqual(['notes'])
  })

  it('is left out of the tree', () => {
    const pages = buildPages([visible('a'), visible('notes'), archived('notes')])
    expect(flattenTree(buildTree(pages)).map((node) => node.slug)).toEqual(['a'])
  })

  it('does not take its subpages with it — they come up to the top level', () => {
    // Hiding a page is a statement about that page. A subpage somebody else
    // wrote is not covered by it, and taking the branch off screen would
    // remove pages nobody asked to remove.
    const pages = buildPages([
      visible('handbook'),
      archived('handbook'),
      visible('onboarding', 'handbook'),
    ])
    const tree = buildTree(pages)
    expect(tree.map((node) => node.slug)).toEqual(['onboarding'])
    expect(tree[0].depth).toBe(0)
  })

  it('follows the newer leaf on a fork, the same revision the content follows', () => {
    const base = rev({ id: 'r1', slug: 'notes', title: 'notes' })
    const keep = rev({ id: 'keep', slug: 'notes', title: 'notes', createdAt: 2000, parentRevs: ['r1'] })
    const drop = rev({ id: 'drop', slug: 'notes', title: 'notes', createdAt: 3000, parentRevs: ['r1'], archived: true })
    const pages = buildPages([base, keep, drop])
    expect(pages[0].leaves).toHaveLength(2)
    expect(pages[0].head.id).toBe('drop')
    expect(pages[0].archived).toBe(true)
  })
})


/**
 * The archive listing. An archived page is out of the tree, the search and the
 * overview, which leaves its own URL as the only way back to it — so this list
 * is the only way back for anyone who does not still have that link.
 * src/routes/ArchiveView.tsx
 */
describe('archivedPages', () => {
  const archivedAt = (slug: string, at: number) =>
    rev({ id: `${slug}-2`, slug, title: slug, archived: true, createdAt: at, parentRevs: [`${slug}-1`] })
  const visible = (slug: string) => rev({ id: `${slug}-1`, slug, title: slug })

  it('lists only the archived pages', () => {
    const pages = buildPages([visible('notes'), visible('deploy'), archivedAt('deploy', 2000)])
    expect(archivedPages(pages).map((page) => page.slug)).toEqual(['deploy'])
  })

  it('puts the most recently archived first, not the alphabetically first', () => {
    // The page somebody archived a minute ago by mistake is the one they come
    // here for; a second index sorted by title would bury it.
    const pages = buildPages([
      visible('alpha'),
      archivedAt('alpha', 2000),
      visible('omega'),
      archivedAt('omega', 3000),
    ])
    expect(archivedPages(pages).map((page) => page.slug)).toEqual(['omega', 'alpha'])
  })

  it('orders two pages archived in the same second by slug, so every client agrees', () => {
    const pages = buildPages([
      visible('beta'),
      archivedAt('beta', 2000),
      visible('alpha'),
      archivedAt('alpha', 2000),
    ])
    expect(archivedPages(pages).map((page) => page.slug)).toEqual(['alpha', 'beta'])
  })

  it('drops a page again once a later revision brings it back', () => {
    const back = rev({ id: 'deploy-3', slug: 'deploy', title: 'deploy', createdAt: 3000, parentRevs: ['deploy-2'] })
    const pages = buildPages([visible('deploy'), archivedAt('deploy', 2000), back])
    expect(archivedPages(pages)).toEqual([])
  })
})
