import { useState } from 'react'
import { classifyRejection } from '../nostr/client'
import { publishRevision } from '../nostr/publish-page'
import { useSession } from '../session/session'
import type { Page } from '../domain/pages'

/**
 * Hiding a page, and bringing it back.
 *
 * Both are the same operation: publish a revision on top of the current head,
 * one carrying the tombstone tag and one not. Nothing is deleted, so there is
 * no asymmetry to model — "restore" is not a repair, it is the other value of
 * the same flag. docs/05-versioning-history.md
 *
 * The content is carried over unchanged. A tombstone revision with an empty
 * body would be indistinguishable from somebody clearing the page, and it
 * would make restoring lossy: the text has to come back with the page.
 *
 * **The placement (`31818`) is deliberately left alone.** It has no effect
 * while the page is hidden — a page that is not in the tree cannot be placed
 * anywhere — and deleting it would make a restore land the page at whatever
 * its title sorts to instead of where it was. The genuinely orphaned case, a
 * placement whose slug has no revisions at all, is a different problem and
 * belongs to CON-21. docs/02-data-model-events.md
 */
export type HidePage = {
  /** Publishes the tombstone (or its removal). Returns true when it landed. */
  setHidden: (page: Page, hidden: boolean) => Promise<boolean>
  busy: boolean
  error: string | null
  setError: (message: string | null) => void
}

export function useHidePage(relayUrl: string, groupId: string): HidePage {
  const { session, ensureSamePubkey } = useSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setHidden = async (page: Page, hidden: boolean): Promise<boolean> => {
    if (session.status !== 'signed-in') {
      setError('Removing a page signs an event — please sign in first.')
      return false
    }
    setError(null)
    setBusy(true)
    try {
      const same = await ensureSamePubkey()
      if (!same.ok) {
        setError(same.reason)
        return false
      }
      const result = await publishRevision(session.signer, {
        relayUrl,
        groupId,
        slug: page.slug,
        title: page.title,
        // Where the page hangs travels with it, for the same reason a restore
        // carries it: this revision is about visibility, not about position.
        parentSlug: page.parentSlug,
        order: page.order,
        summary: hidden ? 'removed this page' : 'brought this page back',
        content: page.head.content,
        parentRevs: [page.head.id],
        tombstone: hidden,
      })
      if (result.ok) return true

      const kind = classifyRejection(result.reason)
      setError(
        kind === 'permission'
          ? `The relay does not allow you to write here: ${result.reason}`
          : `Not saved: ${result.reason}`,
      )
      return false
    } catch (err) {
      setError(err instanceof Error ? err.message : 'signing was cancelled')
      return false
    } finally {
      setBusy(false)
    }
  }

  return { setHidden, busy, error, setError }
}

/**
 * What the confirmation has to say before a page goes. Honest about the two
 * things that are easy to assume and wrong: the page is still there for anyone
 * holding its link, and its subpages do not go with it.
 */
export function hideConfirmation(page: Page, subpages: number): string {
  const children =
    subpages > 0
      ? `\n\nIts ${subpages} subpage${subpages === 1 ? '' : 's'} will stay — they move up to the top level rather than disappearing with it.`
      : ''
  return (
    `Remove "${page.title}" from this space?\n\n` +
    'It leaves the page tree, the search and the space overview. Nothing is deleted: ' +
    'the history stays complete, anyone holding the link still reads the page, and you ' +
    'can bring it back at any time.' +
    children
  )
}
