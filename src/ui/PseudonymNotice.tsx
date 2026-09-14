import { useEffect, useRef } from 'react'
import { Button } from './controls'
import type { PseudonymNoticeState } from './pseudonym-ack'

/**
 * What an npub costs, said once, before the first revision is written under it.
 *
 * docs/09 puts this plainly: an npub is a permanent pseudonym, everything
 * posted under it is linkable across relays, and in a team where npubs map to
 * real names that is a public activity history. It also says where it belongs —
 * "on the app's onboarding page, not in the fine print".
 *
 * There is no onboarding page and deliberately no sign-in page either (see
 * `SignInButton`), so the moment has to come to the reader: a dialog on the
 * first sign-in with a given npub. A dismissible banner under the top bar was
 * the cheaper option and is the wrong one — a strip that can be scrolled past
 * *is* the fine print, and this is the one thing the app has to say before
 * somebody signs something that cannot be taken back.
 *
 * It appears on a resumed session too, not only on a fresh `login()` click.
 * The question the storage answers is "has this npub been told", and somebody
 * who was already signed in when this shipped has not been.
 *
 * The state comes in from `usePseudonymNotice` rather than being read here,
 * because the shell needs the one bit this dialog knows: while it is up,
 * everything behind it is `inert`. A dialog that says `aria-modal` while the
 * page behind it still takes focus is lying to a screen reader — and
 * concretely, the top bar's Ctrl/Cmd+K would otherwise put the caret in a
 * search field hidden under the backdrop.
 */
export function PseudonymNotice({ notice }: { notice: PseudonymNoticeState }) {
  const { open, npub, confirm, defer } = notice
  const dialog = useRef<HTMLDivElement>(null)

  // Escape closes it, because a dialog a keyboard cannot leave is its own
  // accessibility problem — but it does *not* record the npub as told. Escape
  // is the trained reflex for making a dialog go away, and the app has exactly
  // one warning per npub to spend; a reflex must not be able to spend it. So
  // this way out lasts until the next load, and only the button is final.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') defer()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, defer])

  // The dialog takes the focus, not its button. A screen reader then reads the
  // label and the three sentences it is described by, and — the reason it is
  // not `autoFocus` on the button any more — Enter has nothing to activate.
  // One keystroke on a focused "I understand" is as reflexive as Escape.
  useEffect(() => {
    if (open) dialog.current?.focus()
  }, [open])

  if (!open) return null

  return (
    // No dismiss on the backdrop. Everything else in the app closes when you
    // click beside it; this one asks for the single deliberate click that says
    // the sentence above was read.
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pseudonym-notice-title"
        aria-describedby="pseudonym-notice-body"
        className="max-h-full w-full max-w-lg overflow-auto scroll-slim rounded-lg border border-line bg-surface-2 p-6 shadow-lg outline-none"
      >
        <h2 id="pseudonym-notice-title" className="text-base font-semibold text-fg">
          Your npub is a permanent pseudonym
        </h2>

        <div id="pseudonym-notice-body" className="mt-3 space-y-3 text-sm text-fg-muted">
          <p>
            Every revision you save is signed with your key and carries your npub. It stays
            attached to what you wrote — across every page, every space and every relay that
            ever holds a copy. Anyone who can reach those copies and learns once which npub
            is you can read back everything it has written.
          </p>
          <p>
            Publishing cannot reliably be undone. Deleting is a request to the relay, not a
            guarantee: copies elsewhere may remain.
          </p>
          <p>
            A private space restricts who may read it, it does not encrypt. Its members — and
            whoever runs the relay — see everything in plain text.
          </p>
          {npub ? (
            <p className="text-fg-subtle">
              You are writing as <span className="font-mono break-all">{npub}</span>.
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={confirm}>
            I understand
          </Button>
        </div>
      </div>
    </div>
  )
}
