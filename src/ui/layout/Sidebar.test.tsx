// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

// The bar is wired to the relay through these two only; what this file is
// about is which controls a row carries, so neither is allowed to connect.
vi.mock('../../session/session', () => ({ useSession: vi.fn() }))
vi.mock('../../nostr/publish-placement', () => ({ publishPlacement: vi.fn() }))
vi.mock('../../nostr/client', () => ({ classifyRejection: vi.fn(() => 'other') }))

import { useSession } from '../../session/session'
import { publishPlacement } from '../../nostr/publish-placement'
import { buildPages, buildTree } from '../../domain/pages'
import { planMove } from '../../domain/move-tree'
import type { Revision } from '../../domain/revision'
import type { SpaceSnapshot } from '../../nostr/space-store'
import type { RelaySnapshot } from '../../nostr/client'
import { Sidebar } from './Sidebar'

/**
 * That a page can be moved without a pointer is only true if the control is
 * actually on the rows. `PageMoveMenu.test.tsx` pins what the menu does; this
 * pins that the tree puts one on every row, and only for somebody who may
 * publish — the two halves nothing else asserts together.
 */
const VIEWER = 'a'.repeat(64)
/** Only an identity for the publish call to carry — nothing here signs. */
const SIGNER = { name: 'test signer' }

function rev(slug: string, parentSlug: string | null): Revision {
  return {
    id: `${slug}-1`,
    author: VIEWER,
    createdAt: 1,
    group: 'engineering',
    slug,
    title: slug.toUpperCase(),
    parentSlug,
    order: null,
    parentRevs: [],
    summary: null,
    content: '',
  }
}

const PAGES = buildPages([rev('a', null), rev('b', null), rev('x', 'b')])

const SPACE: SpaceSnapshot = {
  loading: false,
  metadata: {
    name: 'Engineering',
    about: null,
    picture: null,
    isPublic: false,
    isOpen: false,
    supportedKinds: [1818],
  },
  admins: [],
  members: [VIEWER],
  pages: PAGES,
  tree: buildTree(PAGES),
  comments: [],
}

const RELAY: RelaySnapshot = {
  url: 'ws://localhost:8080/',
  connection: 'online',
  attempts: 0,
  auth: 'ok',
  epoch: 1,
  ready: true,
}

let root: Root | null = null

function render(signedIn: boolean) {
  vi.mocked(useSession).mockReturnValue({
    session: signedIn
      ? { status: 'signed-in', pubkey: VIEWER, signer: SIGNER }
      : { status: 'signed-out' },
    ensureSamePubkey: vi.fn(async () => ({ ok: true })),
  } as unknown as ReturnType<typeof useSession>)

  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={['/s/localhost:8080%27engineering']}>
        <Sidebar
          group={{ host: 'localhost:8080', id: 'engineering', relayUrl: 'ws://localhost:8080' }}
          space={SPACE}
          snapshot={RELAY}
          info={null}
          inSettings={false}
        />
      </MemoryRouter>,
    )
  })
  return host
}

const moveButtons = (host: HTMLElement) =>
  [...host.querySelectorAll('button')].filter((button) =>
    button.getAttribute('aria-label')?.startsWith('Move '),
  )

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('Sidebar', () => {
  it('gives every page row a move button somebody signed in can tab to', () => {
    const host = render(true)
    expect(moveButtons(host).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Move A',
      'Move B',
      'Move X',
    ])
    // Not hidden from the keyboard behind the hover that reveals it, and not
    // a div dressed as a button.
    for (const button of moveButtons(host)) {
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('aria-haspopup')).toBe('menu')
      expect(button.hasAttribute('disabled')).toBe(false)
    }
  })

  it('offers nobody signed out a control that could only fail', () => {
    expect(moveButtons(render(false))).toHaveLength(0)
  })

  it('publishes the placement the menu planned, without a pointer anywhere', async () => {
    // The whole ticket in one path: keyboard to the trigger, keyboard into the
    // menu, keyboard onto the entry — and a `31818` on the way out carrying
    // exactly what `planMove` worked out. Nothing else asserts that the menu
    // is wired to `useMovePage` at all rather than merely rendered next to it.
    vi.mocked(publishPlacement).mockResolvedValue({ ok: true } as Awaited<
      ReturnType<typeof publishPlacement>
    >)
    const host = render(true)
    const button = moveButtons(host).find(
      (candidate) => candidate.getAttribute('aria-label') === 'Move A',
    )!

    act(() => {
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    const down = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === 'Move down',
    ) as HTMLButtonElement
    await act(async () => {
      down.click()
    })

    expect(publishPlacement).toHaveBeenCalledWith(
      SIGNER,
      expect.objectContaining({
        slug: 'a',
        parentSlug: null,
        order: planMove(PAGES, 'a', 'down')!.order,
      }),
    )
  })
})
