// @vitest-environment jsdom
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../nostr/space-store', () => ({ useSpace: vi.fn(), forgetEvent: vi.fn() }))
vi.mock('../session/session', () => ({
  SessionProvider: ({ children }: { children: unknown }) => children,
  useSession: vi.fn(),
}))
vi.mock('../nostr/publish-deletion', () => ({ publishRevisionDeletion: vi.fn() }))
vi.mock('../nostr/publish-page', () => ({ publishRevision: vi.fn() }))
vi.mock('../nostr/moderation', () => ({ deleteGroupEvent: vi.fn() }))
// The byline resolves names through the profile store, which would open a
// WebSocket to VITE_PROFILE_RELAYS. Nothing here asserts on a name.
vi.mock('../ui/Author', () => ({
  Author: () => null,
  AuthorName: () => null,
}))

import { useSpace } from '../nostr/space-store'
import type { SpaceSnapshot } from '../nostr/space-store'
import { useSession } from '../session/session'
import { publishRevisionDeletion } from '../nostr/publish-deletion'
import { buildPages, buildTree } from '../domain/pages'
import type { Revision } from '../domain/revision'
import { HistoryView } from './HistoryView'

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const GROUP = 'engineering'
const SLUG = 'onboarding'

let root: Root
let space: SpaceSnapshot

function revision(partial: Partial<Revision> & { id: string }): Revision {
  return {
    author: ALICE,
    createdAt: 1000,
    group: GROUP,
    slug: SLUG,
    title: 'Onboarding',
    parentSlug: null,
    order: null,
    parentRevs: [],
    summary: null,
    content: 'hello',
    ...partial,
  }
}

/** A space snapshot whose pages are derived the way the store derives them. */
function snapshot(revisions: Revision[], removed: Set<string> = new Set()): SpaceSnapshot {
  const pages = buildPages(revisions, new Map(), removed)
  return {
    loading: false,
    metadata: {
      name: 'Engineering',
      about: '',
      picture: null,
      isPublic: false,
      isOpen: false,
      supportedKinds: [],
    },
    admins: [],
    members: [ALICE, BOB],
    pages,
    tree: buildTree(pages),
    comments: [],
    removedRevisions: revisions.filter((entry) => removed.has(entry.id)),
  }
}

async function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const path = `/s/${encodeURIComponent(`localhost:8081'${GROUP}`)}/${SLUG}/history`
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/s/:group/:slug/history',
            element: createElement(HistoryView),
          }),
        ),
      ),
    )
  })
}

function buttonLabelled(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined
}

beforeEach(() => {
  space = snapshot([
    revision({ id: 'r1', createdAt: 100 }),
    revision({ id: 'r2', createdAt: 200, parentRevs: ['r1'] }),
  ])
  vi.mocked(useSpace).mockImplementation(() => space)
  vi.mocked(useSession).mockReturnValue({
    session: { status: 'signed-in', pubkey: ALICE, signer: {} },
    ensureSamePubkey: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as ReturnType<typeof useSession>)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('HistoryView — requesting deletion of one’s own revision', () => {
  it('offers the action on one’s own revision', async () => {
    await render()
    expect(buttonLabelled('Request deletion')).toBeDefined()
  })

  it('never offers it on someone else’s revision', async () => {
    space = snapshot([
      revision({ id: 'r1', createdAt: 100, author: BOB }),
      revision({ id: 'r2', createdAt: 200, author: BOB, parentRevs: ['r1'] }),
    ])
    await render()
    expect(buttonLabelled('Request deletion')).toBeUndefined()
  })

  it('never offers it to a signed-out reader', async () => {
    vi.mocked(useSession).mockReturnValue({
      session: { status: 'signed-out' },
      ensureSamePubkey: vi.fn(),
    } as unknown as ReturnType<typeof useSession>)
    await render()
    expect(buttonLabelled('Request deletion')).toBeUndefined()
  })

  // The wording is the ticket's own requirement: the relay may keep the event,
  // so the result may never be reported as a deletion that happened.
  it('asks first and reports the result as a request, not as a deletion', async () => {
    vi.mocked(publishRevisionDeletion).mockResolvedValue({ ok: true, message: 'accepted' })
    await render()

    await act(async () => {
      buttonLabelled('Request deletion')?.click()
    })

    expect(window.confirm).toHaveBeenCalledOnce()
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain('request, not a guarantee')
    expect(publishRevisionDeletion).toHaveBeenCalledOnce()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Deletion requested — not a guarantee')
    expect(text).toContain('copies')
    expect(text).not.toMatch(/revision (was|is) deleted/i)
  })

  it('publishes nothing when the confirmation is declined', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    await render()

    await act(async () => {
      buttonLabelled('Request deletion')?.click()
    })

    expect(publishRevisionDeletion).not.toHaveBeenCalled()
  })

  it('reports a relay rejection instead of hiding it', async () => {
    vi.mocked(publishRevisionDeletion).mockResolvedValue({
      ok: false,
      reason: 'restricted: not allowed',
    })
    await render()

    await act(async () => {
      buttonLabelled('Request deletion')?.click()
    })

    expect(document.body.textContent).toContain('restricted: not allowed')
  })
})

describe('HistoryView — a page whose revisions were removed', () => {
  it('says a revision of this page was removed', async () => {
    space = snapshot(
      [
        revision({ id: 'r1', createdAt: 100 }),
        revision({ id: 'r2', createdAt: 200, parentRevs: ['r1'] }),
      ],
      new Set(['r1']),
    )
    await render()
    expect(document.body.textContent).toContain('Removed by their authors')
  })

  // Removing the last revision drops the page itself, which is exactly when
  // the explanation matters most: without it the view says only "No revisions
  // for this slug", as if the page had never existed.
  it('still explains the removal when the page has no revisions left', async () => {
    space = snapshot([revision({ id: 'r1', createdAt: 100 })], new Set(['r1']))
    await render()
    expect(space.pages).toEqual([])
    const text = document.body.textContent ?? ''
    expect(text).toContain('Removed by their authors')
    expect(text).toContain('may still hold a copy')
  })
})
