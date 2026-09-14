import { observeProfile } from '../nostr/profile-store'
import { shortNpub, toNpub } from '../nostr/profile'

/**
 * The chip a mention is drawn as, and the profile subscription behind it.
 *
 * A module of its own because two widgets draw a mention now: the inline one in
 * the editor (src/ui/markdown-live.ts) and the one in a table cell
 * (src/ui/editor-table.ts). Building that DOM twice would be two answers to
 * "what does a mention look like", and the second one would drift.
 * docs/13-editing.md
 */

/** Unsubscribe handles per chip — see releaseMention. */
const mentionCleanup = new WeakMap<HTMLElement, () => void>()

export function mentionChip(pubkey: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'cm-md-mention'
  const npub = toNpub(pubkey)
  // The npub is what is stored and what identifies the person, so it stays
  // reachable — in the tooltip here, next to the name in the page.
  span.title = npub
  span.textContent = `@${shortNpub(npub)}`
  mentionCleanup.set(
    span,
    observeProfile(pubkey, (profile) => {
      const name = profile?.displayName ?? profile?.name
      span.textContent = `@${name ?? shortNpub(npub)}`
    }),
  )
  return span
}

/** Drop a chip's subscription. The widget's DOM is discarded, never reused. */
export function releaseMention(dom: HTMLElement) {
  mentionCleanup.get(dom)?.()
  mentionCleanup.delete(dom)
}
