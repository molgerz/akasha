import { useEffect, useId, useRef, useState } from 'react'
import type { TreeMove } from '../domain/move-tree'
import type { Page } from '../domain/pages'
import { moveEntries } from './move-page'
import { MoveIcon } from './icons'

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
 * order and under a finger; its entries are the four steps an outline editor
 * has. Reimplementing the drag on pointer events would have given touch a
 * gesture and the keyboard still nothing.
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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const entries = moveEntries(pages, page.slug)
  const available = entries.some((entry) => entry.move !== null)

  const close = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  // Opening puts the focus on the first entry that can actually be used: a
  // menu that opens with nothing focused is a menu the keyboard has to find
  // its way into first.
  useEffect(() => {
    if (!open) return
    const first = menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')
    first?.focus()
  }, [open])

  // Clicking anywhere else closes it. `pointerdown` rather than `click`, so
  // the menu is gone before whatever was clicked reacts — otherwise a click on
  // another row's trigger closes this menu and opens nothing.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])].filter(
      (item) => !item.disabled,
    )
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    // Wrapping, because a four-entry menu with two of them disabled is one
    // keypress from either end whichever way it wraps.
    items[(at + step + items.length) % items.length]!.focus()
  }

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
            : `${page.title} is the only page at its level — there is nowhere to move it`
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
          className="absolute top-6 right-0 z-30 w-56 rounded-lg border border-line bg-surface-2 p-1 shadow-lg"
        >
          {entries.map((entry) => (
            <button
              key={entry.direction}
              type="button"
              role="menuitem"
              disabled={entry.move === null}
              onClick={() => {
                if (!entry.move) return
                close(true)
                onMove(entry.move)
              }}
              className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-sm text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:bg-surface-hover focus-visible:text-fg disabled:pointer-events-none disabled:opacity-40"
            >
              <span className="truncate">{entry.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
