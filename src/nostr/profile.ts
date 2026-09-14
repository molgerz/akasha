import { nip19 } from 'nostr-tools'
import type { Event } from 'nostr-tools'

/** Kind 0 content, as far as we display it. All optional — foreign data. */
export type Profile = {
  name?: string
  displayName?: string
  picture?: string
  about?: string
}

export function parseProfile(event: Event): Profile {
  return parseProfileContent(event.content)
}

/** The same parsing without an event — for content we have just written ourselves. */
export function parseProfileContent(content: string): Profile {
  try {
    const raw: unknown = JSON.parse(content)
    if (typeof raw !== 'object' || raw === null) return {}
    const data = raw as Record<string, unknown>
    const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)
    return {
      name: str(data.name),
      displayName: str(data.display_name) ?? str(data.displayName),
      picture: str(data.picture),
      about: str(data.about),
    }
  } catch {
    return {}
  }
}

export function toNpub(pubkeyHex: string): string {
  try {
    return nip19.npubEncode(pubkeyHex)
  } catch {
    return pubkeyHex
  }
}

/**
 * Accepts a key as input: npub or 64 hex characters. Returns the hex pubkey or
 * null — so that a typo does not end up in a moderation event as a valid key.
 */
export function parsePubkeyInput(input: string): string | null {
  const value = input.trim()
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase()
  if (value.startsWith('npub')) {
    try {
      const decoded = nip19.decode(value)
      if (decoded.type === 'npub' && typeof decoded.data === 'string') return decoded.data
    } catch {
      return null
    }
  }
  return null
}

/** npub1abcd…wxyz — short enough for a byline, long enough to compare. */
export function shortNpub(npub: string): string {
  return npub.length > 20 ? `${npub.slice(0, 10)}…${npub.slice(-6)}` : npub
}

/**
 * Display names are freely chosen and not unique. The name is the primary
 * label; the npub is the fallback for a key with no profile, and stays in the
 * tooltip and the revision details for a check.
 * docs/06-ui-information-architecture.md
 */
export function displayName(profile: Profile | null, npub: string): string {
  return profile?.displayName ?? profile?.name ?? shortNpub(npub)
}
