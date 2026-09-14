import { describe, expect, it } from 'vitest'
import { buildPages } from './pages'
import { previewLevelOrder, sortLevelByTitle, sortableLevels } from './sort-level'
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
    tombstone: false,
    ...partial,
  }
}

/** `slug:parent:order` — order null means "sorted by its title". */
function tree(...spec: [string, string | null, string | null][]): Page[] {
  return buildPages(
    spec.map(([slug, parent, order]) =>
      rev({ id: slug, title: slug, parentSlug: parent, order }),
    ),
  )
}

describe('sortLevelByTitle', () => {
  it('clears the keys of a level that was dragged out of alphabetical order', () => {
    // `zulu` was dragged to the front and carries a key that says so
    const pages = tree(['alpha', null, null], ['zulu', null, 'a'])
    expect(sortLevelByTitle(pages, null)).toEqual([
      { slug: 'zulu', parentSlug: null, order: null },
    ])
  })

  it('touches only the pages that carry a key', () => {
    const pages = tree(['a', null, null], ['b', null, 'zz'], ['c', null, null])
    expect(sortLevelByTitle(pages, null).map((entry) => entry.slug)).toEqual(['b'])
  })

  it('has nothing to do for a level that is already ordered by its titles', () => {
    const pages = tree(['a', null, null], ['b', null, null])
    expect(sortLevelByTitle(pages, null)).toEqual([])
  })

  it('sorts one level, not the whole space', () => {
    const pages = tree(
      ['handbook', null, 'zz'],
      ['onboarding', 'handbook', 'zz'],
      ['payroll', 'handbook', 'aa'],
    )
    // the returned order is publish order and carries no meaning of its own
    expect(sortLevelByTitle(pages, 'handbook').map((entry) => entry.slug).sort()).toEqual([
      'onboarding',
      'payroll',
    ])
    expect(sortLevelByTitle(pages, null).map((entry) => entry.slug)).toEqual(['handbook'])
  })

  it('keeps every page where it hangs — this is about position, not parentage', () => {
    const pages = tree(['handbook', null, null], ['onboarding', 'handbook', 'zz'])
    expect(sortLevelByTitle(pages, 'handbook')[0]).toMatchObject({
      slug: 'onboarding',
      parentSlug: 'handbook',
    })
  })

  it('includes a hidden page, so it does not come back carrying a stale key', () => {
    const pages = buildPages([
      rev({ id: 'a' }),
      rev({ id: 'gone', title: 'gone', order: 'zz' }),
      rev({ id: 'gone-2', slug: 'gone', title: 'gone', order: 'zz', createdAt: 2000, parentRevs: ['gone'], tombstone: true }),
    ])
    expect(pages.find((page) => page.slug === 'gone')?.hidden).toBe(true)
    expect(sortLevelByTitle(pages, null).map((entry) => entry.slug)).toEqual(['gone'])
  })

  it('sorts the child of a hidden parent with the top level, where it is drawn', () => {
    // `buildTree` leaves a hidden page out of its node map before it hangs
    // anything, so its children come up to the top level — pinned by
    // `pages.test.ts`, "does not take its subpages with it". Grouping by "the
    // parent exists" instead would file the child under a level nobody sees,
    // and sorting the top level would quietly skip a page sitting in it.
    // Reachable by tombstoning any page that has subpages.
    const pages = buildPages([
      rev({ id: 'handbook' }),
      rev({
        id: 'handbook-2',
        slug: 'handbook',
        title: 'handbook',
        createdAt: 2000,
        parentRevs: ['handbook'],
        tombstone: true,
      }),
      rev({ id: 'onboarding', parentSlug: 'handbook', order: 'zz' }),
      rev({ id: 'alpha' }),
    ])
    expect(pages.find((page) => page.slug === 'handbook')?.hidden).toBe(true)

    expect(sortLevelByTitle(pages, null).map((entry) => entry.slug)).toEqual(['onboarding'])
    // …still without repairing the parentage on the way past
    expect(sortLevelByTitle(pages, null)[0].parentSlug).toBe('handbook')
    // and the hidden page is not offered as a level of its own, which would
    // put `onboarding` in two levels at once
    expect(sortableLevels(pages).map((level) => level.parentSlug)).toEqual([null])
    expect(sortableLevels(pages)[0]).toMatchObject({ pages: 3, keyed: 1 })
  })
})

describe('previewLevelOrder', () => {
  it('shows the level as it will look, by title', () => {
    const pages = tree(['zulu', null, 'a'], ['alpha', null, null], ['mike', null, null])
    expect(previewLevelOrder(pages, null).map((page) => page.slug)).toEqual([
      'alpha',
      'mike',
      'zulu',
    ])
  })
})

describe('sortableLevels', () => {
  it('offers the top level and every page that has children, in tree order', () => {
    const pages = tree(
      ['handbook', null, null],
      ['onboarding', 'handbook', null],
      ['deep', 'onboarding', null],
    )
    expect(sortableLevels(pages)).toMatchObject([
      { parentSlug: null, title: 'Top level', depth: 0 },
      { parentSlug: 'handbook', title: 'handbook', depth: 1 },
      { parentSlug: 'onboarding', title: 'onboarding', depth: 2 },
    ])
  })

  it('does not offer a leaf as a level', () => {
    const pages = tree(['a', null, null], ['b', null, null])
    expect(sortableLevels(pages).map((level) => level.parentSlug)).toEqual([null])
  })

  it('counts the level, and how much of it a sort would actually touch', () => {
    const pages = tree(['a', null, null], ['b', null, 'zz'], ['c', null, 'yy'])
    expect(sortableLevels(pages)[0]).toMatchObject({ pages: 3, keyed: 2 })
  })

  it('counts a page with a vanished parent into the top level, where it is drawn', () => {
    // `buildTree` hangs it at the top level. Grouping by the raw tag instead
    // would put it in a level nobody sees — and sorting the top level would
    // then quietly skip a page sitting in it.
    const pages = tree(['stray', 'vanished', 'zz'], ['alpha', null, null])
    expect(sortableLevels(pages).map((level) => level.parentSlug)).toEqual([null])
    expect(sortableLevels(pages)[0]).toMatchObject({ pages: 2, keyed: 1 })
    expect(sortLevelByTitle(pages, null).map((entry) => entry.slug)).toEqual(['stray'])
    // …without repairing its parentage on the way past
    expect(sortLevelByTitle(pages, null)[0].parentSlug).toBe('vanished')
  })

  it('survives a parent cycle in the data instead of hanging', () => {
    const pages = tree(['a', 'b', null], ['b', 'a', null])
    expect(() => sortableLevels(pages)).not.toThrow()
  })
})
