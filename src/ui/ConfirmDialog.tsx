import { useEffect, useId, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { Button } from './controls'
import type { Variant } from './controls'

/**
 * The app's confirmation. Replaces `window.confirm`, which the browser draws in
 * its own chrome: a system font, the origin above it, and no room for the two
 * or three sentences a consequential action actually has to explain. A
 * confirmation is part of the product, not a pause in it.
 *
 * Built on the native `<dialog>` element rather than a `position: fixed` div,
 * because `showModal()` gives the things a hand-rolled overlay gets wrong: the
 * top layer (so nothing can paint over it), a real `::backdrop`, focus moved
 * in and kept inside, the page behind it inert, and Escape wired up. What is
 * left for us is the look and the two buttons.
 *
 * **Cancel holds the focus**, not the confirming button. Everything this
 * dialog is used for is a change somebody may not have meant to make, and a
 * dialog that answers Return with "yes" turns a stray keypress into the act it
 * was there to guard.
 *
 * jsdom implements the element but none of its behaviour, so a test that
 * renders one needs `src/test/dialog-shim.ts`.
 */
export type ConfirmDialogProps = {
  open: boolean
  title: string
  /** The wording of the act, on the button that performs it — never "OK". */
  confirmLabel: string
  confirmVariant?: Variant
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  children: ReactNode
}

/**
 * Mounted only while it is open, rather than kept in the document and toggled.
 * A closed `<dialog>` is invisible but its content is still there — read by a
 * screen reader in some browsers, found by the page's own text search, and
 * rendered with whatever data it was last given. Mounting on demand means the
 * text in it is always the text of the act being confirmed right now.
 */
export function ConfirmDialog({ open, ...props }: ConfirmDialogProps) {
  if (!open) return null
  return <Dialog {...props} />
}

function Dialog({
  title,
  confirmLabel,
  confirmVariant = 'danger',
  busy = false,
  onConfirm,
  onCancel,
  children,
}: Omit<ConfirmDialogProps, 'open'>) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  // Closing is the caller's business — it unmounts this — so the flag only has
  // to stop `close` from being reported as a cancellation on the way out.
  const closing = useRef(false)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    dialog.showModal()
    return () => {
      closing.current = true
      dialog.close()
    }
  }, [])

  // Escape and the backdrop both end up here.
  const handleClose = () => {
    if (!closing.current) onCancel()
  }

  // The backdrop is not a child, so a click on it reports the dialog itself as
  // the target; anything inside reports the element it landed on.
  const handleClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === ref.current) onCancel()
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={handleClose}
      onClick={handleClick}
      className={
        'm-auto w-[calc(100vw-2rem)] max-w-md rounded-lg border border-line bg-surface-2 p-0 ' +
        'text-fg shadow-lg backdrop:bg-black/40'
      }
    >
      <div className="px-5 pt-5 pb-4">
        <h2 id={titleId} className="text-base font-semibold text-fg">
          {title}
        </h2>
        <div className="mt-2.5 space-y-2.5 text-sm text-fg-muted">{children}</div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line bg-surface-1 px-5 py-3.5">
        <Button autoFocus onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
