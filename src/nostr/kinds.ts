/**
 * The only place in the code that holds Nostr kind numbers and tag names.
 * Components import from here — no magic numbers in the UI.
 * The reasoning behind them: docs/02-data-model-events.md
 */

export const KINDS = {
  /** NIP-01: profile metadata (display name, avatar) for bylines */
  PROFILE: 0,
  /** NIP-09: deletion request (a plea, not a guarantee) */
  DELETION_REQUEST: 5,
  /** NIP-42: Relay-AUTH */
  CLIENT_AUTH: 22242,
  /** Blossom BUD-01: authorises a file upload; not a relay event */
  BLOSSOM_AUTH: 24242,

  /** NIP-22: comment on a page */
  COMMENT: 1111,

  /**
   * Ephemeral (20000-29999), not stored by relays. Only used to answer "may I
   * write here?" without leaving traces.
   */
  DIAGNOSTIC_PING: 20817,

  /** Our own kind: an immutable page revision. The actual content. */
  PAGE_REVISION: 1818,
  /**
   * Our own kind: where a page hangs in the tree. Addressable, so moving a
   * page overwrites it instead of appending to the page's history.
   *
   * `31818` and deliberately not `30819`: NIP-54 defines that one as a wiki
   * redirect, and an addressable event is identified by `(kind, pubkey, d)`
   * alone — the same person's redirect for a slug and our placement for it
   * would be the same event and overwrite each other.
   * docs/02-data-model-events.md
   */
  PAGE_PLACEMENT: 31818,

  /** NIP-29, produced by the relay */
  GROUP_METADATA: 39000,
  GROUP_ADMINS: 39001,
  GROUP_MEMBERS: 39002,
  GROUP_ROLES: 39003,

  /** NIP-29, sent by users */
  GROUP_ADD_USER: 9000,
  GROUP_REMOVE_USER: 9001,
  GROUP_EDIT_METADATA: 9002,
  GROUP_DELETE_EVENT: 9005,
  GROUP_SET_ROLES: 9006,
  GROUP_CREATE: 9007,
  GROUP_DELETE: 9008,
  GROUP_CREATE_INVITE: 9009,
  GROUP_JOIN_REQUEST: 9021,
  GROUP_LEAVE_REQUEST: 9022,
} as const

export type Kind = (typeof KINDS)[keyof typeof KINDS]

/**
 * Every kind the app writes as page/comment content. Declared as a group's
 * `supported_kinds` on creation and on every metadata edit — a group missing
 * one of these has its writes rejected by a relay that enforces the list.
 * `src/routes/SpaceOverview.tsx` warns if `PAGE_REVISION`/`PAGE_PLACEMENT` are
 * missing from it.
 */
export const APP_CONTENT_KINDS = [KINDS.PAGE_REVISION, KINDS.COMMENT, KINDS.PAGE_PLACEMENT]

/** Tag names. Single-letter tags are relay-indexed and filterable. */
export const TAGS = {
  /** NIP-29 group id. The relay checks write permission against this. */
  GROUP: 'h',
  /** Normalised page slug (indexed, filterable via #d) */
  SLUG: 'd',
  /** Pubkey reference (members, admins) */
  PUBKEY: 'p',
  TITLE: 'title',
  /** Event id of the preceding revision. Two of them = a merge revision. */
  PARENT_REV: 'parent-rev',
  /** sha256 of the content; detects no-op saves and restores */
  CONTENT_HASH: 'content-hash',
  /** Slug of the parent page — the sidebar builds its tree from it */
  PAGE_PARENT: 'page-parent',
  /**
   * Sort key among the siblings of a level. Absent = ordered by title. The key
   * space is the same one titles normalise into, so a page can be filed
   * between two siblings without touching their events. src/domain/order.ts
   */
  PAGE_ORDER: 'page-order',
  /** Change note, the equivalent of a commit message */
  SUMMARY: 'summary',
  /** Restore: id of the revision whose content was taken over */
  RESTORE_OF: 'restore-of',
  /** NIP-09: event id a deletion request targets */
  DELETED_EVENT: 'e',
  /** NIP-09: kind of the events a deletion request targets */
  DELETED_KIND: 'k',
  /** Content type, always text/markdown here */
  MIME: 'm',
  /** NIP-31: fallback description for foreign clients */
  ALT: 'alt',
  /** NIP-29 timeline references, against relays withholding events */
  PREVIOUS: 'previous',
  /**
   * In 39000: the list of kinds the group accepts.
   * Underscore, not hyphen — with a hyphen the tag is ignored.
   */
  SUPPORTED_KINDS: 'supported_kinds',
} as const

export const MIME_MARKDOWN = 'text/markdown'

/** Our own cap on a slug, not the NIP's: a slug is also a URL segment. */
export const SLUG_MAX_LENGTH = 96

/**
 * Slug normalisation as NIP-54 prescribes it for the `d` tag of a wiki
 * article: lowercase, whitespace to `-`, punctuation and symbols removed,
 * numbers kept, and letters of every script kept as UTF-8. The same input has
 * to produce the same slug on every client, otherwise two users end up
 * pointing at two different pages.
 *
 * Combining marks are kept and the input is composed first, so "Ñoño"
 * becomes "ñoño" whether a tilde arrived precomposed or as its own code
 * point. Transliterating it away — which this function used to do for umlauts,
 * turning "Möbel" into "moebel" — produced a slug no other client would
 * arrive at.
 *
 * Two deviations from the NIP, both deliberate:
 * - Letters outside the basic multilingual plane are dropped: historic scripts,
 *   and the styled pseudo-fonts people paste from the web. Each is two UTF-16
 *   units, and the order keys in `src/domain/order.ts` do arithmetic on single
 *   units.
 * - The result is capped at `SLUG_MAX_LENGTH`.
 */
export function normalizeSlug(input: string): string {
  return (
    input
      .normalize('NFC')
      .toLowerCase()
      .replace(/\s+/g, '-')
      // Everything that is neither a letter, a number, a mark belonging to one,
      // nor our separator. Enclosing marks and variation selectors go as well,
      // so a stripped emoji cannot leave an invisible remainder behind.
      .replace(/[^\p{L}\p{N}\p{Mn}\p{Mc}-]|[\uFE00-\uFE0F]/gu, '')
      .replace(/[\u{10000}-\u{10FFFF}]/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, SLUG_MAX_LENGTH)
      // The cap can land right behind a hyphen.
      .replace(/-+$/, '')
  )
}
