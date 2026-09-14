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
}

function sortNewestFirst(a: Revision, b: Revision): number {
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
  // On equal timestamps, order by id so that every client shows the same
  // page.
  return a.id < b.id ? -1 : 1
}

/**
 * The chain with the revisions a NIP-09 request removed taken out of it.
 *
 * `bridged` holds, per surviving revision, the ancestors it reaches *only*
 * through a removed revision and that are not among its own `parentRevs`.
 * They are not made parents: a revision's arity is what its author signed, and
 * a successor that inherited two parents from a removed merge would wear the
 * "merge" badge for a merge nobody made. Marking them as referenced is what
 * they are needed for — see `buildPages`.
 */
type RepairedChain = {
  revisions: Revision[]
  bridged: Map<string, string[]>
}

/**
 * Drops the revisions a NIP-09 request removed and reconnects the chain around
 * them: a survivor whose `parent-rev` names a removed revision is re-pointed
 * at that revision's nearest surviving ancestor along the first-parent path.
 * The removed node is skipped, but its ancestors stay reachable — the chain
 * does not tear.
 *
 * A removed *merge* has ancestors off that path as well. They are collected
 * into `bridged` rather than dropped, because nothing visible would point at
 * them otherwise and they would come back as leaves — a fork out of a deletion.
 *
 * A predecessor that was never loaded is kept as-is (the tolerated missing
 * link), and a parent cycle among removed revisions resolves to nothing rather
 * than hanging. The first parent stays first, so `firstParentChain` keeps its
 * meaning; duplicate targets are collapsed.
 */
function repairChain(revisions: Revision[], deleted: Set<string>): RepairedChain {
  if (deleted.size === 0) return { revisions, bridged: new Map() }
  const byId = new Map(revisions.map((revision) => [revision.id, revision]))
  const visible: Revision[] = []
  const bridged = new Map<string, string[]>()
  for (const revision of revisions) {
    if (deleted.has(revision.id)) continue
    const repaired = reconnectParents(revision.parentRevs, byId, deleted)
    visible.push({ ...revision, parentRevs: repaired.parents })
    if (repaired.bridged.length > 0) bridged.set(revision.id, repaired.bridged)
  }
  return { revisions: visible, bridged }
}

function reconnectParents(
  parentRevs: string[],
  byId: Map<string, Revision>,
  deleted: Set<string>,
): { parents: string[]; bridged: string[] } {
  const parents: string[] = []
  const bridged: string[] = []
  for (const parentId of parentRevs) {
    if (!deleted.has(parentId)) {
      if (!parents.includes(parentId)) parents.push(parentId)
      continue
    }
    const first = firstSurvivingAncestor(parentId, byId, deleted)
    if (first && !parents.includes(first)) parents.push(first)
    for (const id of survivingAncestors(parentId, byId, deleted)) {
      if (id !== first && !parents.includes(id) && !bridged.includes(id)) bridged.push(id)
    }
  }
  return { parents, bridged }
}

/** The new parent: up the first-parent path until a revision survives. */
function firstSurvivingAncestor(
  start: string,
  byId: Map<string, Revision>,
  deleted: Set<string>,
): string {
  let current = start
  const seen = new Set<string>()
  while (deleted.has(current)) {
    // A cycle between removed revisions has no surviving ancestor.
    if (seen.has(current)) return ''
    seen.add(current)
    const parent = byId.get(current)
    if (!parent) return ''
    current = parent.parentRevs[0] ?? ''
  }
  return current
}

/** Every surviving revision reachable through the removed ones above `start`. */
function survivingAncestors(
  start: string,
  byId: Map<string, Revision>,
  deleted: Set<string>,
): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    if (!deleted.has(id)) {
      found.push(id)
      continue
    }
    const revision = byId.get(id)
    // Never loaded: the tolerated missing link, and nothing to climb further.
    if (revision) queue.push(...revision.parentRevs)
  }
  return found
}

/**
 * Builds the pages from all revisions of a group.
 *
 * Head resolution: leaves are revisions no other revision points at via
 * `parent-rev`. With several leaves (concurrent editing) the newest is
 * displayed, but the fork is not hidden — `leaves` keeps all of them.
 * docs/05-versioning-history.md
 *
 * `deleted` holds the ids a NIP-09 request removed. They are skipped in the
 * exposed list and in the leaves, and the survivors are reconnected around
 * them (see `repairChain`) — the repair is what keeps a removed middle
 * revision's parent from looking like a leaf again.
 *
 * Where a page hangs comes from its placement event when there is one, and
 * from the tags of its first revision otherwise — a page that has never been
 * moved needs no placement event of its own. src/domain/placement.ts
 */
export function buildPages(
  revisions: Revision[],
  placements: Map<string, Placement> = new Map(),
  deleted: Set<string> = new Set(),
): Page[] {
  const { revisions: visible, bridged } = repairChain(revisions, deleted)
  const bySlug = new Map<string, Revision[]>()
  for (const revision of visible) {
    const list = bySlug.get(revision.slug)
    if (list) list.push(revision)
    else bySlug.set(revision.slug, [revision])
  }

  const pages: Page[] = []
  for (const [slug, list] of bySlug) {
    const sorted = [...list].sort(sortNewestFirst)
    // Over the repaired list, so a survivor bridged past a removed revision
    // counts as referencing the surviving ancestor it now points at — plus
    // the ancestors it reaches only through a removed merge, which are
    // referenced just as they were before the removal, only not as parents.
    const referenced = new Set<string>()
    for (const revision of sorted) {
      for (const parent of revision.parentRevs) referenced.add(parent)
      for (const ancestor of bridged.get(revision.id) ?? []) referenced.add(ancestor)
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
 */
export function buildTree(pages: Page[]): PageNode[] {
  const nodes = new Map<string, PageNode>()
  for (const page of pages) nodes.set(page.slug, { ...page, children: [], depth: 0 })

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

/** Whether `slug` may become a child of `targetSlug`. null = top level. */
export function canMoveUnder(pages: Page[], slug: string, targetSlug: string | null): boolean {
  if (targetSlug === null) return true
  return !descendantSlugs(pages, slug).has(targetSlug)
}
