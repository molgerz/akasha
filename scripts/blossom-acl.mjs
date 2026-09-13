/**
 * Blossom authorization checks, kept out of the HTTP server so they can be
 * unit-tested without a socket. BUD-01 (retrieval), BUD-02 (upload) and BUD-11
 * (the kind 24242 token) define the rules; docs/09-security-privacy.md and
 * CON-26 explain why the *read* path enforces them here.
 *
 * A token proves one thing: the holder of `pubkey` signed this exact request.
 * It says nothing about NIP-29 membership — that is a separate question the
 * server answers against the relay's `39002` before it hands out a blob.
 */
import { verifyEvent } from 'nostr-tools'

export const BLOSSOM_AUTH_KIND = 24242

/** A token older than this many seconds is rejected — the clock is the client's. */
const CLOCK_SKEW_SECONDS = 60

/**
 * BUD-11 wants Base64url without padding; the app used to send standard
 * Base64, so both are accepted on the way in. Decoding is strict either way —
 * a token that is not valid JSON after decoding is a bad token, not an empty
 * one.
 */
export function decodeToken(encoded) {
  const normalised = encoded.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalised, 'base64').toString('utf8')
}

/**
 * The event out of an `Authorization: Nostr <base64url>` header, or a reason.
 * Parsing is separate from validation so the tests can build the happy path
 * without a header.
 */
export function parseAuthHeader(header) {
  if (!header || typeof header !== 'string') return { reason: 'Authorization header is missing' }
  if (!header.startsWith('Nostr ')) return { reason: 'Authorization scheme must be Nostr' }
  let event
  try {
    event = JSON.parse(decodeToken(header.slice(6).trim()))
  } catch {
    return { reason: 'Authorization is not base64url-encoded JSON' }
  }
  if (event === null || typeof event !== 'object') return { reason: 'Authorization is not an event' }
  return { event }
}

const tagValues = (event, name) =>
  event.tags.filter((tag) => tag[0] === name).map((tag) => tag[1])

/**
 * Validate a token against one intended action. Returns `null` when the token
 * is good, otherwise a human-readable reason.
 *
 * `verb` is the BUD-11 `t` value for the endpoint (`get` for retrieval,
 * `upload` for upload). `hash` is the blob the endpoint acts on;
 * `requireHash` says whether an `x` tag is mandatory for that endpoint (it is
 * for upload, optional for GET). `server` is this server's own lowercase host,
 * checked only when the token carries `server` tags.
 */
export function verifyToken(event, { verb, hash, server, requireHash = false, now = Math.floor(Date.now() / 1000) }) {
  if (event.kind !== BLOSSOM_AUTH_KIND) return `wrong kind, expected ${BLOSSOM_AUTH_KIND}`
  if (!verifyEvent(event)) return 'invalid signature'

  const createdAt = Number(event.created_at)
  if (!Number.isFinite(createdAt) || createdAt > now + CLOCK_SKEW_SECONDS) {
    return 'created_at is in the future'
  }

  const expiration = Number(tagValues(event, 'expiration')[0])
  if (!Number.isFinite(expiration) || expiration <= now) return 'expiration is missing or has passed'

  if (!tagValues(event, 't').includes(verb)) return `t tag must be "${verb}"`

  const servers = tagValues(event, 'server')
  if (servers.length > 0) {
    if (!server) return 'the token is scoped to a server, but this server has no host'
    if (!servers.map((value) => String(value).toLowerCase()).includes(server.toLowerCase())) {
      return 'the token is scoped to another server'
    }
  }

  const hashes = tagValues(event, 'x')
  if (requireHash && hashes.length === 0) return 'an x tag is required'
  if (hashes.length > 0 && (!hash || !hashes.includes(hash))) {
    return 'x tag does not match the blob'
  }

  return null
}

/** Convenience: parse then validate. */
export function checkAuthHeader(header, options) {
  const parsed = parseAuthHeader(header)
  if (!parsed.event) return { ok: false, reason: parsed.reason }
  const problem = verifyToken(parsed.event, options)
  if (problem) return { ok: false, reason: problem }
  return { ok: true, event: parsed.event }
}

/** The `h` tag of an upload token — the group the blob is filed under. */
export function groupOf(event) {
  const value = tagValues(event, 'h')[0]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const SHA256 = /^[0-9a-f]{64}$/

/**
 * The blob hash out of a request path, with an optional file extension, as
 * BUD-01 prescribes: `/<sha256>` or `/<sha256>.png`. Returns null for any
 * other path, so the caller answers 404 rather than guessing.
 */
export function blobHashFromPath(pathname) {
  const match = /^\/([0-9a-fA-F]{64})(?:\.[A-Za-z0-9]+)?$/.exec(pathname)
  return match ? match[1].toLowerCase() : null
}

export { SHA256 }
