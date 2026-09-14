import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AkashaMark } from '../AkashaMark'
import { ThemeToggle } from '../ThemeToggle'
import { UserChip } from '../UserChip'
import { IconButton } from '../controls'
import { PanelLeftIcon, SearchIcon } from '../icons'
import { RelayIndicator } from '../RelayStatusBadge'
import type { RelaySnapshot } from '../../nostr/client'
import type { RelayInfo } from '../../nostr/relay-status'

/**
 * The global bar. Everything in it is true on every page: the app, the search,
 * the relay you are talking to, the mode, your account. What a *page* can do
 * lives one line below in `PageFrame` — a bar that grows a button per view
 * ends up as a toolbar nobody can read.
 *
 * Three columns rather than a row: the two outer ones share the remaining width
 * equally, so the search sits on the centre line of the window no matter how
 * wide the wordmark or the account chip happen to be. A plain flex row would
 * push it off centre as soon as one side grew — and a display name is exactly
 * the kind of thing that grows.
 *
 * "+ Create" used to stand next to the search here. It moved into the left bar,
 * beside the page tree: creating a page is a thing you do *to a place in the
 * tree*, and next to the tree it can say which place. In the middle of the top
 * bar it could only ever mean "somewhere in this space".
 * docs/06-ui-information-architecture.md
 */
export function Topbar({
  groupBase,
  snapshot,
  info,
  columnHidden,
  onToggleColumn,
  overlayOpen,
  onToggleOverlay,
}: {
  groupBase: string | null
  snapshot: RelaySnapshot
  info: RelayInfo | null
  /** wide screens: the bar is a column that folds away */
  columnHidden: boolean
  onToggleColumn: () => void
  /** narrow screens: the bar is an overlay over the content */
  overlayOpen: boolean
  onToggleOverlay: () => void
}) {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const field = useRef<HTMLInputElement>(null)

  // The shortcut printed in the field has to work, or it is decoration that
  // lies. Ctrl as well as Cmd, because the badge below says whichever the
  // platform uses but the other one costs nothing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      field.current?.focus()
      field.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const mac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform)

  return (
    <header className="grid h-13 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 bg-surface-1 px-3">
      <div className="flex min-w-0 items-center gap-1.5">
        {/* Two buttons in one slot, because the thing being toggled is not
            the same thing at both widths: a column that stays folded across
            reloads, or an overlay that closes on the next navigation. One
            button would have to guess the viewport to name what it does, and
            the label is the whole of what a bare icon says. */}
        {/* Hidden on a wrapper, not on the button: `IconButton` is already
            `inline-flex`, and Tailwind emits that after `hidden`, so a
            `hidden` handed to the button itself loses the cascade and both
            would show at once. */}
        <span className="md:hidden">
          <IconButton
            label={overlayOpen ? 'Close the menu' : 'Open the menu'}
            onClick={onToggleOverlay}
          >
            <PanelLeftIcon className="size-4.5" />
          </IconButton>
        </span>
        <span className="hidden md:block">
          <IconButton
            label={columnHidden ? 'Show the sidebar' : 'Hide the sidebar'}
            onClick={onToggleColumn}
          >
            <PanelLeftIcon className="size-4.5" />
          </IconButton>
        </span>

        <Link
          to="/"
          className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-semibold tracking-[-0.01em] text-fg hover:bg-surface-hover"
        >
          {/* The mark and the wordmark are one link; the mark is aria-hidden,
              so the accessible name stays exactly "Akasha". */}
          <AkashaMark className="size-5" />
          <span className="truncate">Akasha</span>
        </Link>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (groupBase && query.trim().length > 0) {
            navigate(`${groupBase}/search?q=${encodeURIComponent(query.trim())}`)
          }
        }}
        className="relative flex items-center"
      >
        <SearchIcon className="pointer-events-none absolute left-2.5 size-4 text-fg-subtle" />
        <input
          ref={field}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={!groupBase}
          placeholder={groupBase ? 'Search pages' : 'open a space first'}
          aria-label="Search pages"
          className="h-8 w-40 rounded-lg border border-line bg-surface-2 pr-16 pl-8.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:border-line-strong disabled:opacity-60 sm:w-72 md:w-96"
        />
        <kbd className="pointer-events-none absolute right-2 rounded border border-line bg-surface-1 px-1.5 py-0.5 font-sans text-[11px] text-fg-subtle">
          {mac ? '⌘' : 'Ctrl'} K
        </kbd>
      </form>

      <div className="flex min-w-0 items-center justify-end gap-1.5">
        <RelayIndicator snapshot={snapshot} info={info} />
        <div className="hidden sm:block">
          <ThemeToggle />
        </div>
        <UserChip />
      </div>
    </header>
  )
}
