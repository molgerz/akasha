// @vitest-environment jsdom
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * The trust gate, mounted for real (CON-46).
 *
 * The load-bearing assertion is the negative one: for a host nobody has
 * approved, mounting the shell calls **neither** `fetch` **nor**
 * `client.want`. Those two are the whole disclosure — `client.want` opens the
 * WebSocket, on which `NostrClient.automaticallyAuth` answers the relay's
 * NIP-42 challenge with an event signed by the reader's key, and `fetch` asks
 * `https://<host>` for the NIP-11 document. Both are fired from effects inside
 * `useRelay`, which is why the gate has to keep the hook from being called at
 * all rather than ignore what it returns; a test that only looked at the
 * rendered markup would pass just as happily with the socket open behind it.
 *
 * Signed in on purpose: that is the case where following a link costs the
 * reader a signed statement of who they are.
 */
vi.mock('../../session/session', () => ({
  SessionProvider: ({ children }: { children: unknown }) => children,
  useSession: () => ({
    session: {
      status: 'signed-in',
      pubkey: 'a'.repeat(64),
      npub: 'npub1example',
      profile: null,
      signer: {},
    },
    extension: 'available',
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    ensureSamePubkey: vi.fn(),
    applyProfile: vi.fn(),
  }),
}))

import { AppShell } from './AppShell'
import { ThemeProvider } from '../../theme/theme'
import { client } from '../../nostr/client'
import { isTrustedRelay, trustRelay } from '../../nostr/known-relays'
import { useSpaceRoute } from '../../routes/space-route'

const SPACE_MARKER = 'the space itself'

/**
 * Stands in for `SpaceSettingsRoute` at `/settings/spaces/:group`: that route
 * reads the same `group` parameter through the same `useSpaceRoute` — and so
 * the same `useSpace` — which is the only reason the settings exemption needs
 * testing at all. The real screen is not mounted because its own contents are
 * beside the point here; what is being measured is what the address alone can
 * reach.
 */
function SettingsSpaceProbe() {
  const { relayUrl } = useSpaceRoute()
  return <div>{`settings route for [${relayUrl}]`}</div>
}

let root: Root | null = null
let want: ReturnType<typeof vi.spyOn>
let fetchMock: ReturnType<typeof vi.fn>
let socket: ReturnType<typeof vi.fn>

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function render(path: string) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/s/:group" element={<div>{SPACE_MARKER}</div>} />
              <Route path="/settings/spaces" element={<div />} />
              <Route path="/settings/spaces/:group" element={<SettingsSpaceProbe />} />
              <Route path="*" element={<div>not found</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )
  })
  await act(async () => {
    await flush()
  })
}

function text(): string {
  return document.body.textContent ?? ''
}

function buttonSaying(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === label,
  )
  if (!found) throw new Error(`no button labelled "${label}" — page says: ${text()}`)
  return found
}

beforeEach(() => {
  localStorage.clear()
  // jsdom implements neither, and ThemeProvider/useRelay want both.
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  fetchMock = vi.fn().mockResolvedValue({ ok: false })
  vi.stubGlobal('fetch', fetchMock)
  // Mocked rather than merely observed: a real want() would start connecting,
  // and the point of the test is that nothing does.
  want = vi.spyOn(client, 'want').mockReturnValue(() => {})
  // The socket itself, one level below `client.want`. `want` is the only path
  // the shell is *supposed* to open a connection through, so watching it alone
  // would miss a regression that reaches the pool some other way — a store
  // subscribing without a hold, for instance.
  socket = vi.fn()
  vi.stubGlobal('WebSocket', socket)
})

/** Every relay url anything tried to reach, by either route. */
function contacted(): string[] {
  return [...want.mock.calls, ...socket.mock.calls, ...fetchMock.mock.calls].map((call) =>
    String(call[0]),
  )
}

afterEach(async () => {
  if (root) {
    const current = root
    await act(async () => current.unmount())
    root = null
  }
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('AppShell: a space link naming an unfamiliar relay', () => {
  it('asks first, and until it is answered contacts nothing at all', async () => {
    await render(`/s/${encodeURIComponent("relay.example'team")}`)

    expect(text()).toContain('Connect to relay.example?')
    // the space behind the link stays unmounted — it holds relay hooks of its own
    expect(text()).not.toContain(SPACE_MARKER)

    expect(want, 'no WebSocket may be opened before the reader agrees').not.toHaveBeenCalled()
    expect(fetchMock, 'no NIP-11 fetch may be made before the reader agrees').not.toHaveBeenCalled()
    expect(socket, 'and none by any other route either').not.toHaveBeenCalled()
  })

  it('connects once the reader confirms, and remembers the host', async () => {
    await render(`/s/${encodeURIComponent("relay.example'team")}`)
    expect(isTrustedRelay('relay.example')).toBe(false)

    await act(async () => {
      buttonSaying('Connect').click()
    })
    await act(async () => {
      await flush()
    })

    expect(text()).toContain(SPACE_MARKER)
    expect(want).toHaveBeenCalledWith('wss://relay.example')
    // "Remember this relay" is checked by default, so the next visit is silent
    expect(isTrustedRelay('relay.example')).toBe(true)
  })

  it('does not remember the host when the box is unchecked', async () => {
    await render(`/s/${encodeURIComponent("relay.example'team")}`)

    const box = document.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(box.checked, 'remembering is the default').toBe(true)
    await act(async () => {
      box.click()
    })
    await act(async () => {
      buttonSaying('Connect').click()
    })
    await act(async () => {
      await flush()
    })

    expect(text()).toContain(SPACE_MARKER)
    expect(want).toHaveBeenCalledWith('wss://relay.example')
    expect(isTrustedRelay('relay.example')).toBe(false)
  })

  it('asks again for a host already remembered under a different port', async () => {
    // Remembered first, or this asserts nothing about ports: the decision is
    // keyed by the exact host, so approving relay.example says nothing about
    // whatever answers on relay.example:8443.
    trustRelay('relay.example')

    await render(`/s/${encodeURIComponent("relay.example:8443'team")}`)

    expect(text()).toContain('Connect to relay.example:8443?')
    expect(text()).not.toContain(SPACE_MARKER)
    expect(want, 'another port is another host').not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('AppShell: links that never reach the prompt', () => {
  it('opens a remembered host straight away — asking once means once', async () => {
    // The promise the whole feature makes: the answer survives the visit it
    // was given in. Here it is a fresh mount reading the stored decision, not
    // the in-memory `allowedOnce` set from a prompt earlier in the same run.
    trustRelay('relay.example')

    await render(`/s/${encodeURIComponent("relay.example'team")}`)

    expect(text()).not.toContain('Connect to')
    expect(text()).toContain(SPACE_MARKER)
    expect(want).toHaveBeenCalledWith('wss://relay.example')
  })

  it('does not prompt for the local dev relay — that workflow stays frictionless', async () => {
    await render(`/s/${encodeURIComponent("localhost:8080'team")}`)

    expect(text()).not.toContain('Connect to')
    expect(text()).toContain(SPACE_MARKER)
    expect(want).toHaveBeenCalledWith('ws://localhost:8080')
  })

  it('lets /settings/spaces/:group through ungated — and it still reaches nothing', async () => {
    // That route reuses the `group` param, so a hand-written settings link can
    // carry a host nobody approved. It is exempt from the gate on purpose: an
    // interstitial in front of the settings navigation would buy no privacy,
    // because nothing there discloses anything.
    //
    // Why it discloses nothing — the part that is an invariant rather than a
    // fact about today's markup: the settings route holds no `useRelay`, so
    // nobody calls `client.want` for that host, and `useSpace` on its own
    // cannot reach a socket because `SpaceStore.start()` returns at
    // `if (!connection.ready)` (src/nostr/space-store.ts) for a connection
    // nothing ever asked for. A change that wires a relay through the settings
    // route, or that lets a store subscribe without `want()`, breaks the
    // exemption — and fails here.
    await render(`/settings/spaces/${encodeURIComponent("relay.example'team")}`)

    expect(text()).not.toContain('Connect to relay.example?')
    expect(text()).toContain('settings route for [wss://relay.example]')

    // Host-specific, because the shell does hold the deployment's own relay on
    // every settings page — that one is operator configuration, not link input.
    expect(
      contacted().filter((url) => url.includes('relay.example')),
      'nothing may reach the host the link named',
    ).toEqual([])
  })

  it('refuses an unreadable address without touching a relay for it', async () => {
    // No apostrophe, so parseGroupAddress returns null. This used to fall back
    // to DEFAULT_RELAY_URL and connect there in order to draw an error.
    await render('/s/not-an-address')

    expect(text()).toContain('This link is not a space address')
    expect(text()).not.toContain(SPACE_MARKER)
    expect(want, 'an unreadable address names no relay').not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
