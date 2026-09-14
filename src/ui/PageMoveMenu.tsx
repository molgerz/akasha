import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TreeMove } from '../domain/move-tree'
import type { Page } from '../domain/pages'
import { canMoveSomewhere, moveEntries, moveTargets } from './move-page'
import { INPUT } from './controls'
import { MoveIcon, PageIcon } from './icons'

/**
 * The keyboard's and the touch screen's way of moving a page.
 *
 * Dragging in the tree is the better gesture and stays the primary one — it
 * says where a page ends up better than any list can (docs/06). What it is
 * not is reachable: HTML5 drag & drop has no keyboard path, and on a touch
 * screen it does not fire at all, so moving a page there was not merely
 * awkward, it was impossible.
 *
 * One menu answers both. Its trigger is a real button, so it is in the tab
 * order and under a finger. It has two panels: the four steps an outline
 * editor has, for a neighbour, and a list of every page the move may land
 * under, for the other end of the wiki. Reimplementing the drag on pointer
 * events would have given touch a gesture and the keyboard still nothing.
 *
 * The trigger is hidden until the row is hovered or something inside it is
 * focused — the tree is read far more often than it is rearranged, the same
 * reasoning as the "+" on the Pages heading. On a coarse pointer there is no
 * hover to reveal it with, so there it is simply always visible.
 */

/** `w-60`, as a number: the panel is positioned by hand, not laid out. */
const MENU_WIDTH = 240
/** Between the row and the panel. */
const GAP = 4
/** Never flush against the edge of the window. */
const EDGE = 8
/**
 * Below this the panel is not worth opening downwards: the filter field and
 * the first destinations have to be visible without scrolling, or the list
 * that is the point of the menu is the first thing to be cut off.
 */
const ROOM = 220

/** Where the panel goes, in viewport coordinates. */
type Anchor = { left: number; top?: number; bottom?: number; maxHeight: number }

export function PageMoveMenu({
  page,
  pages,
  busy,
  onMove,
}: {
  page: Page
  pages: Page[]
  busy: boolean
  onMove: (move: TreeMove) => void
}) {
  const [open, setOpen] = useState(false)
  /** the four steps, or the list of destinations */
  const [picking, setPicking] = useState(false)
  const [filter, setFilter] = useState('')
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  // Only while the menu is open. Both walk the whole tree, and there is one of
  // these per row: computing them for a shut menu was the sidebar re-rendering
  // the entire wiki twice per page on every event the relay pushed. What the
  // closed trigger needs is one bit, and `canMoveSomewhere` is the cheap way
  // to it.
  const available = canMoveSomewhere(pages, page.slug)
  const entries = open ? moveEntries(pages, page.slug) : []
  const targets = open ? moveTargets(pages, page.slug) : []

  const needle = filter.trim().toLowerCase()
  const shown = needle ? targets.filter((t) => t.title.toLowerCase().includes(needle)) : targets

  /**
   * The panel hangs under the trigger, but it is not *inside* it: see the
   * portal below. So it is measured off the trigger's box and flipped above
   * the row when the window has no room below — the rows near the bottom of
   * the tree are the ones a long destination list matters most for.
   */
  // Both of these read refs and call setters only, so they are stable for the
  // life of the row — which is what lets the window listeners below hold on to
  // one copy instead of being torn down and rebuilt on every keystroke in the
  // filter field.
  const anchorNow = useCallback((): Anchor => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return { left: EDGE, top: EDGE, maxHeight: ROOM }
    const below = window.innerHeight - rect.bottom - GAP - EDGE
    const above = rect.top - GAP - EDGE
    const flip = below < ROOM && above > below
    return {
      // Right-aligned with the trigger, pulled back in when that would hang
      // the panel off either edge of the window.
      left: Math.max(
        EDGE,
        Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - EDGE),
      ),
      ...(flip ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
      maxHeight: Math.max(ROOM, flip ? above : below),
    }
  }, [])

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    setPicking(false)
    setFilter('')
    // Only when the focus is still in the menu that is going away — otherwise
    // it lands on <body> and the keyboard starts over at the top of the page.
    // A click elsewhere brings its own focus and has to keep it.
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  // Measuring in the handler rather than in a layout effect: the panel is then
  // placed in the same render that opens it, so it never paints in a corner
  // first, and the effect that moves the focus into it finds it already there.
  const openMenu = () => {
    setAnchor(anchorNow())
    setPicking(false)
    setFilter('')
    setOpen(true)
  }

  const send = (move: TreeMove) => {
    close(true)
    onMove(move)
  }

  // Opening puts the focus inside: on the first usable entry, or on the filter
  // field once the list is up. A menu that opens with nothing focused is one
  // the keyboard has to find its way into first.
  useEffect(() => {
    if (!open) return
    const field = menuRef.current?.querySelector<HTMLInputElement>('input')
    if (field) {
      field.focus()
      return
    }
    menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
  }, [open, picking])

  // A panel positioned against the window has to be told when the window
  // moves under it. `capture`, because the tree scrolls in a container of its
  // own and a scroll event does not bubble out of it.
  useEffect(() => {
    if (!open) return
    const follow = () => setAnchor(anchorNow())
    window.addEventListener('resize', follow)
    window.addEventListener('scroll', follow, true)
    return () => {
      window.removeEventListener('resize', follow)
      window.removeEventListener('scroll', follow, true)
    }
  }, [open, anchorNow])

  // Clicking anywhere else closes it. `pointerdown` rather than `click`, so it
  // is gone before whatever was clicked reacts — otherwise a click on another
  // row's trigger closes this menu and opens nothing.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(menuRef.current?.contains(document.activeElement) ?? false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open, close])

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // Not swallowed by the sidebar or a parent: this is the innermost thing
      // Escape can mean while the menu is up.
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []),
    ].filter((item) => !item.disabled)
    if (items.length === 0) return
    const from = items.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    // Wrapping: a four-entry menu with two of them disabled is one keypress
    // from either end whichever way it wraps. The filter field is not one of
    // the entries, so from there the two keys mean the first and the last —
    // counting a step from "index -1" would land one short of the end.
    const to =
      from === -1
        ? step === 1
          ? 0
          : items.length - 1
        : (from + step + items.length) % items.length
    items[to]!.focus()
  }

  const itemClass =
    'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm text-fg-muted ' +
    'hover:bg-surface-hover hover:text-fg focus-visible:bg-surface-hover focus-visible:text-fg ' +
    'disabled:pointer-events-none disabled:opacity-40'

  const panelClass =
    'z-30 rounded-lg border border-line bg-surface-2 p-1 shadow-lg overflow-y-auto scroll-slim'
  const panelStyle = {
    position: 'fixed' as const,
    width: MENU_WIDTH,
    left: anchor?.left,
    top: anchor?.top,
    bottom: anchor?.bottom,
    maxHeight: anchor?.maxHeight,
  }

  const panel = picking ? (
    // Not `role="menu"` while the filter is in it: a menu may only contain
    // menu items, and a textbox inside one is read out by some screen readers
    // and skipped by others. A dialog holding a field and a menu is the same
    // thing to look at and an honest description of it.
    <div
      ref={menuRef}
      id={menuId}
      role="dialog"
      aria-label={`Move ${page.title}`}
      onKeyDown={onMenuKeyDown}
      className={panelClass}
      style={panelStyle}
    >
      {/* A wiki has more pages than fit in a popup, and scrolling a list of
          them with the keyboard is the slow way to a page whose name is
          already known. */}
      <input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter pages…"
        aria-label={`Filter destinations for ${page.title}`}
        className={`${INPUT} mb-1`}
      />
      <div
        role="menu"
        aria-label={`Destinations for ${page.title}`}
        className="max-h-64 overflow-y-auto scroll-slim"
      >
        {shown.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-fg-subtle">no page matches</div>
        ) : (
          shown.map((target) => (
            <button
              key={target.slug ?? ''}
              type="button"
              role="menuitem"
              onClick={() => send({ parentSlug: target.slug, order: null })}
              className={itemClass}
              style={{ paddingLeft: `${10 + target.depth * 12}px` }}
            >
              {target.slug === null ? null : <PageIcon className="size-3.5 opacity-60" />}
              <span className="truncate">{target.title}</span>
            </button>
          ))
        )}
      </div>
    </div>
  ) : (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={`Move ${page.title}`}
      onKeyDown={onMenuKeyDown}
      className={panelClass}
      style={panelStyle}
    >
      {entries.map((entry) => (
        <button
          key={entry.direction}
          type="button"
          role="menuitem"
          disabled={entry.move === null}
          onClick={() => entry.move && send(entry.move)}
          className={itemClass}
        >
          <span className="truncate">{entry.label}</span>
        </button>
      ))}
      <div className="my-1 h-px bg-line" />
      <button
        type="button"
        role="menuitem"
        disabled={targets.length === 0}
        onClick={() => setPicking(true)}
        className={itemClass}
      >
        <span className="truncate">Move to…</span>
      </button>
    </div>
  )

  return (
    <div className="shrink-0">
      <button
        type="button"
        ref={triggerRef}
        disabled={busy || !available}
        aria-label={`Move ${page.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={
          available
            ? `Move ${page.title}`
            : `${page.title} is the only page in this space — there is nowhere to move it`
        }
        onClick={() => (open ? close(true) : openMenu())}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          openMenu()
        }}
        className={`mr-1 flex size-5 items-center justify-center rounded text-fg-subtle hover:bg-surface-selected hover:text-fg focus-visible:opacity-100 disabled:opacity-30 ${
          open
            ? 'opacity-100'
            : // Hover reveals it for a mouse, focus-within for the keyboard —
              // tabbing to the row's link brings its controls with it. A
              // coarse pointer has neither, so there it is simply always on.
              'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100'
        }`}
      >
        <MoveIcon className="size-3.5" />
      </button>

      {/* Out of the tree and into the body, for two reasons that both make the
          menu unusable where it hurts most. The tree scrolls in an
          `overflow-y-auto` container, which clips anything absolutely
          positioned inside it — a row in the lower part of the bar would open
          a menu with its bottom half, the destination list, cut away. And
          every row is a `draggable` element, so a press inside the menu
          (selecting filter text, sliding onto an entry) would be handed to the
          row as the start of a drag. Positioned against the window instead,
          the panel is neither clipped nor part of the drag source. */}
      {open ? createPortal(panel, document.body) : null}
    </div>
  )
}
