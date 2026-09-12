import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { mentionUri } from '../nostr/mentions'
import { peekProfile, primeProfiles } from '../nostr/profile-store'
import { shortNpub, toNpub } from '../nostr/profile'
import { searchEmoji } from './emoji'

/**
 * The `@` and `:` dropdowns: people and emoji. The editor's third dropdown,
 * the `/` insert menu, lives next to this file in `src/ui/editor-slash.ts`.
 *
 * Both are anchored to a word boundary. Without that guard `@` would fire
 * inside an e-mail address and `:` inside `https://` or `12:30` — the sort of
 * false positive that makes an editor feel like it is fighting you.
 * docs/13-editing.md
 *
 * Both are declared synchronous rather than as `CompletionSource`, which also
 * allows a promise: everything they need is already in memory, and the type
 * says so.
 */
export type SyncSource = (context: CompletionContext) => CompletionResult | null


/**
 * People from the space. What is written into the text is the `nostr:` URI, not
 * the name — see `src/nostr/mentions.ts` for why.
 */
export function mentionCompletion(members: () => string[]): SyncSource {
  return (context: CompletionContext): CompletionResult | null => {
    const before = context.matchBefore(/(?:^|[\s(])@[\p{L}\p{N}_.-]*$/u)
    if (!before) return null

    const at = before.text.lastIndexOf('@')
    const from = before.from + at
    const query = before.text.slice(at + 1).toLowerCase()

    const pubkeys = members()
    if (pubkeys.length === 0) return null
    // Names arrive asynchronously; asking here means the second attempt at the
    // same mention can search by name even if the first could not.
    primeProfiles(pubkeys)

    const options: Completion[] = []
    for (const pubkey of pubkeys) {
      const profile = peekProfile(pubkey)
      const npub = toNpub(pubkey)
      const name = profile?.displayName ?? profile?.name ?? null
      const haystack = `${name ?? ''} ${npub}`.toLowerCase()
      if (query.length > 0 && !haystack.includes(query)) continue
      options.push({
        label: `@${name ?? shortNpub(npub)}`,
        // A display name is neither unique nor stable, so the key it stands for
        // is shown next to it — the same rule as in every byline.
        // docs/06-ui-information-architecture.md
        detail: shortNpub(npub),
        apply: `${mentionUri(pubkey)} `,
        type: 'keyword',
        // Named accounts first: an unresolved npub is a worse guess than a
        // name that actually matched.
        boost: name ? 1 : 0,
      })
    }
    if (options.length === 0) return null

    return { from, to: before.to, options, filter: false }
  }
}

/** `:smi` → 😄. The character is inserted, never the shortcode. */
export const emojiCompletion: SyncSource = (context: CompletionContext) => {
  const before = context.matchBefore(/(?:^|[\s(]):[a-z0-9_+-]*$/i)
  if (!before) return null

  const colon = before.text.lastIndexOf(':')
  const query = before.text.slice(colon + 1)
  // A lone colon opens nothing — it is punctuation far more often than it is
  // the start of an emoji.
  if (query.length === 0 && !context.explicit) return null

  const matches = searchEmoji(query.toLowerCase(), 14)
  if (matches.length === 0) return null

  return {
    from: before.from + colon,
    to: before.to,
    filter: false,
    options: matches.map((emoji) => ({
      label: `:${emoji.name}:`,
      // The point of the dropdown is seeing the emoji, not reading its name.
      displayLabel: `${emoji.char}  ${emoji.name}`,
      apply: emoji.char,
      type: 'text',
    })),
  }
}
