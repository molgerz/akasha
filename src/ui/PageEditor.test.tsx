// @vitest-environment jsdom
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'

vi.mock('../session/session', () => ({ useSession: vi.fn() }))
vi.mock('../nostr/publish-page', () => ({ publishRevision: vi.fn() }))
vi.mock('../nostr/publish-placement', () => ({ publishPlacement: vi.fn() }))
vi.mock('../nostr/client', () => ({ classifyRejection: vi.fn(() => 'other') }))
vi.mock('../nostr/profile-store', () => ({ displayNameOrNpub: (pubkey: string) => pubkey }))
// CodeMirror and the header portal are the frame's business, not this rule's:
// the editor is stood in for so the test is about which saves are allowed.
vi.mock('./MarkdownEditor', () => ({
  MarkdownEditor: ({ value }: { value: string }) => createElement('div', null, value),
}))
vi.mock('./layout/PageFrame', () => ({
  HeaderActions: ({ children }: { children: unknown }) =>
    createElement('div', null, children as ReactElement),
}))

import { useSession } from '../session/session'
import { publishRevision } from '../nostr/publish-page'
import { PageEditor } from './PageEditor'
import type { Page } from '../domain/pages'
import type { Revision } from '../domain/revision'

const AUTHOR = 'a'.repeat(64)

let root: Root

function revision(id: string, slug: string, title: string): Revision {
  return {
    id,
    author: AUTHOR,
    createdAt: 1,
    group: 'engineering',
    slug,
    title,
    parentSlug: null,
    order: null,
    parentRevs: [],
    summary: null,
    content: `${title} body`,
  }
}

function pageOf(slug: string, title: string): Page {
  const head = revision(`rev-${slug}`, slug, title)
  return { slug, title, parentSlug: null, order: null, head, revisions: [head], leaves: [head] }
}

function titleInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('#title')
  if (!input) throw new Error('no title field')
  return input
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!found) throw new Error(`no button labelled "${label}"`)
  return found
}

async function renderEditor(props: {
  page?: Page
  pages?: Page[]
  onOpenPage?: (slug: string) => void
} = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(PageEditor, {
        relayUrl: 'ws://localhost:8081',
        groupId: 'engineering',
        pages: props.pages ?? [],
        page: props.page,
        onOpenPage: props.onOpenPage,
        onSaved: () => {},
        onCancel: () => {},
      }),
    )
  })
}

beforeEach(() => {
  vi.mocked(useSession).mockReturnValue({
    session: { status: 'signed-in', pubkey: AUTHOR, signer: {} },
    extension: 'available',
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    ensureSamePubkey: vi.fn().mockResolvedValue({ ok: true }),
    applyProfile: vi.fn(),
  } as unknown as ReturnType<typeof useSession>)
  vi.mocked(publishRevision).mockResolvedValue({ ok: true } as never)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('a new page on a slug that already exists', () => {
  it('refuses to publish, and says which page owns the heading', async () => {
    const existing = pageOf('handbook', 'Handbook')
    await renderEditor({ pages: [existing] })

    await act(async () => {
      type(titleInput(), 'Handbook')
    })

    // The conflict is visible before Publish is pressed at all.
    expect(document.body.textContent).toContain('already uses the slug “handbook”')

    await act(async () => {
      button('Publish').click()
    })

    expect(publishRevision).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('already exists in this space')
    expect(document.body.textContent).toContain('“Handbook”')
  })

  it('refuses a heading that only normalises into the taken slug', async () => {
    await renderEditor({ pages: [pageOf('handbook', 'Handbook')] })

    await act(async () => {
      type(titleInput(), 'HANDBOOK ')
    })
    await act(async () => {
      button('Publish').click()
    })

    expect(publishRevision).not.toHaveBeenCalled()
  })

  it('offers the existing page as the way out', async () => {
    const onOpenPage = vi.fn()
    await renderEditor({ pages: [pageOf('handbook', 'Handbook')], onOpenPage })

    await act(async () => {
      type(titleInput(), 'Handbook')
    })
    await act(async () => {
      button('Open “Handbook” instead').click()
    })

    expect(onOpenPage).toHaveBeenCalledWith('handbook')
  })
})

describe('what a collision must not break', () => {
  it('lets a new page through when only the heading matches, not the slug', async () => {
    await renderEditor({ pages: [pageOf('handbook-old', 'Handbook')] })

    await act(async () => {
      type(titleInput(), 'Handbook')
    })

    expect(document.body.textContent).not.toContain('already uses the slug')
    await act(async () => {
      button('Publish').click()
    })

    expect(publishRevision).toHaveBeenCalledTimes(1)
    expect(vi.mocked(publishRevision).mock.calls[0]![1].parentRevs).toEqual([])
  })

  it('still appends to the page it opened on', async () => {
    const existing = pageOf('handbook', 'Handbook')
    await renderEditor({ page: existing, pages: [existing] })

    await act(async () => {
      button('Publish').click()
    })

    expect(publishRevision).toHaveBeenCalledTimes(1)
    const input = vi.mocked(publishRevision).mock.calls[0]![1]
    expect(input.slug).toBe('handbook')
    expect(input.parentRevs).toEqual([existing.head.id])
  })
})
