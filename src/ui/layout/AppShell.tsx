import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useParams } from 'react-router-dom'
import { Topbar } from './Topbar'
import { SessionNotice } from '../SessionNotice'
import { PseudonymNotice } from '../PseudonymNotice'
import { usePseudonymNotice } from '../pseudonym-ack'
import { Sidebar } from './Sidebar'
import { TableOfContents } from './TableOfContents'
import { TocProvider, useTocMarkdown } from './toc-context'
import { parseGroupAddress } from '../../nostr/group-address'
import { DEFAULT_RELAY_URL, useRelay } from '../../nostr/relay-status'
import { useSpace } from '../../nostr/space-store'

export function AppShell() {
  return (
    <TocProvider>
      <Shell />
    </TocProvider>
  )
}

const SIDEBAR_KEY = 'nc-sidebar-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

function Shell() {
  const params = useParams<{ group?: string }>()
  const location = useLocation()
  // /settings/spaces/:group reuses the `group` param name (so SpaceSettings
  // can share useSpaceRoute with the space's own routes) but is not "inside"
  // that space — the sidebar there is the settings nav, not the page tree.
  const inSettings = location.pathname.startsWith('/settings')
  const group = !inSettings && params.group ? parseGroupAddress(params.group) : null
  const relayUrl = group?.relayUrl ?? DEFAULT_RELAY_URL
  const { snapshot, info } = useRelay(relayUrl)
  const space = useSpace(relayUrl, group?.id ?? '')
  const tocMarkdown = useTocMarkdown()

  // Two separate states for one button. On a wide screen the bar is a column
  // that folds away and stays folded across reloads; on a phone it is an
  // overlay that has to close again after every navigation. Storing one
  // "open" flag for both would either remember an overlay as open on the next
  // page or forget a folded column on the next reload.
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [overlay, setOverlay] = useState(false)

  useEffect(() => setOverlay(false), [location.pathname])

  const toggleColumn = useCallback(() => {
    setCollapsed((value) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, value ? '0' : '1')
      } catch {
        /* then it only applies to this session */
      }
      return !value
    })
  }, [])

  const base = group ? `/s/${encodeURIComponent(`${group.host}'${group.id}`)}` : null

  const notice = usePseudonymNotice()

  return (
    <div className="flex h-full flex-col bg-surface-1">
      {/* `contents`, so the wrapper adds no box and the layout below is
          unchanged — it exists only to carry `inert` for the one dialog that
          may not be worked around. `inert` rather than a focus trap because it
          does all three jobs at once: nothing behind the backdrop takes focus
          (including the top bar's Ctrl/Cmd+K, which would otherwise type into
          a search field the reader cannot see), nothing is tabbable, and the
          whole shell leaves the accessibility tree while the notice is up. */}
      <div className="contents" inert={notice.open}>
        <Topbar
          groupBase={base}
          snapshot={snapshot}
          info={info}
          columnHidden={collapsed}
          onToggleColumn={toggleColumn}
          overlayOpen={overlay}
          onToggleOverlay={() => setOverlay((open) => !open)}
        />
        <SessionNotice />

        <div className="relative flex min-h-0 flex-1">
          {/* Folded away entirely rather than down to a 40px rail of icons. The
              rail had one thing in it that could not be reached elsewhere, the
              relay status — that now sits in the top bar, where it is visible
              whether the bar is open or not. A strip holding a single dot is
              not a narrow sidebar, it is a margin.
              docs/06-ui-information-architecture.md */}
          {collapsed ? null : (
            <div className="hidden md:flex">
              <Sidebar group={group} space={space} snapshot={snapshot} info={info} inSettings={inSettings} />
            </div>
          )}

          {overlay ? (
            <>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOverlay(false)}
                className="fixed inset-0 z-20 bg-black/40 md:hidden"
              />
              <div className="fixed inset-y-0 left-0 z-30 flex md:hidden">
                <Sidebar group={group} space={space} snapshot={snapshot} info={info} inSettings={inSettings} />
              </div>
            </>
          ) : null}

          {/* The canvas. Rounded and inset on the left where it meets the bar, so
              the document sits *on* the chrome instead of being walled off from
              it by a hairline — the one detail that turns three panels into one
              surface. */}
          <main className="min-w-0 flex-1 overflow-auto scroll-slim border-t border-l border-line bg-surface-2 md:rounded-tl-xl">
            <Outlet />
          </main>

          <TableOfContents markdown={tocMarkdown} />
        </div>
      </div>

      {/* Outside the `inert` wrapper — it is the only thing that stays live. */}
      <PseudonymNotice notice={notice} />
    </div>
  )
}
