import { useState } from 'react'
import { classifyRejection } from '../nostr/client'
import { publishPlacement } from '../nostr/publish-placement'
import { publishPlacementDeletion } from '../nostr/publish-deletion'
import { useSession } from '../session/session'
import {
  previewLevelOrder,
  sortLevelByTitle,
  sortableLevels,
} from '../domain/sort-level'
import type { Page } from '../domain/pages'
import type { Placement } from '../domain/placement'
import { Button, Callout, INPUT, SectionLabel } from './controls'

/**
 * The two things nobody can do from the tree itself, kept together because
 * they are the same kind of work: tidying up positions after the fact.
 *
 * **Sorting a whole level.** The order key lives per page, so until now a level
 * could only be sorted one dragged page at a time. It lives here rather than on
 * every branch row in the sidebar because it is a rare, whole-level action, and
 * a control on every row would be permanent weight for it — the tree is read
 * far more often than it is re-sorted.
 *
 * **Orphaned placements.** A `31818` whose slug has no revisions any more: the
 * page was deleted out from under it. It is ignored when the tree is built, so
 * it is inert rather than harmful, and that is exactly why it needs a place to
 * be seen — nothing else in the app would ever mention it.
 *
 * Both publish one event per page, in sequence. There is no batch signing in
 * NIP-07, so this is honest about what it is doing: a counter while it runs,
 * and a count of what actually landed when it stops.
 * docs/02-data-model-events.md
 */
export function PageTreeMaintenance({
  relayUrl,
  groupId,
  pages,
  orphanPlacements,
}: {
  relayUrl: string
  groupId: string
  pages: Page[]
  orphanPlacements: Placement[]
}) {
  const { session, ensureSamePubkey } = useSession()
  const [level, setLevel] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const levels = sortableLevels(pages)
  // '' is the top level, which is a real choice and not "nothing picked" — so
  // the select is keyed on the slug with a sentinel for it.
  const selected = level === '' ? null : level
  const pending = sortLevelByTitle(pages, selected)
  const preview = previewLevelOrder(pages, selected)

  // An addressable event is identified per author, and a relay honours a
  // deletion request only from the pubkey that signed the event. Somebody
  // else's leftover is theirs to clean up, so it is not offered here.
  const mine =
    session.status === 'signed-in'
      ? orphanPlacements.filter((placement) => placement.author === session.pubkey)
      : []
  const theirs = orphanPlacements.length - mine.length

  const guard = async (): Promise<boolean> => {
    if (session.status !== 'signed-in') {
      setError('This signs events — please sign in first.')
      return false
    }
    const same = await ensureSamePubkey()
    if (!same.ok) {
      setError(same.reason)
      return false
    }
    return true
  }

  const fail = (reason: string): string =>
    classifyRejection(reason) === 'permission'
      ? `The relay does not allow you to write here: ${reason}`
      : reason

  const sortLevel = async () => {
    setError(null)
    setDone(null)
    if (!(await guard()) || session.status !== 'signed-in') return

    let landed = 0
    for (const [index, entry] of pending.entries()) {
      setBusy(`Sorting… ${index + 1} of ${pending.length}`)
      try {
        const result = await publishPlacement(session.signer, {
          relayUrl,
          groupId,
          slug: entry.slug,
          parentSlug: entry.parentSlug,
          order: entry.order,
        })
        if (result.ok) landed += 1
        // The first refusal ends it. Carrying on would ask for a signature per
        // remaining page to collect the same answer, and a half-sorted level
        // is worse than an unsorted one.
        else {
          setError(fail(result.reason))
          break
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'signing was cancelled')
        break
      }
    }
    setBusy(null)
    if (landed > 0) {
      setDone(
        `${landed} of ${pending.length} page${pending.length === 1 ? '' : 's'} now sorts by its title.`,
      )
    }
  }

  const cleanUp = async () => {
    setError(null)
    setDone(null)
    if (!(await guard()) || session.status !== 'signed-in') return

    let landed = 0
    for (const [index, placement] of mine.entries()) {
      setBusy(`Cleaning up… ${index + 1} of ${mine.length}`)
      try {
        const result = await publishPlacementDeletion(session.signer, {
          relayUrl,
          groupId,
          slug: placement.slug,
          author: placement.author,
        })
        if (result.ok) landed += 1
        else {
          setError(fail(result.reason))
          break
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'signing was cancelled')
        break
      }
    }
    setBusy(null)
    if (landed > 0) {
      setDone(
        `${landed} stale position${landed === 1 ? '' : 's'} asked to be removed. This is a ` +
          'NIP-09 request: our relay stores it without deleting anything, so the client stops ' +
          'counting them while the events themselves may stay.',
      )
    }
  }

  return (
    <section className="space-y-6">
      <SectionLabel>Page tree</SectionLabel>

      <div className="space-y-2.5">
        <p className="max-w-[60ch] text-sm text-fg-muted">
          Dragging sorts one page at a time. This puts a whole level back into
          alphabetical order by clearing the positions in it — a page without a
          position of its own is ordered by its title.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={level}
            onChange={(event) => {
              setLevel(event.target.value)
              setDone(null)
            }}
            aria-label="Level to sort"
            className={`${INPUT} w-auto min-w-56`}
          >
            {levels.map((entry) => (
              <option key={entry.parentSlug ?? ''} value={entry.parentSlug ?? ''}>
                {'— '.repeat(entry.depth)}
                {entry.title} ({entry.pages})
              </option>
            ))}
          </select>

          <Button
            onClick={() => void sortLevel()}
            disabled={busy !== null || pending.length === 0 || session.status !== 'signed-in'}
          >
            {busy?.startsWith('Sorting') ? busy : 'Sort by title'}
          </Button>
        </div>

        {pending.length === 0 ? (
          <p className="text-xs text-fg-subtle">
            This level already sorts by its titles — nothing to sign.
          </p>
        ) : (
          <p className="text-xs text-fg-subtle">
            {pending.length} of {preview.length} page{preview.length === 1 ? '' : 's'} carry a
            position of their own; only those are rewritten. Afterwards:{' '}
            {preview.map((page) => page.title).join(', ')}
          </p>
        )}
      </div>

      <div className="space-y-2.5 border-t border-line pt-6">
        <p className="max-w-[60ch] text-sm text-fg-muted">
          A position left behind by a page that no longer exists. It is ignored
          when the tree is built, so nothing is broken — but it is still an
          event saying where a page that is gone should hang.
        </p>

        {orphanPlacements.length === 0 ? (
          <p className="text-xs text-fg-subtle">No stale positions in this space.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => void cleanUp()}
                disabled={busy !== null || mine.length === 0}
              >
                {busy?.startsWith('Cleaning') ? busy : `Clean up ${mine.length} of mine`}
              </Button>
            </div>
            <p className="text-xs text-fg-subtle">
              {orphanPlacements.map((placement) => placement.slug).join(', ')}
              {theirs > 0 ? (
                <>
                  {' · '}
                  {theirs} {theirs === 1 ? 'was' : 'were'} signed by somebody else. A relay only
                  honours a deletion request from the key that signed the event, so those are
                  theirs to remove.
                </>
              ) : null}
            </p>
          </>
        )}
      </div>

      {error ? (
        <Callout tone="danger" title="That did not work">
          {error}
        </Callout>
      ) : null}

      {done && !error ? (
        <Callout tone="success" title="Done">
          {done}
        </Callout>
      ) : null}
    </section>
  )
}
