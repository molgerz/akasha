import { useProfile } from '../nostr/profile-store'
import { displayName, shortNpub, toNpub } from '../nostr/profile'

/**
 * Shows authorship. Product decision (2026-09-11): the name is the primary
 * display everywhere, the npub only a fallback for a key with no profile —
 * never both. `showNpub` can still force the key next to the name where a
 * screen genuinely needs it, but it is off by default; every call site was
 * audited for that in CON-33 and none needed it.
 * docs/06-ui-information-architecture.md
 */
export function Author({
  pubkey,
  avatar = false,
  showNpub = false,
}: {
  pubkey: string
  avatar?: boolean
  showNpub?: boolean
}) {
  const profile = useProfile(pubkey)
  const npub = toNpub(pubkey)
  const name = profile?.displayName ?? profile?.name ?? null

  return (
    <span className="inline-flex items-center gap-1.5" title={npub}>
      {avatar && profile?.picture ? (
        <img
          src={profile.picture}
          alt=""
          className="size-4 rounded-full border border-line object-cover"
        />
      ) : null}
      {name ? <span className="text-fg-muted">{name}</span> : null}
      {showNpub || !name ? (
        <span className="font-mono text-fg-subtle">{shortNpub(npub)}</span>
      ) : null}
    </span>
  )
}

/**
 * Just the name — the shortened npub only when the key has no profile — for
 * text places that cannot use `Author`'s span: a blame cell that already
 * carries the npub in its own `title`, an `<option>`, a sentence. Reads the
 * same store, so the name fills in when a relay answers.
 */
export function AuthorName({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey)
  return <>{displayName(profile, toNpub(pubkey))}</>
}
