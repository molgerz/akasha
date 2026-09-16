// @vitest-environment jsdom
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../nostr/space-store', () => ({ useSpace: vi.fn() }))
vi.mock('../session/session', () => ({ useSession: vi.fn() }))
// The crumbs are the subject, so the frame is the one thing rendered honestly:
// it reports the labels it was handed. Everything else is stubbed for what it
// drags in — markdown rendering, the comment subscription, the profile store.
vi.mock('../ui/layout/PageFrame', () => ({
  PageFrame: ({ crumbs, children }: { crumbs?: { label: string }[]; children?: ReactNode }) =>
    createElement(
      'div',
      null,
      createElement('nav', { 'data-testid': 'crumbs' }, (crumbs ?? []).map((crumb) => crumb.label).join(' / ')),
      children,
    ),
  PageTitle: ({ children }: { children?: ReactNode }) => children,
}))
vi.mock('../ui/Markdown', () => ({ Markdown: () => null }))
vi.mock('../ui/Comments', () => ({ Comments: () => null }))
vi.mock('../ui/Byline', () => ({ Byline: () => null }))
vi.mock('../ui/Author', () => ({ Author: () => null, AuthorName: () => null }))
vi.mock('../ui/layout/toc-context', () => ({ useTocSource: () => {} }))

import { useSpace } from '../nostr/space-store'
import type { SpaceSnapshot } from '../nostr/space-store'
import { useSession } from '../session/session'
import { buildPages } from '../domain/pages'
import type { Revision } from '../domain/revision'
import { PageView } from './PageView'

const ME = 'a'.repeat(64)
const GROUP = 'engineering'

let root: Root

function rev(
  slug: string,
  title: string,
  parentSlug: string | null,
  extra: Partial<Revision> = {},
): Revision {
  return {
    id: slug,
    author: ME,
    createdAt: 1000,
    group: GROUP,
    slug,
    title,
    parentSlug,
    order: null,
    parentRevs: [],
    summary: null,
    content: 'text',
    archived: false,
    ...extra,
  }
}

function snapshot(revisions: Revision[]): SpaceSnapshot {
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
    pages: buildPages(revisions),
    tree: [],
    comments: [],
  }
}

async function render(slug: string) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [`/s/${encodeURIComponent(`localhost:8081'${GROUP}`)}/${slug}`] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/s/:group/:slug', element: createElement(PageView) }),
        ),
      ),
    )
  })
}

function crumbs(): string {
  return document.querySelector('[data-testid="crumbs"]')?.textContent ?? ''
}

beforeEach(() => {
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
 * `buildTree` lifts the children of an archived page to the top level, so the
 * sidebar shows no parent for them. A breadcrumb still leading into that parent
 * would be the same tree described two different ways on one screen.
 * src/domain/pages.ts, docs/06-ui-information-architecture.md
 */
describe('PageView breadcrumbs and an archived parent', () => {
  it('shows the parent while it is visible', async () => {
    vi.mocked(useSpace).mockReturnValue(
      snapshot([rev('handbook', 'Handbook', null), rev('onboarding', 'Onboarding', 'handbook')]),
    )
    await render('onboarding')

    expect(crumbs()).toBe('Engineering / Handbook / Onboarding')
  })

  it('stops at an archived parent, as the tree does', async () => {
    vi.mocked(useSpace).mockReturnValue(
      snapshot([
        rev('handbook', 'Handbook', null),
        rev('handbook', 'Handbook', null, {
          id: 'handbook-gone',
          createdAt: 2000,
          parentRevs: ['handbook'],
          archived: true,
        }),
        rev('onboarding', 'Onboarding', 'handbook'),
      ]),
    )
    await render('onboarding')

    expect(crumbs()).toBe('Engineering / Onboarding')
  })
})
