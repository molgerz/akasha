import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Topbar } from './Topbar'
import { SessionNotice } from '../SessionNotice'
import { Sidebar } from './Sidebar'
import { TableOfContents } from './TableOfContents'
import { TocProvider, useTocMarkdown } from './toc-context'
import { InvalidSpaceLink, RelayTrustPrompt } from '../SpaceGate'
import { parseGroupAddress } from '../../nostr/group-address'
import type { GroupAddress } from '../../nostr/group-address'
import { isTrustedRelay, trustRelay } from '../../nostr/known-relays'
import { DEFAULT_RELAY_URL, useRelay } from '../../nostr/relay-status'
import { EMPTY_SPACE, useSpace } from '../../nostr/space-store'
import type { SpaceSnapshot } from '../../nostr/space-store'
import type { RelayInfo } from '../../nostr/relay-status'
import type { RelaySnapshot } from '../../nostr/client'

export function AppShell() {
  return (
    <TocProvider>
      <Shell />
    </TocProvider>
  )
}

/**
 * Why the shell is split in two.
 *
 * The route parameter `/s/<host>'<group>` is chosen by whoever wrote the link,
 * and everything downstream of it used to be automatic: `useRelay` opens a
 * WebSocket to that host and fetches its NIP-11 document, and
 * `NostrClient.automaticallyAuth` answers the relay's NIP-42 challenge with an
 * event signed by the reader's key. Following a link was therefore enough to
 * make a signed-in visitor's browser contact a stranger's host and hand it a
 * signed statement of who they are. CON-46 puts one decision in front of that.
 *
 * Both of those happen in *effects* inside `useRelay`, so "do not connect"
 * cannot mean "call the hook and ignore the answer" — it has to mean the hook
 * is never called. A hook cannot be called conditionally, so the condition
 * moves up one level: `Shell` decides, and `SpaceShell` — which holds every
 * relay-consuming hook, `<Outlet>` included — either mounts or does not.
 *
 * Two independent reasons reach that one mechanism, and they stay apart in the
 * code because they are different things to be told:
 *
 *  - **unreadable** — `<host>'<group>` did not parse. There is no host here to
 *    ask about. Before CON-46 this connected to `DEFAULT_RELAY_URL` anyway and
 *    each view drew an inline "Invalid group address." over the top of it.
 *  - **untrusted** — it parsed, and names a host this browser has no decision
 *    on record for. `src/nostr/known-relays.ts` holds the answers.
 *
 * docs/09-security-privacy.md
 */
type Gate =
  | { kind: 'unreadable'; address: string }
  | { kind: 'untrusted'; group: GroupAddress }

function Shell() {
  const params = useParams<{ group?: string }>()
  const location = useLocation()
  // /settings/spaces/:group reuses the `group` param name (so SpaceSettings
  // can share useSpaceRoute with the space's own routes) but is not "inside"
  // that space — the sidebar there is the settings nav, not the page tree.
  //
  // So a hand-written /settings/spaces/<unapproved host>'group skips the gate.
  // That is deliberate, and it is safe for a reason worth writing down, because
  // it lives outside this file: the settings route calls no `useRelay`, so
  // nothing calls `client.want` for that host, and `useSpace` alone never
  // reaches a socket — `SpaceStore.start()` returns at `if (!connection.ready)`
  // for a connection nobody asked for. Gating it would therefore buy no
  // privacy and would only put an interstitial in front of the settings nav.
  // `AppShell.trust.test.tsx` pins that, so a change which wires a relay
  // through the settings route fails a test rather than quietly connecting.
  const inSettings = location.pathname.startsWith('/settings')
  const address = !inSettings && params.group ? params.group : null

  // Hosts cleared for this visit but not written to storage — "Remember this
  // relay" left unchecked. A set of hosts rather than one flag, so that
  // following a link on to a *different* relay asks again instead of
  // inheriting the answer given about the previous one.
  const [allowedOnce, setAllowedOnce] = useState<ReadonlySet<string>>(() => new Set())

  const group = address !== null ? parseGroupAddress(address) : null
  const gate: Gate | null =
    address === null
      ? null
      : group === null
        ? { kind: 'unreadable', address }
        : isTrustedRelay(group.host) || allowedOnce.has(group.host)
          ? null
          : { kind: 'untrusted', group }

  if (gate !== null) {
    return (
      <ShellFrame group={null} space={EMPTY_SPACE} snapshot={null} info={null} inSettings={false}>
        {gate.kind === 'unreadable' ? (
          <InvalidSpaceLink address={gate.address} />
        ) : (
          <RelayTrustPrompt
            // Keyed by the host so that arriving at a second unfamiliar relay
            // resets the checkbox instead of reusing the state of the prompt
            // the reader just answered about somewhere else.
            key={gate.group.host}
            host={gate.group.host}
            onConnect={(remember) => {
              const host = gate.group.host
              if (remember) trustRelay(host)
              // Recorded here either way: `trustRelay` writes storage, but
              // storage can be blocked, and re-reading it is not what makes
              // this render show the space.
              setAllowedOnce((current) => new Set(current).add(host))
            }}
          />
        )}
      </ShellFrame>
    )
  }

  return <SpaceShell group={group} inSettings={inSettings} />
}

/**
 * Everything that talks to a relay. Mounted only once the address above has
 * been read and cleared — see the `Gate` comment for why that has to be a
 * mounting decision rather than a branch inside one component.
 *
 * `DEFAULT_RELAY_URL` is the fallback for the routes that are not inside a
 * space at all (`/`, `/settings/*`). That is the deployment's own relay,
 * configured at build time rather than named by a link, and it deliberately
 * stays outside the gate.
 */
function SpaceShell({ group, inSettings }: { group: GroupAddress | null; inSettings: boolean }) {
  const relayUrl = group?.relayUrl ?? DEFAULT_RELAY_URL
  const { snapshot, info } = useRelay(relayUrl)
  const space = useSpace(relayUrl, group?.id ?? '')

  return (
    <ShellFrame
      group={group}
      space={space}
      snapshot={snapshot}
      info={info}
      inSettings={inSettings}
    >
      <Outlet />
    </ShellFrame>
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

/**
 * The chrome: top bar, left bar, canvas, table of contents. Purely
 * presentational — it holds no relay state of its own, which is what lets the
 * gate render the same frame around a prompt with `snapshot={null}` (no relay
 * is being talked to, and a status badge claiming otherwise would be the one
 * lie on that screen).
 */
function ShellFrame({
  group,
  space,
  snapshot,
  info,
  inSettings,
  children,
}: {
  group: GroupAddress | null
  space: SpaceSnapshot
  snapshot: RelaySnapshot | null
  info: RelayInfo | null
  inSettings: boolean
  children: ReactNode
}) {
  const location = useLocation()
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

  return (
    <div className="flex h-full flex-col bg-surface-1">
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
          {children}
        </main>

        <TableOfContents markdown={tocMarkdown} />
      </div>
    </div>
  )
}
