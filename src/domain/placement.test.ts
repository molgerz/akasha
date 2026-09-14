import { describe, expect, it } from 'vitest'
import { newerPlacement, parsePlacement } from './placement'
import { KINDS } from '../nostr/kinds'
import { buildPages, buildTree } from './pages'
import type { Placement } from './placement'
import type { Revision } from './revision'
import type { Event } from 'nostr-tools'

function event(partial: Partial<Event> & { tags: string[][] }): Event {
  return {
    id: 'e1',
    pubkey: 'alice',
    created_at: 1000,
    kind: KINDS.PAGE_PLACEMENT,
    sig: 'sig',
    content: '',
    ...partial,
  } as Event
}

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

function placement(partial: Partial<Placement> & { slug: string }): Placement {
  return {
    parentSlug: null,
    order: null,
    author: 'alice',
    createdAt: 1000,
    id: 'p1',
    ...partial,
  }
}

describe('parsePlacement', () => {
  it('reads parent and position from the tags', () => {
    const parsed = parsePlacement(
      event({
        tags: [
          ['h', 'engineering'],
          ['d', 'onboarding'],
          ['page-parent', 'handbook'],
          ['page-order', 'm'],
        ],
      }),
      'engineering',
    )
    expect(parsed).toMatchObject({ slug: 'onboarding', parentSlug: 'handbook', order: 'm' })
  })

  it('reads a placement at the top level without a position', () => {
    const parsed = parsePlacement(
      event({ tags: [['h', 'engineering'], ['d', 'handbook']] }),
      'engineering',
    )
    expect(parsed).toMatchObject({ slug: 'handbook', parentSlug: null, order: null })
  })

  it('rejects an event from a foreign group, whatever the relay says', () => {
    const foreign = event({ tags: [['h', 'marketing'], ['d', 'onboarding']] })
    expect(parsePlacement(foreign, 'engineering')).toBeNull()
  })

  it('rejects an event without a slug and a foreign kind', () => {
    expect(parsePlacement(event({ tags: [['h', 'engineering']] }), 'engineering')).toBeNull()
    expect(
      parsePlacement(
        event({ kind: 1818, tags: [['h', 'engineering'], ['d', 'onboarding']] }),
        'engineering',
      ),
    ).toBeNull()
  })
})

describe('newerPlacement', () => {
  it('takes the newer of two', () => {
    const older = placement({ slug: 'a', createdAt: 100, id: 'aaa' })
    const newer = placement({ slug: 'a', createdAt: 200, id: 'bbb' })
    expect(newerPlacement(older, newer).id).toBe('bbb')
    expect(newerPlacement(newer, older).id).toBe('bbb')
  })

  it('breaks a tie by id, so no two clients disagree', () => {
    const one = placement({ slug: 'a', createdAt: 100, id: 'aaa', author: 'alice' })
    const two = placement({ slug: 'a', createdAt: 100, id: 'bbb', author: 'bob' })
    expect(newerPlacement(one, two).id).toBe('aaa')
    expect(newerPlacement(two, one).id).toBe('aaa')
  })
})

describe('a placement against the revisions', () => {
  const revisions = [
    rev({ id: 'h', slug: 'handbook', title: 'Handbook' }),
    rev({ id: 'o', slug: 'onboarding', title: 'Onboarding', parentSlug: 'handbook' }),
    rev({ id: 'n', slug: 'notes', title: 'Notes' }),
  ]

  it('uses the revision tags for a page that has never been moved', () => {
    const pages = buildPages(revisions)
    expect(pages.find((page) => page.slug === 'onboarding')?.parentSlug).toBe('handbook')
  })

  it('overrides parent and position where a placement exists', () => {
    const pages = buildPages(
      revisions,
      new Map([['onboarding', placement({ slug: 'onboarding', parentSlug: 'notes', order: 'a' })]]),
    )
    const onboarding = pages.find((page) => page.slug === 'onboarding')
    expect(onboarding?.parentSlug).toBe('notes')
    expect(onboarding?.order).toBe('a')
    expect(buildTree(pages).find((node) => node.slug === 'notes')?.children[0].slug).toBe(
      'onboarding',
    )
  })

  it('lifts a page to the top level even though its revision names a parent', () => {
    // The whole point: the placement replaces both fields together, so a page
    // moved to the root does not keep the parent from its revision.
    const pages = buildPages(
      revisions,
      new Map([['onboarding', placement({ slug: 'onboarding', parentSlug: null })]]),
    )
    expect(buildTree(pages).map((node) => node.slug)).toContain('onboarding')
  })

  it('leaves the revision chain alone — a move is not an edit', () => {
    const pages = buildPages(
      revisions,
      new Map([['onboarding', placement({ slug: 'onboarding', parentSlug: 'notes' })]]),
    )
    const onboarding = pages.find((page) => page.slug === 'onboarding')
    expect(onboarding?.revisions).toHaveLength(1)
    expect(onboarding?.head.id).toBe('o')
  })
})
