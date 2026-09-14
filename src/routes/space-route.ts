import { useParams } from 'react-router-dom'
import { parseGroupAddress } from '../nostr/group-address'
import type { GroupAddress } from '../nostr/group-address'
import { useSpace } from '../nostr/space-store'
import type { SpaceSnapshot } from '../nostr/space-store'

export type SpaceRoute = {
  group: GroupAddress | null
  /** empty string when the address does not parse — there is no relay then */
  relayUrl: string
  space: SpaceSnapshot
  /** Base for links inside the space, e.g. /s/host'group */
  base: string | null
  slug: string | null
}

/**
 * Reads the group address from the route and returns the matching space.
 * The store is shared per (relay, group), so calling this several times
 * creates no extra subscriptions.
 */
export function useSpaceRoute(): SpaceRoute {
  const params = useParams<{ group?: string; slug?: string }>()
  const group = params.group ? parseGroupAddress(params.group) : null
  // Deliberately no fall back to DEFAULT_RELAY_URL. An address that does not
  // parse names no relay, and standing in the deployment's own relay for it
  // was a connection nobody asked for — made, in the end, only so the view
  // above could draw "Invalid group address." on top of it (CON-46). Every
  // caller guards on `group` before it touches a relay, and `useSpace` with an
  // empty group id subscribes to nothing, so the empty string never reaches a
  // socket. docs/09-security-privacy.md
  const relayUrl = group?.relayUrl ?? ''
  const space = useSpace(relayUrl, group?.id ?? '')
  return {
    group,
    relayUrl,
    space,
    base: group ? `/s/${encodeURIComponent(`${group.host}'${group.id}`)}` : null,
    slug: params.slug ?? null,
  }
}
