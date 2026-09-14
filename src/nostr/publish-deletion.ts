import { verifyEvent } from 'nostr-tools'
import { client } from './client'
import type { PublishResult } from './client'
import { KINDS, TAGS } from './kinds'
import type { Signer } from './signer'

export type RevisionDeletionInput = {
  relayUrl: string
  groupId: string
  /** event id of the revision the author wants removed */
  revisionId: string
}

/**
 * NIP-09: ask the relay to remove the author's own revision. This is a request
 * and not a guarantee — a relay may keep the event, and copies on other relays
 * remain. The `e` tag names the revision and `k` its kind; the `h` tag
 * scopes the request to the group so it can be read back with the group's
 * filter and become shared state instead of local bookkeeping.
 * docs/05-versioning-history.md, docs/09-security-privacy.md
 */
export async function publishRevisionDeletion(
  signer: Signer,
  input: RevisionDeletionInput,
): Promise<PublishResult> {
  const event = await signer.signEvent({
    kind: KINDS.DELETION_REQUEST,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      [TAGS.GROUP, input.groupId],
      [TAGS.DELETED_EVENT, input.revisionId],
      [TAGS.DELETED_KIND, String(KINDS.PAGE_REVISION)],
      [TAGS.ALT, `Deletion request for a wiki revision in space ${input.groupId}`],
    ],
    content: '',
  })

  if (!verifyEvent(event)) {
    return { ok: false, reason: 'the event signature is invalid' }
  }

  return client.publish(input.relayUrl, event)
}
