// @vitest-environment jsdom
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { installDialogShim } from '../test/dialog-shim'

installDialogShim()

vi.mock('../nostr/space-store', () => ({ useSpace: vi.fn(), forgetEvent: vi.fn() }))
vi.mock('../session/session', () => ({ useSession: vi.fn() }))
vi.mock('../nostr/publish-page', () => ({ publishRevision: vi.fn() }))
vi.mock('../nostr/moderation', () => ({ deleteGroupEvent: vi.fn() }))
// Stubbed for what they pull in, not for what they do: the profile store opens
// its own relay connection, and PageFrame renders through a portal.
vi.mock('../ui/Author', () => ({
  Author: () => null,
  AuthorName: () => null,
}))
vi.mock('../ui/DiffView', () => ({ DiffView: () => null }))
vi.mock('../ui/layout/PageFrame', () => ({
  PageFrame: ({ children }: { children?: ReactNode }) => children,
  PageTitle: ({ children }: { children?: ReactNode }) => children,
}))

import { useSpace } from '../nostr/space-store'
import type { SpaceSnapshot } from '../nostr/space-store'
import { useSession } from '../session/session'
import { publishRevision } from '../nostr/publish-page'
import { buildPages } from '../domain/pages'
import type { Revision } from '../domain/revision'
import { HistoryView } from './HistoryView'

const ME = 'a'.repeat(64)
const GROUP = 'engineering'

let root: Root

function revision(): Revision {
  return {
    id: 'r1',
    author: ME,
    createdAt: 1000,
    group: GROUP,
    slug: 'notes',
    title: 'Release notes',
    parentSlug: null,
    order: null,
    parentRevs: [],
    summary: null,
    content: 'the release notes',
    archived: false,
  }
}

function snapshot(): SpaceSnapshot {
  return {
    loading: false,
    metadata: {
      name: 'Engineering',
      about: null,
      picture: null,
      isPublic: false,
      isOpen: false,
      supportedKinds: [],
    },
    admins: [],
    members: [ME],
    pages: buildPages([revision()]),
    tree: [],
    comments: [],
  }
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label,
  )
  if (!found) throw new Error(`no button labelled "${label}"`)
  return found as HTMLButtonElement
}

async function click(label: string) {
  await act(async () => {
    button(label).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/**
 * The whole gesture: the button at the foot only opens the confirmation, and
 * the act itself is the button inside it. Going through both is the point —
 * a test that called the handler directly would pass while the dialog was
 * wired to nothing. src/ui/ConfirmDialog.tsx
 */
async function archivePage() {
  await click('Archive this page')
  await click('Archive the page')
}

async function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [`/s/${encodeURIComponent(`localhost:8081'${GROUP}`)}/notes/history`] },
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

beforeEach(() => {
  vi.mocked(useSpace).mockReturnValue(snapshot())
  vi.mocked(useSession).mockReturnValue({
    session: { status: 'signed-in', pubkey: ME, signer: {} },
    ensureSamePubkey: async () => ({ ok: true }),
  } as unknown as ReturnType<typeof useSession>)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/**
 * The archive flow reports its failures through `useArchivePage`'s own state.
 * Reading that back off the hook object *after* awaiting `setArchived` returns
 * the value from the render the click handler was created in — always the
 * previous attempt's. These two cases pin the symptoms that produced: a failure
 * with no message at all, and a success carrying the last failure's message.
 */
describe('HistoryView: archiving a page that the relay refuses', () => {
  it('shows the relay reason instead of failing silently', async () => {
    vi.mocked(publishRevision).mockResolvedValue({ ok: false, reason: 'blocked: not a member' })
    await render()

    await archivePage()

    expect(document.body.textContent).toContain('blocked: not a member')
    expect(document.body.textContent).toContain('That did not work')
  })

  it('does not carry the failed attempt into the next, successful one', async () => {
    vi.mocked(publishRevision).mockResolvedValue({ ok: false, reason: 'blocked: not a member' })
    await render()
    await archivePage()

    vi.mocked(publishRevision).mockResolvedValue({ ok: true, message: 'ok' })
    await archivePage()

    expect(document.body.textContent).not.toContain('blocked: not a member')
    expect(document.body.textContent).not.toContain('That did not work')
    expect(document.body.textContent).toContain('The page is archived')
  })
})

/**
 * Both flows on this page write to the same notice. A fixed headline meant the
 * archive confirmation was announced as a deletion — the one thing the whole
 * feature is built not to claim. docs/05-versioning-history.md
 */
describe('HistoryView: the success notice', () => {
  it('does not announce an archived page as a deletion', async () => {
    vi.mocked(publishRevision).mockResolvedValue({ ok: true, message: 'ok' })
    await render()

    await archivePage()

    expect(document.body.textContent).toContain('The page is archived')
    expect(document.body.textContent).not.toContain('Deletion requested')
  })
})

/**
 * The confirmation replaced `window.confirm`, and with it the one thing that
 * made "cancel" safe for free: a blocking call that simply returned false.
 * Now cancelling is a state change, and nothing stops a rewiring that opens
 * the dialog and archives the page anyway. docs/05-versioning-history.md
 */
describe('HistoryView: the archive confirmation', () => {
  it('says what it is about to do before it does it', async () => {
    await render()
    expect(document.body.textContent).not.toContain('Archive "Release notes"?')

    await click('Archive this page')

    expect(document.body.textContent).toContain('Archive "Release notes"?')
    expect(document.body.textContent).toContain('Nothing is deleted')
    expect(publishRevision).not.toHaveBeenCalled()
  })

  it('publishes nothing when it is cancelled', async () => {
    await render()
    await click('Archive this page')
    await click('Cancel')

    expect(publishRevision).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('Archive "Release notes"?')
  })
})
