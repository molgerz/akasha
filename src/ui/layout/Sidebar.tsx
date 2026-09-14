import { useEffect, useState } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { GroupAddress } from '../../nostr/group-address'
import { RelayStatusBadge } from '../RelayStatusBadge'
import type { RelaySnapshot } from '../../nostr/client'
import type { RelayInfo } from '../../nostr/relay-status'
import type { SpaceSnapshot } from '../../nostr/space-store'
import { descendantSlugs, orderKeyOf } from '../../domain/pages'
import type { Page, PageNode } from '../../domain/pages'
import { keyBetween } from '../../domain/order'
import { spaceAccess } from '../../domain/space-access'
import { useSession } from '../../session/session'
import { useMovePage } from '../move-page'
import { PageMoveMenu } from '../PageMoveMenu'
import type { TreeMove } from '../../domain/move-tree'
import { InitialsDisc, SectionLabel } from '../controls'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  HomeIcon,
  PageIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SpaceIcon,
  UserIcon,
} from '../icons'

type Props = {
  group: GroupAddress | null
  space: SpaceSnapshot
  snapshot: RelaySnapshot
  info: RelayInfo | null
  /**
   * /settings/* — including /settings/spaces/:group, which reuses the
   * `group` param name so `SpaceSettings` can share `useSpaceRoute` with the
   * space's own routes. The bar shows the settings nav here, never the page
   * tree: settings are not "inside" whichever space happens to be selected.
   */
  inSettings: boolean
}

/**
 * The left bar: space header, fixed entries, page tree, footer with the relay
 * state. The tree is a projection of the revision and placement events, not an
 * index event of its own.
 *
 * The bar shares its background with the top bar and carries no divider of its
 * own — the canvas to its right is a raised, rounded surface, and *that* edge
 * is the divider. One line instead of two, and the document ends up sitting on
 * the chrome rather than being fenced off from it.
 *
 * A selected row is **grey**, not blue. In this bar the accent had been doing
 * two jobs: "this is where you are" and "this does something". Handing state to
 * the neutral fills leaves blue meaning one thing, and the tree stops looking
 * like a column of buttons.
 * docs/06-ui-information-architecture.md
 */
const BRANCH_KEY = 'nc-sidebar-collapsed-branches'

/**
 * Which branches are folded away. Storing the *collapsed* ones rather than the
 * open ones means a page created later shows up instead of hiding until
 * somebody expands its parent.
 */
function readCollapsedBranches(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(BRANCH_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/**
 * The chain of parents above `slug`. The branch leading to the page you are
 * reading is always drawn open — otherwise a fold could hide the very page you
 * are on, and the highlighted row would be nowhere to be seen.
 */
function pathToActive(nodes: PageNode[], slug: string | undefined): Set<string> {
  const path = new Set<string>()
  if (!slug) return path
  const parents = new Map<string, string | null>()
  const walk = (list: PageNode[]) => {
    for (const node of list) {
      for (const child of node.children) parents.set(child.slug, node.slug)
      walk(node.children)
    }
  }
  walk(nodes)
  let cursor = parents.get(slug) ?? null
  while (cursor && !path.has(cursor)) {
    path.add(cursor)
    cursor = parents.get(cursor) ?? null
  }
  return path
}

/**
 * Where a drag currently points. Two kinds, as in Confluence: **on** a row
 * files the page under it, **into the gap** between two rows puts it at that
 * position of *their* level, staying a sibling instead of becoming a subpage.
 */
type DropTarget = { kind: 'page' | 'gap'; id: string }

function sameTarget(a: DropTarget | null, b: DropTarget): boolean {
  return a !== null && a.kind === b.kind && a.id === b.id
}

/** Everything a tree row needs to be dragged, and to be dropped on. */
type TreeDnd = {
  enabled: boolean
  dragging: string | null
  over: DropTarget | null
  busySlug: string | null
  /** filing it under this page */
  canDropOnPage: (slug: string) => boolean
  /** putting it at some position of the level below this page (null = root) */
  canDropInLevel: (parentSlug: string | null) => boolean
  onDragStart: (slug: string) => void
  onDragEnd: () => void
  onOver: (target: DropTarget) => void
  onLeave: (target: DropTarget) => void
  onDropOnPage: (slug: string) => void
  onDropInGap: (parentSlug: string | null, before: PageNode | null, after: PageNode | null) => void
}

/**
 * The move menu's side of a tree row: what it may move, and where to send the
 * result. Separate from `TreeDnd` because it answers the question drag & drop
 * cannot — moving without a pointer that can drag. src/ui/PageMoveMenu.tsx
 */
type TreeMoves = {
  enabled: boolean
  pages: Page[]
  busySlug: string | null
  onMove: (page: Page, move: TreeMove) => void
}

/** A fixed entry: icon, label, and grey when it is the page you are on. */
function NavRow({
  to,
  icon,
  end = false,
  children,
}: {
  to: string
  icon: ReactNode
  end?: boolean
  children: ReactNode
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex h-8 items-center gap-2.5 rounded-md px-2 text-sm ${
          isActive
            ? 'bg-surface-selected font-medium text-fg'
            : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
        }`
      }
    >
      {icon}
      <span className="truncate">{children}</span>
    </NavLink>
  )
}

export function Sidebar({ group, space, snapshot, info, inSettings }: Props) {
  const base = group ? `/s/${encodeURIComponent(`${group.host}'${group.id}`)}` : null
  const nodes = space.tree
  const { session } = useSession()
  const treeAccess = spaceAccess(session.status === 'signed-in' ? session.pubkey : null, space)
  const { slug } = useParams<{ slug?: string }>()
  const [collapsedBranches, setCollapsedBranches] = useState(readCollapsedBranches)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<DropTarget | null>(null)
  const { move, busySlug, error, setError, signedIn } = useMovePage(
    group?.relayUrl ?? '',
    group?.id ?? '',
    space.pages,
  )
  const forcedOpen = pathToActive(nodes, slug)

  // Dragging a page onto another one files it there, dragging it into the gap
  // between two rows puts it at that position of their level — the same two
  // gestures Confluence has. In both cases the page's own subtree is barred:
  // the branch would point into itself and drop out of the tree.
  const draggedPage = dragging ? (space.pages.find((page) => page.slug === dragging) ?? null) : null
  const blocked = dragging ? descendantSlugs(space.pages, dragging) : null
  const pageBySlug = (slug: string | null): Page | null =>
    slug ? (space.pages.find((entry) => entry.slug === slug) ?? null) : null

  const canDropInLevel = (parentSlug: string | null): boolean => {
    if (!draggedPage) return false
    return parentSlug === null || !blocked!.has(parentSlug)
  }

  const canDropOnPage = (slug: string): boolean =>
    // Its current parent is no target: it is already filed there, and a drop
    // that publishes nothing should not light up as if it would.
    canDropInLevel(slug) && draggedPage!.parentSlug !== slug

  const dnd: TreeDnd = {
    enabled: signedIn,
    dragging,
    over,
    busySlug,
    canDropOnPage,
    canDropInLevel,
    onDragStart: (dragged) => {
      setError(null)
      setDragging(dragged)
    },
    onDragEnd: () => {
      setDragging(null)
      setOver(null)
    },
    onOver: (target) => setOver((current) => (sameTarget(current, target) ? current : target)),
    onLeave: (target) => setOver((current) => (sameTarget(current, target) ? null : current)),
    onDropOnPage: (slug) => {
      const page = draggedPage
      const allowed = canDropOnPage(slug)
      setDragging(null)
      setOver(null)
      // No position of its own: in its new level the page sorts by its title
      // until somebody drags it into place. src/domain/order.ts
      if (page && allowed) void move(page, { parent: pageBySlug(slug), order: null })
    },
    onDropInGap: (parentSlug, before, after) => {
      const page = draggedPage
      const allowed = canDropInLevel(parentSlug)
      setDragging(null)
      setOver(null)
      if (!page || !allowed) return
      void move(page, {
        parent: pageBySlug(parentSlug),
        order: keyBetween(before ? orderKeyOf(before) : null, after ? orderKeyOf(after) : null),
      })
    },
  }

  const moves: TreeMoves = {
    enabled: signedIn,
    pages: space.pages,
    busySlug,
    onMove: (page, target) => {
      setError(null)
      void move(page, { parent: pageBySlug(target.parentSlug), order: target.order })
    },
  }

  // A drag can end without the source seeing `dragend`: it is cancelled with
  // Escape, dropped outside the window, or the row unmounts mid-drag because a
  // relay event rebuilt the tree. The drag state would then stay set, and the
  // gap zones would keep lying over the row edges swallowing clicks. Listening
  // on the window closes that off for good.
  useEffect(() => {
    if (dragging === null) return
    const clear = () => {
      setDragging(null)
      setOver(null)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [dragging])

  const toggleBranch = (branchSlug: string) => {
    setCollapsedBranches((current) => {
      const next = new Set(current)
      if (next.has(branchSlug)) next.delete(branchSlug)
      else next.add(branchSlug)
      try {
        localStorage.setItem(BRANCH_KEY, JSON.stringify([...next]))
      } catch {
        /* then it only applies to this session */
      }
      return next
    })
  }

  return (
    <nav className="flex w-66 shrink-0 flex-col bg-surface-1">
      {/* The space, as one row: disc, name, host. The disc takes its colour
          from the name, so two spaces are told apart before either is read.
          Nothing here when no space is open — "Akasha" already sits at the
          very top of the window in the top bar, once is enough. */}
      {group ? (
        <div className="px-2 pb-1">
          <Link
            to={base ?? '/'}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-hover"
          >
            <InitialsDisc
              name={space.metadata?.name ?? group.id}
              className="size-7 text-[11px]"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-fg">
                {space.metadata?.name ?? group.id}
              </span>
              <span className="block truncate font-mono text-[11px] text-fg-subtle">
                {group.host}
              </span>
            </span>
          </Link>
        </div>
      ) : null}

      {inSettings ? (
        <>
          <div className="space-y-0.5 px-2 pt-1">
            <NavRow to="/settings/spaces" icon={<SpaceIcon />}>
              Spaces
            </NavRow>
            <NavRow to="/settings/profile" icon={<UserIcon />}>
              Profile
            </NavRow>
          </div>
          <div className="flex-1" />
        </>
      ) : base ? (
        <>
          <div className="space-y-0.5 px-2">
            <NavRow to={base} end icon={<HomeIcon />}>
              Overview
            </NavRow>
            <NavRow to={`${base}/search`} icon={<SearchIcon />}>
              Search
            </NavRow>
            <NavRow to={`${base}/new`} icon={<PlusIcon />}>
              New page
            </NavRow>
          </div>

          {/* The tree gets a heading of its own with the "+" on it. The button
              only appears on hover, so the bar is a list of pages at rest and
              a set of controls the moment you reach for it — the tree is read
              far more often than it is added to. */}
          <div className="group/pages mt-5 flex h-7 items-center gap-2 px-4">
            <SectionLabel className="flex-1">Pages</SectionLabel>
            <Link
              to={`${base}/new`}
              aria-label="New page in this space"
              title="New page in this space"
              className="flex size-5 items-center justify-center rounded text-fg-subtle opacity-0 group-hover/pages:opacity-100 hover:bg-surface-selected hover:text-fg focus-visible:opacity-100"
            >
              <PlusIcon className="size-3.5" />
            </Link>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-2 pb-2">
            {nodes.length === 0 ? (
              // Three different reasons for one empty tree. "no pages yet"
              // for a space you simply cannot see would be the bar quietly
              // asserting that it is empty in there.
              <div className="px-2 py-1 text-xs text-fg-subtle">
                {space.loading
                  ? 'loading pages…'
                  : treeAccess.state === 'hidden'
                    ? 'nothing visible'
                    : 'no pages yet'}
              </div>
            ) : (
              <TreeBranch
                nodes={nodes}
                base={base}
                parentSlug={null}
                collapsedBranches={collapsedBranches}
                forcedOpen={forcedOpen}
                onToggle={toggleBranch}
                dnd={dnd}
                moves={moves}
              />
            )}

            {busySlug ? <div className="px-2 py-1 text-xs text-fg-subtle">moving…</div> : null}
            {error ? <div className="px-2 py-1 text-xs text-danger">{error}</div> : null}
          </div>
        </>
      ) : (
        <div className="flex-1" />
      )}

      <div className="px-2 pb-1">
        <NavRow to="/settings/spaces" icon={<SettingsIcon />}>
          Settings
        </NavRow>
      </div>

      <RelayStatusBadge snapshot={snapshot} info={info} />
    </nav>
  )
}

/**
 * One level of the page tree. A branch gets a chevron to fold it, a leaf a dot
 * in the same slot — so titles stay on one vertical line instead of stepping in
 * and out depending on whether a sibling has children.
 */
function TreeBranch({
  nodes,
  base,
  parentSlug,
  collapsedBranches,
  forcedOpen,
  onToggle,
  dnd,
  moves,
}: {
  nodes: PageNode[]
  base: string
  /** the page this level hangs under. null = the top level */
  parentSlug: string | null
  collapsedBranches: Set<string>
  forcedOpen: Set<string>
  onToggle: (slug: string) => void
  dnd: TreeDnd
  moves: TreeMoves
}) {
  /**
   * The two rows a gap sits between, with the dragged page skipped: it is
   * about to leave its old place, so it must not be its own neighbour and set
   * the position it is measured against.
   */
  const neighbours = (index: number): [PageNode | null, PageNode | null] => [
    [...nodes.slice(0, index)].reverse().find((node) => node.slug !== dnd.dragging) ?? null,
    nodes.slice(index).find((node) => node.slug !== dnd.dragging) ?? null,
  ]

  /** A gap directly above or below the dragged row changes nothing. */
  const dropsInPlace = (index: number): boolean =>
    nodes[index - 1]?.slug === dnd.dragging || nodes[index]?.slug === dnd.dragging

  return (
    <>
      {nodes.map((node, index) => {
        const hasChildren = node.children.length > 0
        const open = hasChildren && (forcedOpen.has(node.slug) || !collapsedBranches.has(node.slug))

        return (
          // relative: the gap zones lie *over* the row edges instead of taking
          // space of their own, so the tree does not shift under the cursor
          // the moment a drag starts.
          <div key={node.slug} className="relative">
            <GapZone
              dnd={dnd}
              id={`${parentSlug ?? ''}#${index}`}
              parentSlug={parentSlug}
              neighbours={neighbours}
              index={index}
              depth={node.depth}
              edge="top"
              inPlace={dropsInPlace(index)}
            />
            <div
              draggable={dnd.enabled}
              onDragStart={(event) => {
                // Firefox starts no drag at all without a payload.
                event.dataTransfer.setData('text/plain', node.slug)
                event.dataTransfer.effectAllowed = 'move'
                dnd.onDragStart(node.slug)
              }}
              onDragEnd={dnd.onDragEnd}
              // Both dragenter and dragover have to be prevented: a target
              // that lets a single one of them through is not a drop target at
              // that moment, and the drop is silently discarded.
              onDragEnter={(event) => {
                if (!dnd.canDropOnPage(node.slug)) return
                event.preventDefault()
                dnd.onOver({ kind: 'page', id: node.slug })
              }}
              onDragOver={(event) => {
                if (!dnd.canDropOnPage(node.slug)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                dnd.onOver({ kind: 'page', id: node.slug })
              }}
              onDragLeave={(event) => {
                // dragleave also fires when the cursor crosses from one child
                // of the row to the next, and it bubbles. Without this the
                // highlight flickers off and on while the pointer stands still.
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                dnd.onLeave({ kind: 'page', id: node.slug })
              }}
              onDrop={(event) => {
                event.preventDefault()
                dnd.onDropOnPage(node.slug)
              }}
              title={
                dnd.enabled
                  ? 'Drag onto a page to file it under it, or between two rows to sort it there'
                  : undefined
              }
              className={`group/row flex items-center rounded-md ${
                dnd.enabled ? 'cursor-grab select-none active:cursor-grabbing' : ''
              } ${
                sameTarget(dnd.over, { kind: 'page', id: node.slug })
                  ? 'ring-2 ring-accent ring-inset'
                  : ''
              } ${dnd.dragging === node.slug || dnd.busySlug === node.slug ? 'opacity-40' : ''}`}
              style={{ paddingLeft: `${node.depth * 14}px` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => onToggle(node.slug)}
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${node.title}`}
                  title={`${open ? 'Collapse' : 'Expand'} ${node.title}`}
                  className="flex size-5 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-surface-selected hover:text-fg"
                >
                  {open ? (
                    <ChevronDownIcon className="size-3.5" />
                  ) : (
                    <ChevronRightIcon className="size-3.5" />
                  )}
                </button>
              ) : (
                <span className="flex size-5 shrink-0 justify-center" aria-hidden="true">
                  <span className="mt-[11px] size-1 rounded-full bg-line-strong" />
                </span>
              )}
              {/* A link is draggable by default and would become the drag
                  source itself — as a *link* drag, whose effect is copy/link,
                  so a drop asking for `move` is thrown away. The row is
                  supposed to be the source, so the link declines. */}
              <NavLink
                to={`${base}/${node.slug}`}
                draggable={false}
                className={({ isActive }) =>
                  `flex h-7.5 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 pl-1 text-sm ${
                    isActive
                      ? 'bg-surface-selected font-medium text-fg'
                      : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
                  }`
                }
              >
                <PageIcon className="size-4 opacity-60" />
                <span className="truncate">{node.title}</span>
                {/* A forked page has more than one current version. Amber and
                    after the title, so it cannot be read as the leaf dot. */}
                {node.leaves.length > 1 ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-warning"
                    title="several open versions"
                  />
                ) : null}
              </NavLink>
              {/* The keyboard's and the touch screen's way to the same move
                  the drag does. Only signed in: the menu publishes an event,
                  and an entry that cannot lead anywhere is worse than none. */}
              {moves.enabled ? (
                <PageMoveMenu
                  page={node}
                  pages={moves.pages}
                  busy={moves.busySlug !== null}
                  onMove={(target) => moves.onMove(node, target)}
                />
              ) : null}
            </div>

            {open ? (
              <TreeBranch
                nodes={node.children}
                base={base}
                parentSlug={node.slug}
                collapsedBranches={collapsedBranches}
                forcedOpen={forcedOpen}
                onToggle={onToggle}
                dnd={dnd}
                moves={moves}
              />
            ) : null}

            {/* The last row of a level closes it off. Pinned to the bottom of
                this wrapper, which spans the row *and* its subtree, so the
                line appears below the branch — where that position is. */}
            {index === nodes.length - 1 ? (
              <GapZone
                dnd={dnd}
                id={`${parentSlug ?? ''}#${nodes.length}`}
                parentSlug={parentSlug}
                neighbours={neighbours}
                index={nodes.length}
                depth={node.depth}
                edge="bottom"
                inPlace={dropsInPlace(nodes.length)}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

/**
 * The gap between two rows: dropping here makes the page a **sibling** at this
 * position, not a subpage. Only 9px tall and drawn as a line, like every tree
 * that offers this — the row itself stays the target for "file it under".
 */
function GapZone({
  dnd,
  id,
  parentSlug,
  neighbours,
  index,
  depth,
  edge,
  inPlace,
}: {
  dnd: TreeDnd
  id: string
  parentSlug: string | null
  neighbours: (index: number) => [PageNode | null, PageNode | null]
  index: number
  depth: number
  edge: 'top' | 'bottom'
  inPlace: boolean
}) {
  // Without a drag running the zone must not exist: it would swallow clicks
  // on the row edges underneath it.
  if (dnd.dragging === null || inPlace || !dnd.canDropInLevel(parentSlug)) return null

  const active = sameTarget(dnd.over, { kind: 'gap', id })
  const accept = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    dnd.onOver({ kind: 'gap', id })
  }

  return (
    <div
      onDragEnter={accept}
      onDragOver={(event) => {
        accept(event)
        event.dataTransfer.dropEffect = 'move'
      }}
      onDragLeave={() => dnd.onLeave({ kind: 'gap', id })}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const [before, after] = neighbours(index)
        dnd.onDropInGap(parentSlug, before, after)
      }}
      // 9px straddling the row edge: enough to hit with a mouse, little
      // enough that the row itself stays the target for "file it under".
      className={`absolute inset-x-0 z-10 h-[9px] ${
        edge === 'top' ? '-top-[4px]' : '-bottom-[4px]'
      }`}
    >
      {/* Indented to the level it would file the page into, so "sibling here"
          is distinguishable from "subpage of the row above" — but only by that
          level's own indent: the line spans the whole row it belongs to,
          including the slot the chevron and the leaf dot sit in. */}
      <div
        className={`h-full ${active ? 'flex items-center' : ''}`}
        style={{ marginLeft: `${depth * 14}px` }}
      >
        {active ? <span className="h-0.5 w-full rounded-full bg-accent" /> : null}
      </div>
    </div>
  )
}
