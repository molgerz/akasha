// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { PseudonymNotice } from './PseudonymNotice'
import { usePseudonymNotice } from './pseudonym-ack'

/**
 * The three claims the notice has to make — linkable, not undoable, not
 * encrypted — and the one rule about when it appears: once per npub, never for
 * a reader who has not signed in. Pinned here because a notice that quietly
 * stops appearing looks exactly like a notice that was never needed.
 * docs/09-security-privacy.md
 *
 * The second half of the file pins the ways *out*. There is one warning per
 * npub and nothing in the app brings it back, so which gestures spend it is
 * part of the feature, not a detail of the markup.
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

/** The shell's wiring in miniature: the hook decides, the dialog draws. */
function Harness() {
  const notice = usePseudonymNotice()
  return <PseudonymNotice notice={notice} />
}

function render(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<Harness />)
  })
  return host
}

function dialogOf(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[role="dialog"]')
}

/**
 * Sign in and press the button, checking that it really was there to press.
 * `render()` must not be called inside the `act()` that clicks: a nested `act`
 * does not commit until the outer one exits, so the button does not exist yet
 * and `?.click()` quietly does nothing — a test that then asserts the dialog is
 * *shown* passes either way.
 */
function acknowledgeAs(pubkey: string): void {
  signedIn(pubkey)
  const host = render()
  const button = host.querySelector('button')
  expect(button).not.toBeNull()
  act(() => {
    button?.click()
  })
  expect(dialogOf(host)).toBeNull()
}

describe('PseudonymNotice', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
    session.current = { status: 'anonymous' }
  })

  it('says nothing to a reader who is not signed in', () => {
    expect(dialogOf(render())).toBeNull()
  })

  it('names what an npub costs: linkable, not undoable, not encrypted', () => {
    signedIn()
    const text = render().textContent ?? ''
    expect(text).toContain('permanent pseudonym')
    expect(text).toContain('cannot reliably be undone')
    expect(text).toContain('does not encrypt')
    expect(text).toContain(NPUB)
  })

  // Akasha has no public space and no read-only visitor (docs/00), so "anyone
  // who links the npub can read it all" would be false as written. What is
  // true, and what docs/09 actually claims, is linkability: whoever can reach
  // a copy can join it all up.
  it('scopes the linkability claim to whoever can reach the copies', () => {
    signedIn()
    expect(render().textContent ?? '').toContain('Anyone who can reach those copies')
  })

  it('describes itself by the three claims, not only by its title', () => {
    signedIn()
    const host = render()
    const describedBy = dialogOf(host)?.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const body = host.querySelector(`#${describedBy ?? ''}`)
    expect(body?.textContent).toContain('cannot reliably be undone')
  })

  it('stays away on the next visit once it has been acknowledged', () => {
    signedIn()
    const host = render()
    const button = host.querySelector('button')
    expect(button?.textContent).toContain('I understand')
    act(() => {
      button?.click()
    })
    expect(dialogOf(host)).toBeNull()

    expect(dialogOf(render())).toBeNull()
  })

  it('tells a second npub on the same machine, acknowledged or not', () => {
    acknowledgeAs(PUBKEY)

    signedIn('b'.repeat(64))
    expect(dialogOf(render())).not.toBeNull()
  })

  it('does not ask the same npub again after a sign-out and back in', () => {
    acknowledgeAs(PUBKEY)

    session.current = { status: 'anonymous' }
    expect(dialogOf(render())).toBeNull()

    signedIn()
    expect(dialogOf(render())).toBeNull()
  })

  // Escape is the reflex for making a dialog go away. It may close this one —
  // a dialog the keyboard cannot leave is its own problem — but it must not
  // count as having read it, or one keystroke silently spends the only warning
  // this npub ever gets.
  it('closes on Escape without counting that as having been read', () => {
    signedIn()
    const host = render()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(dialogOf(host)).toBeNull()

    expect(dialogOf(render())).not.toBeNull()
  })

  // Same reasoning as Escape: with the button auto-focused, Enter acknowledged
  // it in one keystroke. The dialog takes the focus instead, so the label and
  // the three sentences are read out and Enter has nothing to activate.
  it('focuses the dialog rather than its one button', () => {
    signedIn()
    const host = render()
    expect(document.activeElement).toBe(dialogOf(host))
    expect(document.activeElement).not.toBe(host.querySelector('button'))
  })
})
