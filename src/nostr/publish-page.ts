import { verifyEvent } from 'nostr-tools'
import { client } from './client'
import type { PublishResult } from './client'
import { KINDS, MIME_MARKDOWN, TAGS } from './kinds'
import { collectMentions } from './mentions'
import type { Signer } from './signer'

export type RevisionInput = {
  relayUrl: string
  groupId: string
  slug: string
  title: string
  parentSlug: string | null
  /** sort key among its siblings. null = ordered by title */
  order: string | null
  summary: string | null
  content: string
  /** predecessor revisions: empty for a new page, two for a merge */
  parentRevs: string[]
  /** restore: event id of the revision whose content was taken over */
  restoreOf?: string
  /**
   * Archive the page: the revision carries the archived tag and the page
   * leaves the tree, the search and the navigation. Publishing a later
   * revision without it brings the page back, so this is a step in the chain
   * and not a deletion. docs/05-versioning-history.md
   */
  archived?: boolean
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Sign and publish a new revision. Every save is a new, immutable event —
 * nothing is overwritten.
 * docs/05-versioning-history.md
 */
export async function publishRevision(
  signer: Signer,
  input: RevisionInput,
): Promise<PublishResult> {
  const tags: string[][] = [
    [TAGS.GROUP, input.groupId],
    [TAGS.SLUG, input.slug],
    [TAGS.TITLE, input.title],
    [TAGS.MIME, MIME_MARKDOWN],
    [TAGS.CONTENT_HASH, await sha256Hex(input.content)],
    [
      TAGS.ALT,
      input.archived
        ? `Wiki page "${input.title}" was archived in space ${input.groupId}`
        : `Wiki page "${input.title}" in space ${input.groupId}`,
    ],
  ]
  if (input.parentSlug) tags.push([TAGS.PAGE_PARENT, input.parentSlug])
  // Absent rather than empty when there is none: the tree then falls back to
  // the title, and an empty tag would be a third state to reason about.
  if (input.order) tags.push([TAGS.PAGE_ORDER, input.order])
  if (input.summary) tags.push([TAGS.SUMMARY, input.summary])
  for (const parent of input.parentRevs) tags.push([TAGS.PARENT_REV, parent])
  // A restore deletes nothing: it creates a new revision with the old content
  // that points at its template. docs/05-versioning-history.md
  if (input.restoreOf) tags.push([TAGS.RESTORE_OF, input.restoreOf])
  // Presence is the signal; the value is reserved. src/nostr/kinds.ts
  if (input.archived) tags.push([TAGS.ARCHIVED, '1'])
  // NIP-27: everybody the text mentions gets a `p` tag, so the mention is
  // findable by the person mentioned and not only by whoever reads the page.
  // src/nostr/mentions.ts
  for (const pubkey of collectMentions(input.content)) tags.push([TAGS.PUBKEY, pubkey])

  const event = await signer.signEvent({
    kind: KINDS.PAGE_REVISION,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: input.content,
  })

  if (!verifyEvent(event)) {
    return { ok: false, reason: 'the event signature is invalid' }
  }

  return client.publish(input.relayUrl, event)
}
