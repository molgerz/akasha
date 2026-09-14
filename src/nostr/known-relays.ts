import { isLocalRelayHost } from './group-address'
import { DEFAULT_RELAY_URL } from './relay-status'

/**
 * Which relay hosts this browser has agreed to talk to.
 *
 * A space carries its relay in its own address — `/s/<host>'<group>` — so a
 * link decides, on its author's behalf, which host the reader's browser opens
 * a WebSocket to, fetches a NIP-11 document from over HTTPS, and answers a
 * NIP-42 challenge from with an event signed by the reader's key. Following a
 * link is not consent to any of that, so an unfamiliar host is asked about
 * once and the answer is remembered here.
 * docs/09-security-privacy.md
 *
 * Keyed by the bare host — the exact `GroupAddress.host`, e.g.
 * `relay.example` or `relay.example:8443` — and never by a relay URL. The
 * scheme is *derived* from the host (`isLocalRelayHost` decides `ws` vs
 * `wss`), so carrying it in the key would only give one decision two
 * spellings, and a `ws://` entry could then look like consent a `wss://`
 * entry never gave.
 */
const STORAGE_KEY = 'nc-trusted-relays'

/**
 * Hosts reach this module from `GroupAddress.host`, which `normalizeHost`
 * has already lowercased. Lowercasing again anyway keeps the predicate
 * correct on its own, the way `isLocalRelayHost` does — a decider whose
 * answer depends on who called it is the harder kind of bug to see.
 */
function key(host: string): string {
  return host.toLowerCase()
}

function hostOf(relayUrl: string): string | null {
  try {
    return new URL(relayUrl).host.toLowerCase()
  } catch {
    return null
  }
}

/**
 * The relay the deployment itself is configured with. It is build-time
 * operator configuration, not link input, so it is trusted without ever being
 * stored — see `isTrustedRelay`.
 */
const DEFAULT_RELAY_HOST = hostOf(DEFAULT_RELAY_URL)

/**
 * One defensive read, like `readCollapsed()` in `AppShell` and the theme
 * bootstrap: `localStorage` throws outright in some private-window
 * configurations, and the value is editable by hand, so anything that is not
 * an array of strings counts as "nothing remembered" rather than as a reason
 * to take the whole app down with it.
 */
function readTrusted(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

function writeTrusted(hosts: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hosts))
  } catch {
    /* then the decision only holds for as long as this page is open */
  }
}

/**
 * Whether the app may open a connection to this host without asking.
 *
 * Two kinds of host are trusted by construction, with nothing in storage:
 *
 *  - **Loopback.** Asked through `isLocalRelayHost` rather than re-tested
 *    here: CON-45 is what a second, inline copy of that rule costs. It keeps
 *    the dev workflow free of the prompt — `scripts/dev-relay-up.sh` puts a
 *    relay on `localhost:8080` and nobody should have to click through an
 *    interstitial to reach it.
 *  - **The host of `DEFAULT_RELAY_URL`.** That is `VITE_RELAY_URL`, chosen by
 *    whoever built and deployed the app. Operator configuration is not link
 *    input, and asking the reader to approve their own deployment's relay
 *    would teach them to click "Connect" without reading it.
 */
export function isTrustedRelay(host: string): boolean {
  const wanted = key(host)
  if (isLocalRelayHost(wanted)) return true
  if (DEFAULT_RELAY_HOST !== null && wanted === DEFAULT_RELAY_HOST) return true
  return readTrusted().includes(wanted)
}

/**
 * Remember the host across reloads.
 *
 * Trusting a host twice is trusting it once: React runs effects twice under
 * StrictMode, and a confirm button can be clicked twice before the view
 * changes. The early return also keeps the two implicitly-trusted kinds of
 * host out of storage, so nothing accumulates an entry that says what
 * `isTrustedRelay` already knows.
 */
export function trustRelay(host: string): void {
  if (isTrustedRelay(host)) return
  writeTrusted([...readTrusted(), key(host)])
}

/**
 * Take a remembered decision back, so the host is asked about again.
 *
 * It cannot revoke the two implicit kinds above — those are not decisions
 * stored here, and a `forgetRelay('localhost:8080')` that appeared to work
 * would be the worse outcome.
 *
 * No screen calls this yet, so revoking an approval currently means clearing
 * the site's data — which drops every other decision too. The half that is
 * missing is a "Trusted relays" list under `/settings/profile`, and it is
 * deliberately not in CON-46; the gap is written down under "Residual risk" in
 * docs/09-security-privacy.md rather than left for a reader to discover.
 */
export function forgetRelay(host: string): void {
  const wanted = key(host)
  writeTrusted(readTrusted().filter((entry) => entry !== wanted))
}
