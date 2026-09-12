// @vitest-environment jsdom
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'

vi.mock('../nostr/space-store', () => ({ useSpace: vi.fn() }))
vi.mock('../session/session', () => ({
  SessionProvider: ({ children }: { children: unknown }) => children,
  useSession: vi.fn(),
}))
vi.mock('../nostr/moderation', () => ({ editMetadata: vi.fn() }))
vi.mock('../ui/MemberAdmin', () => ({ MemberAdmin: () => null }))

import { useSpace } from '../nostr/space-store'
import type { SpaceSnapshot } from '../nostr/space-store'
import { useSession } from '../session/session'
import { SpaceSettingsRoute } from './SpaceSettings'

const ADMIN = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

let root: Root
let navigate: ReturnType<typeof useNavigate> | null = null
let snapshots: Record<string, SpaceSnapshot>

function CaptureNavigate() {
  navigate = useNavigate()
  return null
}

function snapshot(name: string, admins: string[]): SpaceSnapshot {
  return {
    loading: false,
    metadata: {
      name,
      about: name + ' about',
      picture: null,
      isPublic: false,
      isOpen: false,
      supportedKinds: [],
    },
    admins: admins.map((pubkey) => ({ pubkey, roles: ['admin'] })),
    members: admins,
    pages: [],
    tree: [],
    comments: [],
    removedRevisions: [],
  }
}

function addressPath(id: string) {
  return '/settings/spaces/' + encodeURIComponent("localhost:8081'" + id)
}

function nameInput(): HTMLInputElement | null {
  return document.querySelector('input')
}

async function render(id: string) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [addressPath(id)] },
        createElement(CaptureNavigate),
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/settings/spaces/:group',
            element: createElement(SpaceSettingsRoute),
          }),
        ),
      ),
    )
  })
}

beforeEach(() => {
  navigate = null
  snapshots = { alpha: snapshot('Alpha', [ADMIN]), beta: snapshot('Beta', [ADMIN]) }
  vi.mocked(useSpace).mockImplementation((_relayUrl, groupId) => snapshots[groupId] ?? snapshots.alpha)
  vi.mocked(useSession).mockReturnValue({
    session: { status: 'signed-in', pubkey: ADMIN, signer: {} },
    extension: 'available',
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    ensureSamePubkey: vi.fn().mockResolvedValue({ ok: true }),
    applyProfile: vi.fn(),
  } as unknown as ReturnType<typeof useSession>)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('SpaceSettings admin gate', () => {
  it('shows the form, prefilled from the relay metadata, to an admin', async () => {
    await render('alpha')
    expect(nameInput()?.value).toBe('Alpha')
  })

  it('refuses the form to a member who is not an admin', async () => {
    snapshots.alpha = snapshot('Alpha', [OTHER])
    await render('alpha')
    expect(document.body.textContent).toContain('Only an admin of this space may change its metadata.')
    expect(nameInput()).toBeNull()
  })

  it("does not carry one space's form into another space", async () => {
    await render('alpha')
    expect(nameInput()?.value).toBe('Alpha')

    await act(async () => {
      navigate?.(addressPath('beta'))
    })

    expect(nameInput()?.value).toBe('Beta')
  })
})
