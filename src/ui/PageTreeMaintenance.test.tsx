// @vitest-environment jsdom
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'

vi.mock('../session/session', () => ({ useSession: vi.fn() }))
vi.mock('../nostr/publish-placement', () => ({ publishPlacement: vi.fn() }))
vi.mock('../nostr/publish-deletion', () => ({ publishPlacementDeletion: vi.fn() }))
vi.mock('../nostr/client', () => ({ classifyRejection: vi.fn(() => 'other') }))

import { useSession } from '../session/session'
import { publishPlacement } from '../nostr/publish-placement'
import { publishPlacementDeletion } from '../nostr/publish-deletion'
import { PageTreeMaintenance } from './PageTreeMaintenance'
import { buildPages } from '../domain/pages'
import type { Page } from '../domain/pages'
import type { Placement } from '../domain/placement'
import type { Revision } from '../domain/revision'

const ME = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

let root: Root

function revision(slug: string, order: string | null): Revision {
  return {
    id: slug,
    author: ME,
    createdAt: 1000,
    group: 'engineering',
    slug,
    title: slug,
    parentSlug: null,
    order,
    parentRevs: [],
    summary: null,
    content: '',
    tombstone: false,
  }
}

/** A top level where every page carries a key, so a sort has work for each. */
function keyedLevel(...slugs: string[]): Page[] {
  return buildPages(slugs.map((slug, index) => revision(slug, `k${index}`)))
}

function orphan(slug: string, author: string): Placement {
  return { slug, parentSlug: null, order: null, author, createdAt: 1000, id: slug }
}

function render(props: {
  pages?: Page[]
  orphanPlacements?: Placement[]
  loading?: boolean
}): void {
  act(() => {
    root.render(
      createElement(PageTreeMaintenance, {
        relayUrl: 'ws://localhost:8080',
        groupId: 'engineering',
        pages: props.pages ?? [],
        orphanPlacements: props.orphanPlacements ?? [],
        loading: props.loading ?? false,
      }),
    )
  })
}

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')]
}

function button(label: string): HTMLButtonElement {
  const found = buttons().find((entry) => entry.textContent?.includes(label))
  if (!found) throw new Error(`no button "${label}" in: ${document.body.textContent}`)
  return found
}

async function click(element: HTMLButtonElement): Promise<void> {
  await act(async () => {
    element.click()
  })
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root') as HTMLElement)
  vi.mocked(useSession).mockReturnValue({
    session: { status: 'signed-in', pubkey: ME, npub: 'npub', signer: {}, profile: null },
    ensureSamePubkey: async () => ({ ok: true }),
  } as unknown as ReturnType<typeof useSession>)
  vi.mocked(publishPlacement).mockResolvedValue({ ok: true } as Awaited<
    ReturnType<typeof publishPlacement>
  >)
  vi.mocked(publishPlacementDeletion).mockResolvedValue({ ok: true } as Awaited<
    ReturnType<typeof publishPlacementDeletion>
  >)
})

afterEach(() => {
  act(() => root.unmount())
  vi.clearAllMocks()
})

describe('sorting a level', () => {
  it('rewrites one placement per page that carries a key', async () => {
    render({ pages: keyedLevel('alpha', 'bravo', 'charlie') })
    await click(button('Sort by title'))

    expect(vi.mocked(publishPlacement)).toHaveBeenCalledTimes(3)
    expect(vi.mocked(publishPlacement).mock.calls[0][1]).toMatchObject({
      groupId: 'engineering',
      order: null,
    })
    expect(document.body.textContent).toContain('3 pages now sort by title')
  })

  it('stops at the first refusal and says what had already landed', async () => {
    // There is no batch signing, so a stopped run is not an untouched one:
    // reporting only the refusal would let somebody believe the level was
    // left alone when it is half sorted, and they would not know to run it
    // again. Four pages, refused on the second.
    vi.mocked(publishPlacement)
      .mockResolvedValueOnce({ ok: true } as Awaited<ReturnType<typeof publishPlacement>>)
      .mockResolvedValueOnce({ ok: false, reason: 'refused by the relay' } as Awaited<
        ReturnType<typeof publishPlacement>
      >)

    render({ pages: keyedLevel('alpha', 'bravo', 'charlie', 'delta') })
    await click(button('Sort by title'))

    expect(vi.mocked(publishPlacement)).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('refused by the relay')
    expect(document.body.textContent).toContain('1 of 4')
    expect(document.body.textContent).toContain('half sorted')
  })

  it('reports a cancelled signature without claiming anything was written', async () => {
    vi.mocked(publishPlacement).mockRejectedValueOnce(new Error('user rejected'))

    render({ pages: keyedLevel('alpha', 'bravo') })
    await click(button('Sort by title'))

    expect(document.body.textContent).toContain('user rejected')
    expect(document.body.textContent).not.toContain('had already been rewritten')
  })

  it('offers nothing to sign for a level that already sorts by its titles', () => {
    render({ pages: buildPages([revision('alpha', null), revision('bravo', null)]) })
    expect(button('Sort by title').disabled).toBe(true)
  })
})

describe('stale placements', () => {
  it('offers only the ones the signed-in key can actually remove', async () => {
    render({ orphanPlacements: [orphan('gone', ME), orphan('also-gone', OTHER)] })

    await click(button('Clean up 1 of mine'))

    expect(vi.mocked(publishPlacementDeletion)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(publishPlacementDeletion).mock.calls[0][1]).toMatchObject({
      slug: 'gone',
      author: ME,
    })
    expect(document.body.textContent).toContain('signed by somebody else')
  })

  it('offers no button at all when none of them are the viewer own', () => {
    // A disabled "Clean up 0 of mine" offers an action that does not exist
    // here; the sentence about whose they are is the whole answer.
    render({ orphanPlacements: [orphan('also-gone', OTHER)] })
    expect(buttons().some((entry) => entry.textContent?.includes('Clean up'))).toBe(false)
    expect(document.body.textContent).toContain('also-gone')
  })
})

describe('while the space is still loading', () => {
  it('offers neither action, because a page that has not arrived looks gone', () => {
    // Revisions and placements arrive on separate subscriptions. In the window
    // between them every placement has a slug with no revisions, so the orphan
    // list would name live pages — and cleaning up would drop their positions.
    render({
      pages: keyedLevel('alpha'),
      orphanPlacements: [orphan('not-in-yet', ME)],
      loading: true,
    })

    expect(buttons()).toHaveLength(0)
    expect(document.body.textContent).not.toContain('not-in-yet')
    expect(document.body.textContent).toContain('Still reading this space')
  })
})
