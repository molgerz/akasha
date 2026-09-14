import { KINDS, TAGS } from '../nostr/kinds'
import type { Event } from 'nostr-tools'

/**
 * A page revision: an immutable, signed event. The equivalent of a Git commit —
 * authorship sits in `author` (npub), the ordering in `parentRevs`.
 * docs/05-versioning-history.md
 */
export type Revision = {
  id: string
  author: string
  createdAt: number
  /** group id from the h tag */
  group: string
  /** normalised slug from the d tag */
  slug: string
  title: string
  /** slug of the parent page, for the sidebar tree */
  parentSlug: string | null
  /** sort key among its siblings. null = ordered by title */
  order: string | null
  /** predecessor revisions. Empty = first revision, two = a merge */
  parentRevs: string[]
  summary: string | null
  content: string
  /**
   * This revision hides its page. Not a property of the page but of the
   * revision, so hiding is an ordinary, signed step in the chain that a later
   * revision undoes — and the history of a hidden page stays readable.
   * docs/05-versioning-history.md
   */
  tombstone: boolean
}

function firstTag(event: Event, name: string): string | null {
  const tag = event.tags.find((entry) => entry[0] === name)
  return tag && typeof tag[1] === 'string' && tag[1].length > 0 ? tag[1] : null
}

/**
 * Turns an event into a revision. Returns null when the event does not belong
 * to this group or required fields are missing — a relay could deliver foreign
 * events, so the h tag is checked here rather than trusted.
 * docs/09-security-privacy.md
 */
export function parseRevision(event: Event, expectedGroup: string): Revision | null {
  if (event.kind !== KINDS.PAGE_REVISION) return null
  const group = firstTag(event, TAGS.GROUP)
  const slug = firstTag(event, TAGS.SLUG)
  if (!group || group !== expectedGroup || !slug) return null

  return {
    id: event.id,
    author: event.pubkey,
    createdAt: event.created_at,
    group,
    slug,
    title: firstTag(event, TAGS.TITLE) ?? slug,
    parentSlug: firstTag(event, TAGS.PAGE_PARENT),
    order: firstTag(event, TAGS.PAGE_ORDER),
    parentRevs: event.tags
      .filter((tag) => tag[0] === TAGS.PARENT_REV && typeof tag[1] === 'string')
      .map((tag) => tag[1]),
    summary: firstTag(event, TAGS.SUMMARY),
    content: event.content,
    // Presence is the signal; the value is reserved. src/nostr/kinds.ts
    tombstone: event.tags.some((tag) => tag[0] === TAGS.TOMBSTONE),
  }
}
