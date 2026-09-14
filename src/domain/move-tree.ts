import { keyBetween } from './order'
import { orderKeyOf } from './pages'
import type { Page } from './pages'

/**
 * The four moves an outliner has, expressed as placements.
 *
 * Dragging says where a page ends up better than any list of slugs can — which
 * is why the page's own move action was dropped (docs/06). But HTML5 drag &
 * drop has no keyboard path at all, and on a touch screen it does not fire
 * even once: there, moving a page was simply impossible. These four are the
 * vocabulary every outline editor uses for the same job, and every one of them
 * is a single, predictable step somebody can repeat and watch.
 *
 * Kept here rather than in the sidebar because "where does this page land" is
 * a question about the tree, not about a menu — and because the interesting
 * part, the order key, is only checkable in isolation.
 */
export type MoveDirection =
  /** swap with the sibling above */
  | 'up'
  /** swap with the sibling below */
  | 'down'
  /** become the last child of the sibling above */
  | 'in'
  /** leave the parent and follow directly behind it */
  | 'out'

/**
 * Where a move puts the page: whose child it becomes, and at which key.
 *
 * `order: null` means "no key of its own" — the new level then sorts it by its
 * title (src/domain/order.ts). That is what picking a *parent* produces, and
 * it is deliberately the same answer dropping a page onto a row gives: the
 * tree must not end up looking different depending on whether the page was
 * moved with a mouse or with the keyboard. A key is only written where a
 * position within a level is genuinely being chosen — up, down and out.
 */
export type TreeMove = { parentSlug: string | null; order: string | null }

/**
 * One level, in the order it is drawn. `pages` comes from `buildPages`, which
 * has already sorted globally by order key — so filtering keeps that order and
 * no second sort is needed here.
 */
export function siblingsOf(pages: Page[], parentSlug: string | null): Page[] {
  return pages.filter((page) => page.parentSlug === parentSlug)
}

/**
 * Where `slug` would land, or `null` when the move has nowhere to go: the top
 * row of a level cannot go up, the bottom row cannot go down, a page at the
 * root cannot come further out, and a page with no sibling above it has
 * nothing to move in under. The menu disables exactly those entries, so an
 * unavailable move is visible before it is tried rather than reported as an
 * error afterwards.
 *
 * A caller still has to check `canMoveUnder`: not for these four — none of
 * them can reach into the page's own subtree, because a sibling and a parent
 * are never descendants — but because `useMovePage` is the one place that
 * publishes, and it checks everything it publishes.
 */
export function planMove(pages: Page[], slug: string, direction: MoveDirection): TreeMove | null {
  const page = pages.find((entry) => entry.slug === slug)
  if (!page) return null

  const level = siblingsOf(pages, page.parentSlug)
  const index = level.findIndex((entry) => entry.slug === slug)
  if (index === -1) return null

  const previous = level[index - 1]
  const next = level[index + 1]

  switch (direction) {
    case 'up': {
      if (!previous) return null
      // Between the two rows above it: the one it swaps with, and whatever is
      // above *that*. Writing "the key of the row above" would collide rather
      // than overtake.
      const above = level[index - 2]
      return {
        parentSlug: page.parentSlug,
        order: keyBetween(above ? orderKeyOf(above) : null, orderKeyOf(previous)),
      }
    }
    case 'down': {
      if (!next) return null
      const below = level[index + 2]
      return {
        parentSlug: page.parentSlug,
        order: keyBetween(orderKeyOf(next), below ? orderKeyOf(below) : null),
      }
    }
    case 'in': {
      if (!previous) return null
      // No key: this step chooses a parent, not a position, and dropping the
      // same page onto the same row with a mouse chooses no position either.
      // See `TreeMove` — one destination, one result, whatever moved it.
      return { parentSlug: previous.slug, order: null }
    }
    case 'out': {
      const parent = pages.find((entry) => entry.slug === page.parentSlug)
      if (!parent) return null
      // Directly behind the parent in the parent's own level, which is where
      // the row visually already is — the step is outwards, not downwards.
      const uncles = siblingsOf(pages, parent.parentSlug)
      const after = uncles[uncles.findIndex((entry) => entry.slug === parent.slug) + 1]
      return {
        parentSlug: parent.parentSlug,
        order: keyBetween(orderKeyOf(parent), after ? orderKeyOf(after) : null),
      }
    }
  }
}
