import { orderKeyOf } from './pages'
import type { Page } from './pages'

/**
 * Sorting a whole level in one go.
 *
 * The order key lives per page, so until now a level could only be sorted one
 * dragged page at a time, each with its own signature (docs/02). The way out
 * is not a bigger event but a smaller one: **a page with no key of its own is
 * ordered by its title**, so restoring a level to alphabetical order means
 * clearing keys, not computing new ones.
 *
 * That is worth stating plainly, because the obvious implementation — walk the
 * level and hand out fresh keys `a`, `b`, `c` … — is worse in every way. It
 * writes an event for every page instead of only the ones that need it, it
 * freezes today's alphabet into the data so a later rename no longer moves the
 * page, and it does key arithmetic where none is needed. Clearing is exact:
 * the level then sorts by the same rule an untouched level always did.
 */

/**
 * The level a page is actually drawn in, which is not always the level its
 * `page-parent` names: `buildTree` hangs a page whose parent does not (or no
 * longer) exist at the top level, and does the same for a page that names
 * itself. Grouping by the raw tag instead would put such a page in a level
 * nobody can see — so sorting the top level would quietly skip a page sitting
 * in it, which is the one thing a "sort this level" action must not do.
 *
 * A **hidden** parent counts as no parent for exactly the same reason.
 * `buildTree` leaves a hidden page out of its node map before it hangs
 * anything, so the children of a hidden page are drawn at the top level too
 * (`buildTree` in `pages.ts`, pinned by "does not take its subpages with it").
 * Testing only for existence would find the hidden parent, file those children
 * into a level that is not drawn anywhere, and leave them out of the top level
 * they *are* drawn in — the same silent skip, reachable by tombstoning any
 * page that has subpages.
 */
function effectiveParent(pages: Page[], page: Page): string | null {
  if (!page.parentSlug || page.parentSlug === page.slug) return null
  const parent = pages.find((entry) => entry.slug === page.parentSlug)
  return parent && !parent.hidden ? page.parentSlug : null
}

export type LevelSort = {
  slug: string
  /** kept as it is — this is about position within the level, not about it */
  parentSlug: string | null
  /** always null here: "no key of its own" is what makes the title decide */
  order: null
}

/**
 * The placements that put `parentSlug`'s level back into title order, in the
 * order they should be published. Empty when the level is already alphabetical
 * by that rule — there is nothing to sign, and signing anyway would ask for a
 * confirmation per page to change nothing.
 *
 * Only pages that actually carry a key are returned. A page already ordered by
 * its title is already where this would put it.
 *
 * Hidden pages are included. They are out of the tree, but they are still in
 * the level, and leaving them out would mean a page that comes back later
 * lands among freshly-sorted siblings still carrying a stale key from before.
 */
export function sortLevelByTitle(pages: Page[], parentSlug: string | null): LevelSort[] {
  return pages
    .filter((page) => effectiveParent(pages, page) === parentSlug && page.order !== null)
    // The page's *own* parent tag is carried over, not the effective one:
    // sorting a level decides positions within it and must not quietly repair
    // a page's broken parentage as a side effect.
    .map((page) => ({ slug: page.slug, parentSlug: page.parentSlug, order: null }))
}

/** A level somebody can sort: the top level, and every page that has children. */
export type SortableLevel = {
  /** null = the top level */
  parentSlug: string | null
  title: string
  depth: number
  pages: number
  /** how many of those carry an explicit key, so the sort has work to do */
  keyed: number
}

/**
 * Every level of the space, for a picker. Built from the flat page list rather
 * than the tree so that a hidden *member* of a level is still counted into it —
 * it is out of the tree but still in the level, and it would otherwise come
 * back later carrying a stale key among freshly sorted siblings.
 *
 * A hidden *parent* is a different matter and is not offered: its children are
 * drawn at the top level, so counting them here as a level of their own would
 * put the same page in two levels at once and leave the top level's count and
 * preview wrong. A level is what somebody can see, which is what makes "sort
 * this level" mean anything.
 */
export function sortableLevels(pages: Page[]): SortableLevel[] {
  const depthOf = (page: Page): number => {
    let depth = 0
    const seen = new Set<string>([page.slug])
    let cursor = effectiveParent(pages, page)
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      depth += 1
      const next = pages.find((entry) => entry.slug === cursor)
      cursor = next ? effectiveParent(pages, next) : null
    }
    return depth
  }

  const levels: SortableLevel[] = []
  const parents = new Set<string | null>([null])
  for (const page of pages) {
    const parent = effectiveParent(pages, page)
    if (parent) parents.add(parent)
  }

  for (const parentSlug of parents) {
    const inLevel = pages.filter((page) => effectiveParent(pages, page) === parentSlug)
    if (inLevel.length === 0) continue
    const parent = parentSlug ? pages.find((page) => page.slug === parentSlug) : null
    levels.push({
      parentSlug,
      title: parent ? parent.title : 'Top level',
      depth: parent ? depthOf(parent) + 1 : 0,
      pages: inLevel.length,
      keyed: inLevel.filter((page) => page.order !== null).length,
    })
  }

  // Tree order, so the picker reads like the sidebar: a level directly under
  // the page it belongs to, and alphabetically among equals.
  return levels.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth
    return a.title < b.title ? -1 : 1
  })
}

/** Only for a display: what the level will look like once it is sorted. */
export function previewLevelOrder(pages: Page[], parentSlug: string | null): Page[] {
  return pages
    .filter((page) => effectiveParent(pages, page) === parentSlug)
    .map((page) => ({ ...page, order: null }))
    .sort((a, b) => {
      const left = orderKeyOf(a)
      const right = orderKeyOf(b)
      if (left !== right) return left < right ? -1 : 1
      return a.slug < b.slug ? -1 : 1
    })
}
