import { KINDS, TAGS } from '../nostr/kinds'
import type { Event } from 'nostr-tools'

/**
 * A NIP-09 deletion request for one or more page revisions. It is a *request*,
 * not a guarantee: a relay may ignore it, and copies on other relays survive.
 * docs/09-security-privacy.md
 */
export type Deletion = {
  id: string
  author: string
  createdAt: number
  /** group id from the h tag */
  group: string
  /** event ids the request names */
  targets: string[]
}

function tagValues(event: Event, name: string): string[] {
  return event.tags
    .filter((tag) => tag[0] === name && typeof tag[1] === 'string' && tag[1].length > 0)
    .map((tag) => tag[1])
}

/**
 * Turns an event into a deletion request. Returns null for anything that is not
 * a kind 5 about page revisions in this group: a missing or foreign `h`, or a
 * `k` that names another kind, means the request is not ours to honour.
 *
 * The `h` tag is required even though NIP-09 does not define one, because it
 * is what makes a request readable back as the group's shared state: the
 * subscription asks for `#h`, so a request without it never reaches this app
 * in the first place, and only what we publish ourselves (which always carries
 * `h`) can arrive. The check is still made here rather than trusted from the
 * filter — a relay can deliver whatever it likes, and an event from another
 * group must not remove a revision in this one.
 * docs/09-security-privacy.md (Forged `h` tags)
 *
 * The author gate lives where both request and revision are known
 * (`SpaceStore`): a request only removes a revision the requester wrote.
 */
export function parseDeletion(event: Event, expectedGroup: string): Deletion | null {
  if (event.kind !== KINDS.DELETION_REQUEST) return null

  const group = tagValues(event, TAGS.GROUP)[0]
  if (!group || group !== expectedGroup) return null

  const kinds = tagValues(event, TAGS.DELETED_KIND)
  if (kinds.length > 0 && !kinds.includes(String(KINDS.PAGE_REVISION))) return null

  const targets = tagValues(event, TAGS.DELETED_EVENT)
  if (targets.length === 0) return null

  return {
    id: event.id,
    author: event.pubkey,
    createdAt: event.created_at,
    group,
    targets,
  }
}
