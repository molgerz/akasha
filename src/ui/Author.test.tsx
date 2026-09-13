// @vitest-environment jsdom
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { nip19 } from 'nostr-tools'
import type { ReactNode } from 'react'

// The store asks a relay for an uncached key on mount; keep the test off the
// network. Every key used here is cached first, so nothing is fetched anyway.
vi.mock('../nostr/client', () => ({ client: { subscribeAcross: vi.fn(() => () => {}) } }))

import { Author, AuthorName } from './Author'
import { cacheProfile } from '../nostr/profile-store'

const PUBKEY = '1'.repeat(64)
const NPUB = nip19.npubEncode(PUBKEY)

function render(node: ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(node)
  })
  return host
}

/**
 * CON-33: the name is primary everywhere, the npub only a fallback for a key
 * with no profile — the Author default used to show both.
 */
describe('Author', () => {
  it('shows the name alone by default', () => {
    cacheProfile(PUBKEY, { displayName: 'Alice' })
    const host = render(<Author pubkey={PUBKEY} />)
    expect(host.textContent).toBe('Alice')
    expect(host.querySelector('span[title]')?.getAttribute('title')).toBe(NPUB)
  })

  it('still puts the npub next to the name when showNpub is asked for', () => {
    cacheProfile(PUBKEY, { displayName: 'Alice' })
    const host = render(<Author pubkey={PUBKEY} showNpub />)
    expect(host.textContent).toContain('Alice')
    expect(host.textContent).toContain(NPUB.slice(0, 10))
  })

  it('prints just the name through AuthorName', () => {
    cacheProfile(PUBKEY, { displayName: 'Alice' })
    const host = render(<AuthorName pubkey={PUBKEY} />)
    expect(host.textContent).toBe('Alice')
  })
})
