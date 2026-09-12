import { describe, expect, it } from 'vitest'
import { KINDS, TAGS } from '../nostr/kinds'
import { parseDeletion } from './deletion'
import type { Event } from 'nostr-tools'

const TARGET = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

function event(partial: Partial<Event> & { tags: string[][] }): Event {
  return {
    id: 'd1',
    pubkey: 'alice',
    created_at: 1000,
    kind: KINDS.DELETION_REQUEST,
    content: '',
    sig: 'sig',
    ...partial,
  } as Event
}

describe('parseDeletion', () => {
  it('reads the target ids from the e tags', () => {
    const deletion = parseDeletion(
      event({ tags: [[TAGS.GROUP, 'engineering'], [TAGS.DELETED_EVENT, TARGET]] }),
      'engineering',
    )
    expect(deletion).toEqual({
      id: 'd1',
      author: 'alice',
      createdAt: 1000,
      group: 'engineering',
      targets: [TARGET],
    })
  })

  it('keeps every target of a multi-event request', () => {
    const deletion = parseDeletion(
      event({ tags: [[TAGS.DELETED_EVENT, TARGET], [TAGS.DELETED_EVENT, OTHER]] }),
      'engineering',
    )
    expect(deletion?.targets).toEqual([TARGET, OTHER])
  })

  it('tolerates a request without an h tag', () => {
    const deletion = parseDeletion(
      event({
        tags: [
          [TAGS.DELETED_EVENT, TARGET],
          [TAGS.DELETED_KIND, String(KINDS.PAGE_REVISION)],
        ],
      }),
      'engineering',
    )
    expect(deletion?.targets).toEqual([TARGET])
    expect(deletion?.group).toBeNull()
  })

  it('rejects a request for another group', () => {
    expect(
      parseDeletion(
        event({ tags: [[TAGS.GROUP, 'other'], [TAGS.DELETED_EVENT, TARGET]] }),
        'engineering',
      ),
    ).toBeNull()
  })

  it('rejects a request that names another kind', () => {
    expect(
      parseDeletion(
        event({
          tags: [
            [TAGS.DELETED_EVENT, TARGET],
            [TAGS.DELETED_KIND, String(KINDS.COMMENT)],
          ],
        }),
        'engineering',
      ),
    ).toBeNull()
  })

  it('rejects the wrong event kind', () => {
    expect(
      parseDeletion(
        event({ kind: KINDS.PAGE_REVISION, tags: [[TAGS.DELETED_EVENT, TARGET]] }),
        'engineering',
      ),
    ).toBeNull()
  })

  it('rejects a request that names no target', () => {
    expect(parseDeletion(event({ tags: [[TAGS.GROUP, 'engineering']] }), 'engineering')).toBeNull()
  })
})
