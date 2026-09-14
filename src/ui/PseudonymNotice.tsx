import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../session/session'
import { Button } from './controls'
import { acknowledge, readAcknowledged } from './pseudonym-ack'

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
 */
export function PseudonymNotice() {
  const { session } = useSession()
  const pubkey = session.status === 'signed-in' ? session.pubkey : null
  const npub = session.status === 'signed-in' ? session.npub : null

  const [acknowledged, setAcknowledged] = useState(readAcknowledged)

  const open = pubkey !== null && !acknowledged.has(pubkey)

  const dismiss = useCallback(() => {
    if (!pubkey) return
    setAcknowledged(acknowledge(pubkey))
  }, [pubkey])

  // Escape closes it like any other dialog. It is a notice, not a consent
  // form: there is nothing to withhold, so the two ways out do the same thing.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, dismiss])

  if (!open) return null

  return (
    // No dismiss on the backdrop. Everything else in the app closes when you
    // click beside it; this one asks for the single deliberate click that says
    // the sentence above was read.
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pseudonym-notice-title"
        className="max-h-full w-full max-w-lg overflow-auto scroll-slim rounded-lg border border-line bg-surface-2 p-6 shadow-lg"
      >
        <h2 id="pseudonym-notice-title" className="text-base font-semibold text-fg">
          Your npub is a permanent pseudonym
        </h2>

        <div className="mt-3 space-y-3 text-sm text-fg-muted">
          <p>
            Every revision you save is signed with your key and carries your npub. It stays
            attached to what you wrote — across every page, every space and every relay that
            ever holds a copy. Anyone who learns once which npub is you can read back
            everything it has ever written.
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
          {/* The button, not the dialog, takes the focus: a screen reader
              then reads the dialog's label and its one action, and Enter
              dismisses it without a tab. */}
          <Button autoFocus variant="primary" onClick={dismiss}>
            I understand
          </Button>
        </div>
      </div>
    </div>
  )
}
