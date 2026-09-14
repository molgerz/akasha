/**
 * A NIP-29 group is identified as `<relay-host>'<group-id>` — the relay is
 * part of the identity. In URLs this form is URL-encoded.
 * docs/04-permissions-nip29.md
 */
export type GroupAddress = {
  /** e.g. localhost:8080 */
  host: string
  /** e.g. engineering */
  id: string
  /** the relay's ws:// or wss:// URL */
  relayUrl: string
}

/**
 * The hosts a plaintext `ws://` connection is acceptable for: the developer's
 * own machine. Anchored at both ends, because a prefix test is what let
 * `localhost.evil.example` — a name anyone can register — resolve to `ws://`
 * (CON-45). The host reaches us from the route `/s/<host>'<group>`, so it is
 * attacker-choosable through a link, and `NostrClient` signs a NIP-42 AUTH
 * event on connect: an unencrypted connection puts the signed-in user's
 * pubkey on the wire in the clear.
 *
 * `[::1]` is in the set on purpose: a dev relay bound to IPv6 is reached as
 * `[::1]:8080` and is no less local than `127.0.0.1`.
 *
 * The port is only shape-checked here (`\d{1,5}` still admits `:99999`);
 * `normalizeHost` is what rejects an out-of-range port.
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/

/**
 * Whether this host may be reached over plaintext `ws://`. Exported so every
 * place that needs the distinction asks the same question — a second, inline
 * copy of the condition is exactly how CON-45 started.
 *
 * Lowercases first so the predicate is correct on its own; hosts coming out
 * of `normalizeHost` are already lowercase.
 */
export function isLocalRelayHost(host: string): boolean {
  return LOCAL_HOST.test(host.toLowerCase())
}

/**
 * Validates the shape of the host part and returns it canonicalised, or null.
 *
 * Round-tripping through `URL` rather than matching a regex: the parser is
 * the same one the platform uses, so whatever it reads as the host is what a
 * connection would actually go to. Anything that makes those two disagree is
 * rejected — `evil.example/#@real-relay.example` parses to host
 * `evil.example` and only *reads* as the real relay — and paths, queries,
 * userinfo, whitespace and out-of-range ports fail the same way.
 *
 * Only ASCII hostnames are accepted: `URL` punycodes a Unicode name, so
 * `exämple.example` no longer equals its input and is rejected. IDN is out of
 * scope here rather than silently half-supported.
 *
 * A default port written out (`example.com:443`) is dropped by `URL` and so
 * rejected too — a needless way to write the address, and not worth a special
 * case inside a security check.
 */
function normalizeHost(host: string): string | null {
  if (host.length === 0) return null
  try {
    const url = new URL(`https://${host}`)
    // the host carries no path/query/userinfo; URL also normalises case
    return url.host === host.toLowerCase() ? url.host : null
  } catch {
    return null
  }
}

/**
 * Reads `<host>'<group-id>` into its parts, or returns null.
 *
 * `raw` is expected already decoded. React Router decodes path params before
 * handing them to `useParams`, and both callers pass one straight through, so
 * decoding again here would be a second decoder with no matching encoder —
 * dropped deliberately (CON-45), for two reasons:
 *
 *  - it broke legitimate addresses: a group id containing a percent sign
 *    (`localhost:8080'100%`) is fine after the router's decode but throws
 *    `URIError` in a second `decodeURIComponent`.
 *  - it reintroduced the confusion the host check above exists to stop: a
 *    link reading `evil.example%27x` decodes twice into host `evil.example`
 *    plus id `x`, so what the address bar shows and what gets connected to
 *    part ways again.
 *
 * With the decode gone nothing in here throws — `new URL` is caught — so a
 * malformed route such as `/s/%E0%A4%A'group`, which React Router hands over
 * still encoded because its own decode failed, returns null instead of
 * escaping out of render as a white screen.
 *
 * Order matters: normalise the host first, then ask whether it is local, then
 * build the URL — so the local test and the connection only ever see a host
 * that has already passed validation.
 *
 * The group id itself is not validated; that is out of scope here.
 */
export function parseGroupAddress(raw: string): GroupAddress | null {
  const at = raw.indexOf("'")
  if (at <= 0 || at === raw.length - 1) return null
  const host = normalizeHost(raw.slice(0, at))
  if (host === null) return null
  const id = raw.slice(at + 1)
  const scheme = isLocalRelayHost(host) ? 'ws' : 'wss'
  return { host, id, relayUrl: `${scheme}://${host}` }
}

export function formatGroupAddress(address: GroupAddress): string {
  return `${address.host}'${address.id}`
}
