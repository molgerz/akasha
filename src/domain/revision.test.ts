import { describe, expect, it } from 'vitest'
import { parseRevision } from './revision'
import { KINDS } from '../nostr/kinds'
import type { Event } from 'nostr-tools'

function event(partial: Partial<Event>): Event {
  return {
    id: 'e1',
    pubkey: 'alice',
    created_at: 1000,
    kind: KINDS.PAGE_REVISION,
    tags: [
      ['h', 'engineering'],
      ['d', 'onboarding'],
    ],
    content: '# Onboarding',
    sig: 'sig',
    ...partial,
  } as Event
}

describe('parseRevision', () => {
  it('reads all tags', () => {
    const revision = parseRevision(
      event({
        tags: [
          ['h', 'engineering'],
          ['d', 'onboarding'],
          ['title', 'Onboarding'],
          ['page-parent', 'handbook'],
          ['summary', 'typo'],
          ['parent-rev', 'r1'],
          ['parent-rev', 'r2'],
        ],
      }),
      'engineering',
    )
    expect(revision).toMatchObject({
      slug: 'onboarding',
      title: 'Onboarding',
      parentSlug: 'handbook',
      summary: 'typo',
      parentRevs: ['r1', 'r2'],
    })
  })

  it('discards events from a foreign group', () => {
    // A relay could deliver foreign events — the h tag is checked, not trusted
    expect(parseRevision(event({}), 'other-group')).toBeNull()
  })

  it('discards the wrong kind', () => {
    expect(parseRevision(event({ kind: 1 }), 'engineering')).toBeNull()
  })

  it('discards events without a slug', () => {
    expect(parseRevision(event({ tags: [['h', 'engineering']] }), 'engineering')).toBeNull()
  })

  it('falls back to the slug as the title when no title tag exists', () => {
    expect(parseRevision(event({}), 'engineering')?.title).toBe('onboarding')
  })

  it('reads the archived flag from the tag being there, not from its value', () => {
    const archived = (tag: string[]) =>
      parseRevision(
        event({ tags: [['h', 'engineering'], ['d', 'onboarding'], tag] }),
        'engineering',
      )?.archived

    expect(archived(['archived', '1'])).toBe(true)
    // The value is reserved and deliberately not read — anything there means
    // the same thing, so a client writing something else still hides the page
    // rather than silently publishing a visible one. src/nostr/kinds.ts
    expect(archived(['archived', 'whatever'])).toBe(true)
    expect(archived(['archived', ''])).toBe(true)
    expect(archived(['summary', 'not archived'])).toBe(false)
  })

  it('is not archived when the tag is absent', () => {
    expect(parseRevision(event({}), 'engineering')?.archived).toBe(false)
  })
})
