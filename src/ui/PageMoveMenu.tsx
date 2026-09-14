import { useEffect, useId, useRef, useState } from 'react'
import type { TreeMove } from '../domain/move-tree'
import type { Page } from '../domain/pages'
import { moveEntries, moveTargets } from './move-page'
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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const entries = moveEntries(pages, page.slug)
  const targets = moveTargets(pages, page.slug)
  const available = entries.some((entry) => entry.move !== null) || targets.length > 0

  const needle = filter.trim().toLowerCase()
  const shown = needle ? targets.filter((t) => t.title.toLowerCase().includes(needle)) : targets

  const close = () => {
    setOpen(false)
    setPicking(false)
    setFilter('')
    triggerRef.current?.focus()
  }

  const send = (move: TreeMove) => {
    close()
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

  // Clicking anywhere else closes it. `pointerdown` rather than `click`, so it
  // is gone before whatever was clicked reacts — otherwise a click on another
  // row's trigger closes this menu and opens nothing.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
      setPicking(false)
      setFilter('')
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // Not swallowed by the sidebar or a parent: this is the innermost thing
      // Escape can mean while the menu is up.
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []),
    ].filter((item) => !item.disabled)
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    // Wrapping: a four-entry menu with two of them disabled is one keypress
    // from either end whichever way it wraps. From the filter field (index -1)
    // ArrowDown therefore lands on the first row, which is what it looks like
    // it should do.
    items[(at + step + items.length) % items.length]!.focus()
  }

  const itemClass =
    'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm text-fg-muted ' +
    'hover:bg-surface-hover hover:text-fg focus-visible:bg-surface-hover focus-visible:text-fg ' +
    'disabled:pointer-events-none disabled:opacity-40'

  return (
    <div className="relative shrink-0">
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
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          setOpen(true)
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

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Move ${page.title}`}
          onKeyDown={onMenuKeyDown}
          className="absolute top-6 right-0 z-30 w-60 rounded-lg border border-line bg-surface-2 p-1 shadow-lg"
        >
          {picking ? (
            <>
              {/* A wiki has more pages than fit in a popup, and scrolling a
                  list of them with the keyboard is the slow way to a page
                  whose name is already known. */}
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter pages…"
                aria-label={`Filter destinations for ${page.title}`}
                className={`${INPUT} mb-1`}
              />
              <div className="max-h-64 overflow-y-auto scroll-slim">
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
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
