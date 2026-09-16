import { effectiveOrderKey } from './order'
import type { Placement } from './placement'
import type { Revision } from './revision'

/**
 * A page is `(group, slug)` — not a single event. Its current content is the
 * head of its revision chain. docs/02-data-model-events.md
 */
export type Page = {
  slug: string
  title: string
  parentSlug: string | null
  /** sort key among its siblings. null = ordered by title */
  order: string | null
  /** the revision being displayed */
  head: Revision
  /** all revisions, newest first */
  revisions: Revision[]
  /** leaves of the chain. More than one = a fork */
  leaves: Revision[]
  /**
   * The page was archived by a revision carrying the archived tag: it leaves
   * the tree, the search and the navigation, and only its history and its own
   * URL still reach it.
   *
   * Read off the **head**, so it follows the same revision the content does.
   * On a fork where one leaf archives the page and the other does not, the
   * newer leaf decides — the same rule that decides which text is shown,
   * rather than a second one nobody could predict.
   */
  archived: boolean
}

function sortNewestFirst(a: Revision, b: Revision): number {
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
  // On equal timestamps, order by id so that every client shows the same
  // page.
  return a.id < b.id ? -1 : 1
}

/**
 * Builds the pages from all revisions of a group.
 *
 * Head resolution: leaves are revisions no other revision points at via
 * `parent-rev`. With several leaves (concurrent editing) the newest is
 * displayed, but the fork is not hidden — `leaves` keeps all of them.
 * docs/05-versioning-history.md
 *
 * Where a page hangs comes from its placement event when there is one, and
 * from the tags of its first revision otherwise — a page that has never been
 * moved needs no placement event of its own. src/domain/placement.ts
 */
export function buildPages(
  revisions: Revision[],
  placements: Map<string, Placement> = new Map(),
): Page[] {
  const bySlug = new Map<string, Revision[]>()
  for (const revision of revisions) {
    const list = bySlug.get(revision.slug)
    if (list) list.push(revision)
    else bySlug.set(revision.slug, [revision])
  }

  const pages: Page[] = []
  for (const [slug, list] of bySlug) {
    const sorted = [...list].sort(sortNewestFirst)
    const referenced = new Set<string>()
    for (const revision of sorted) {
      for (const parent of revision.parentRevs) referenced.add(parent)
    }
    const leaves = sorted.filter((revision) => !referenced.has(revision.id))
    const head = leaves[0] ?? sorted[0]
    // A placement replaces both fields together, because a move sets both.
    const placement = placements.get(slug)
    pages.push({
      slug,
      title: head.title,
      parentSlug: placement ? placement.parentSlug : head.parentSlug,
      order: placement ? placement.order : head.order,
      head,
      revisions: sorted,
      leaves,
      archived: head.archived,
    })
  }

  // Sorting by the order key, not by the title: a page dragged between two
  // siblings carries a key that sorts between theirs, and a page without one
  // is ordered by its title anyway. The slug breaks a tie between two pages
  // whose titles normalise identically, so every client shows one order.
  // src/domain/order.ts
  return pages.sort((a, b) => {
    const left = orderKeyOf(a)
    const right = orderKeyOf(b)
    if (left !== right) return left < right ? -1 : 1
    return a.slug < b.slug ? -1 : 1
  })
}

/** The key a page sorts by among its siblings. */
export function orderKeyOf(page: Pick<Page, 'order' | 'title' | 'slug'>): string {
  return effectiveOrderKey(page.order, page.title, page.slug)
}

export type PageNode = Page & { children: PageNode[]; depth: number }

/**
 * The page tree for the sidebar. Pages whose parent does not (or no longer)
 * exist hang at the top level — hiding them would be worse than filing them in
 * the wrong place.
 *
 * An archived page is left out, and by that same rule its children come up to
 * the top level rather than disappearing with it. Archiving a page is a
 * statement about that page; a subpage somebody else wrote is not covered by
 * it, and taking a branch off screen because its root was archived would
 * remove pages nobody asked to remove.
 */
export function buildTree(pages: Page[]): PageNode[] {
  const nodes = new Map<string, PageNode>()
  for (const page of pages) {
    if (page.archived) continue
    nodes.set(page.slug, { ...page, children: [], depth: 0 })
  }

  const roots: PageNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parentSlug ? nodes.get(node.parentSlug) : undefined
    if (parent && parent.slug !== node.slug) parent.children.push(node)
    else roots.push(node)
  }

  const setDepth = (list: PageNode[], depth: number) => {
    for (const node of list) {
      node.depth = depth
      setDepth(node.children, depth + 1)
    }
  }
  setDepth(roots, 0)
  return roots
}

export function flattenTree(nodes: PageNode[]): PageNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)])
}

/**
 * Finds the common ancestor of two revisions — the base for a three-way merge.
 * When there is none (two independent roots) the result is null; the merge then
 * runs against an empty base and honestly reports a conflict instead of
 * silently favouring one side.
 */
export function findCommonAncestor(
  revisions: Revision[],
  a: Revision,
  b: Revision,
): Revision | null {
  const byId = new Map(revisions.map((revision) => [revision.id, revision]))

  const ancestorsOfA = new Set<string>()
  const queue = [a.id]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (ancestorsOfA.has(id)) continue
    ancestorsOfA.add(id)
    const revision = byId.get(id)
    if (revision) queue.push(...revision.parentRevs)
  }

  const seen = new Set<string>()
  const search = [b.id]
  while (search.length > 0) {
    const id = search.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    if (ancestorsOfA.has(id) && id !== b.id) return byId.get(id) ?? null
    if (ancestorsOfA.has(id) && id === b.id && id !== a.id) return byId.get(id) ?? null
    const revision = byId.get(id)
    if (revision) search.push(...revision.parentRevs)
  }
  return null
}

/**
 * `slug` and everything below it. A page cannot be moved into its own subtree:
 * the branch would point at itself and drop out of the tree. The visited set
 * also stops a cycle that is already in the data from spinning here.
 */
export function descendantSlugs(pages: Page[], slug: string): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const page of pages) {
    if (!page.parentSlug) continue
    const list = childrenOf.get(page.parentSlug)
    if (list) list.push(page.slug)
    else childrenOf.set(page.parentSlug, [page.slug])
  }

  const found = new Set<string>()
  const queue = [slug]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (found.has(current)) continue
    found.add(current)
    queue.push(...(childrenOf.get(current) ?? []))
  }
  return found
}

/** The direct children of `slug`, whatever their own visibility. */
export function childSlugs(pages: Page[], slug: string): string[] {
  return pages.filter((page) => page.parentSlug === slug).map((page) => page.slug)
}

/**
 * The archived pages, most recently archived first.
 *
 * Ordered by the head's timestamp and not by title, because an archive is read
 * as a log of what was taken out rather than as a second page index — the page
 * somebody archived by mistake a minute ago is the one they come here for. The
 * head *is* the archiving revision: archiving publishes one on top of the
 * chain, so its timestamp is when the page left the tree.
 * src/routes/ArchiveView.tsx
 */
export function archivedPages(pages: Page[]): Page[] {
  return pages
    .filter((page) => page.archived)
    .sort((a, b) => {
      if (b.head.createdAt !== a.head.createdAt) return b.head.createdAt - a.head.createdAt
      return a.slug < b.slug ? -1 : 1
    })
}

/** Whether `slug` may become a child of `targetSlug`. null = top level. */
export function canMoveUnder(pages: Page[], slug: string, targetSlug: string | null): boolean {
  if (targetSlug === null) return true
  return !descendantSlugs(pages, slug).has(targetSlug)
}
