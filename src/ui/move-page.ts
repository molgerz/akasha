import { useState } from 'react'
import { classifyRejection } from '../nostr/client'
import { publishPlacement } from '../nostr/publish-placement'
import { useSession } from '../session/session'
import { canMoveUnder } from '../domain/pages'
import { planMove } from '../domain/move-tree'
import type { MoveDirection, TreeMove } from '../domain/move-tree'
import type { Page } from '../domain/pages'

/**
 * Where a page should end up: under `parent` (null = top level), at position
 * `order` within that level. `order` null means "no position of its own" —
 * the level then sorts it by its title. src/domain/order.ts
 */
export type MoveDestination = {
  parent: Page | null
  order: string | null
}

export type MovePage = {
  /** Publishes the move. Returns false when nothing was published. */
  move: (page: Page, destination: MoveDestination) => Promise<boolean>
  /** Slug currently being published, for a busy label */
  busySlug: string | null
  error: string | null
  setError: (message: string | null) => void
  signedIn: boolean
}

/**
 * Moving a page. Drag & drop in the sidebar is the only gesture that gets
 * here, but the rules for it — signed in, no move into one's own subtree, the
 * relay's literal reason on a rejection — are worth keeping out of the tree
 * rendering.
 */
export function useMovePage(relayUrl: string, groupId: string, pages: Page[]): MovePage {
  const { session, ensureSamePubkey } = useSession()
  const [busySlug, setBusySlug] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const move = async (page: Page, destination: MoveDestination): Promise<boolean> => {
    if (session.status !== 'signed-in') {
      setError('Moving a page signs an event — please sign in first.')
      return false
    }
    const parentSlug = destination.parent?.slug ?? null
    if (parentSlug === page.slug) {
      setError('A page cannot be its own parent.')
      return false
    }
    if (!canMoveUnder(pages, page.slug, parentSlug)) {
      setError('A page cannot be moved below one of its own subpages.')
      return false
    }
    // Nothing to publish: the page already hangs exactly there.
    if (parentSlug === page.parentSlug && destination.order === page.order) {
      setError(null)
      return false
    }

    setError(null)
    setBusySlug(page.slug)
    try {
      const same = await ensureSamePubkey()
      if (!same.ok) {
        setError(same.reason)
        return false
      }
      // A placement, not a revision: the page's text and its history stay
      // untouched, and its byline keeps naming whoever last wrote something.
      // src/domain/placement.ts
      const result = await publishPlacement(session.signer, {
        relayUrl,
        groupId,
        slug: page.slug,
        parentSlug,
        order: destination.order,
      })
      if (result.ok) return true

      const kind = classifyRejection(result.reason)
      setError(
        kind === 'auth'
          ? `The relay requires authentication (NIP-42): ${result.reason}`
          : kind === 'permission'
            ? `The relay does not allow you to write in this space: ${result.reason}`
            : `Not moved: ${result.reason}`,
      )
      return false
    } catch (err) {
      setError(err instanceof Error ? err.message : 'signing was cancelled')
      return false
    } finally {
      setBusySlug(null)
    }
  }

  return { move, busySlug, error, setError, signedIn: session.status === 'signed-in' }
}

/**
 * The four entries of the move menu, with the names of the pages they would
 * move past — so the menu reads as what will happen rather than as four bare
 * directions. A move that has nowhere to go keeps its generic label: there is
 * no page to name, and the entry is drawn disabled anyway.
 *
 * Here rather than in `PageMoveMenu.tsx` because these are words, not a
 * component, and next to `useMovePage` because the two answer the same question
 * from opposite ends: this one what a move would do, that one what the relay
 * said when it was done. The arithmetic is in `src/domain/move-tree.ts`.
 */
const MOVE_LABEL: Record<MoveDirection, string> = {
  up: 'Move up',
  down: 'Move down',
  in: 'Move in',
  out: 'Move out',
}

const MOVE_ORDER: MoveDirection[] = ['up', 'down', 'in', 'out']

export type MoveEntry = {
  direction: MoveDirection
  label: string
  /** null when the move has nowhere to go */
  move: TreeMove | null
}

export function moveEntries(pages: Page[], slug: string): MoveEntry[] {
  const page = pages.find((entry) => entry.slug === slug) ?? null
  const parent = page?.parentSlug
    ? (pages.find((entry) => entry.slug === page.parentSlug) ?? null)
    : null

  return MOVE_ORDER.map((direction) => {
    const move = planMove(pages, slug, direction)
    let label = MOVE_LABEL[direction]
    if (move && direction === 'in') {
      const into = pages.find((entry) => entry.slug === move.parentSlug)
      if (into) label = `Move under ${into.title}`
    }
    if (move && direction === 'out' && parent) label = `Move out of ${parent.title}`
    return { direction, label, move }
  })
}
