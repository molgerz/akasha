import { useState } from 'react'
import { classifyRejection } from '../nostr/client'
import { publishRevision } from '../nostr/publish-page'
import { useSession } from '../session/session'
import type { Page } from '../domain/pages'

/**
 * Archiving a page, and bringing it back.
 *
 * Both are the same operation: publish a revision on top of the current head,
 * one carrying the archived tag and one not. Nothing is deleted, so there is
 * no asymmetry to model — "restore" is not a repair, it is the other value of
 * the same flag. docs/05-versioning-history.md
 *
 * The content is carried over unchanged. An archiving revision with an empty
 * body would be indistinguishable from somebody clearing the page, and it
 * would make restoring lossy: the text has to come back with the page.
 *
 * **The placement (`31818`) is deliberately left alone.** It has no effect
 * while the page is archived — a page that is not in the tree cannot be placed
 * anywhere — and deleting it would make a restore land the page at whatever
 * its title sorts to instead of where it was. The genuinely orphaned case, a
 * placement whose slug has no revisions at all, is a different problem and
 * belongs to CON-21. docs/02-data-model-events.md
 */
export type ArchivePage = {
  /** Publishes the archiving revision (or its undo). True when it landed. */
  setArchived: (page: Page, archived: boolean) => Promise<boolean>
  busy: boolean
  error: string | null
  setError: (message: string | null) => void
}

export function useArchivePage(relayUrl: string, groupId: string): ArchivePage {
  const { session, ensureSamePubkey } = useSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setArchived = async (page: Page, archived: boolean): Promise<boolean> => {
    if (session.status !== 'signed-in') {
      setError('Archiving a page signs an event — please sign in first.')
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
        summary: archived ? 'archived this page' : 'brought this page back',
        content: page.head.content,
        parentRevs: [page.head.id],
        archived,
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

  return { setArchived, busy, error, setError }
}

/**
 * What the confirmation has to say before a page is archived. Two sentences,
 * because nobody reads a paragraph they have to get past to click a button:
 * what changes, and that it is not a deletion. The rest — the history stays,
 * the link keeps working — is what "nothing is deleted" already means, and the
 * archive itself shows it.
 *
 * Returned in parts rather than as one string, so the dialog can set the title
 * as a heading and give the subpage warning a paragraph of its own — the shape
 * `window.confirm` could only approximate with blank lines.
 * src/ui/ConfirmDialog.tsx
 */
export type ArchiveConfirmation = {
  title: string
  body: string
  /** Only when the page has subpages, because they do not go with it. */
  subpages: string | null
}

export function archiveConfirmation(page: Page, subpages: number): ArchiveConfirmation {
  return {
    title: `Archive "${page.title}"?`,
    body: 'It leaves the tree and the search. Nothing is deleted — you can bring it back.',
    subpages:
      subpages > 0
        ? `Its ${subpages} subpage${subpages === 1 ? '' : 's'} will stay, and move up to the top level.`
        : null,
  }
}
