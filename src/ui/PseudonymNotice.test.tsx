// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { PseudonymNotice } from './PseudonymNotice'

/**
 * The three claims the notice has to make — linkable, not undoable, not
 * encrypted — and the one rule about when it appears: once per npub, never for
 * a reader who has not signed in. Pinned here because a notice that quietly
 * stops appearing looks exactly like a notice that was never needed.
 * docs/09-security-privacy.md
 */
const session = vi.hoisted(() => ({
  current: { status: 'anonymous' } as Record<string, unknown>,
}))

vi.mock('../session/session', () => ({
  useSession: () => ({ session: session.current }),
}))

const PUBKEY = 'a'.repeat(64)
const NPUB = `npub1${'1'.repeat(58)}`

function signedIn(pubkey = PUBKEY): void {
  session.current = { status: 'signed-in', pubkey, npub: NPUB }
}

function render(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<PseudonymNotice />)
  })
  return host
}

describe('PseudonymNotice', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
    session.current = { status: 'anonymous' }
  })

  it('says nothing to a reader who is not signed in', () => {
    expect(render().querySelector('[role="dialog"]')).toBeNull()
  })

  it('names what an npub costs: linkable, not undoable, not encrypted', () => {
    signedIn()
    const text = render().textContent ?? ''
    expect(text).toContain('permanent pseudonym')
    expect(text).toContain('cannot reliably be undone')
    expect(text).toContain('does not encrypt')
    expect(text).toContain(NPUB)
  })

  it('stays away on the next visit once it has been acknowledged', () => {
    signedIn()
    const host = render()
    const button = host.querySelector('button')
    expect(button?.textContent).toContain('I understand')
    act(() => {
      button?.click()
    })
    expect(host.querySelector('[role="dialog"]')).toBeNull()

    expect(render().querySelector('[role="dialog"]')).toBeNull()
  })

  it('tells a second npub on the same machine, acknowledged or not', () => {
    signedIn()
    act(() => {
      render().querySelector('button')?.click()
    })

    signedIn('b'.repeat(64))
    expect(render().querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('closes on Escape, and counts that as having been read', () => {
    signedIn()
    const host = render()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(render().querySelector('[role="dialog"]')).toBeNull()
  })
})
