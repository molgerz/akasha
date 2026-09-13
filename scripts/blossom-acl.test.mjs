import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import {
  blobHashFromPath,
  checkAuthHeader,
  decodeToken,
  groupOf,
  parseAuthHeader,
  verifyToken,
} from './blossom-acl.mjs'

const secret = generateSecretKey()
const pubkey = getPublicKey(secret)
const HASH = 'a'.repeat(64)
const NOW = 1_800_000_000

function token(overrides = {}) {
  const {
    kind = 24242,
    created_at = NOW - 5,
    tags = [
      ['t', 'get'],
      ['x', HASH],
      ['expiration', String(NOW + 300)],
    ],
    content = 'read attachment',
  } = overrides
  return finalizeEvent({ kind, created_at, tags, content }, secret)
}

function headerFor(event) {
  return 'Nostr ' + Buffer.from(JSON.stringify(event)).toString('base64url')
}

describe('parseAuthHeader', () => {
  it('decodes a base64url token', () => {
    const event = token()
    expect(parseAuthHeader(headerFor(event)).event.id).toBe(event.id)
  })

  it('also accepts the standard base64 the app used to send', () => {
    const event = token()
    const header = 'Nostr ' + Buffer.from(JSON.stringify(event)).toString('base64')
    expect(parseAuthHeader(header).event.id).toBe(event.id)
  })

  it('rejects a missing, wrongly-schemed or undecodable header', () => {
    expect(parseAuthHeader(undefined).reason).toMatch(/missing/)
    expect(parseAuthHeader('Bearer abc').reason).toMatch(/scheme/)
    // valid base64, but not JSON
    expect(parseAuthHeader('Nostr ' + Buffer.from('not json').toString('base64url')).reason).toMatch(
      /JSON/,
    )
  })
})

describe('verifyToken', () => {
  const base = { verb: 'get', hash: HASH, server: 'localhost:3355', now: NOW }

  it('accepts a well-formed get token', () => {
    expect(verifyToken(token(), base)).toBeNull()
  })

  it('rejects the wrong kind and a tampered signature', () => {
    expect(verifyToken(token({ kind: 1 }), base)).toMatch(/kind/)
    const event = token()
    expect(verifyToken({ ...event, content: 'tampered' }, base)).toMatch(/signature/)
  })

  it('requires an expiration in the future and a created_at not in the future', () => {
    const noExpiration = token({ tags: [['t', 'get'], ['x', HASH]] })
    expect(verifyToken(noExpiration, base)).toMatch(/expiration/)

    const expired = token({ tags: [['t', 'get'], ['x', HASH], ['expiration', String(NOW - 1)]] })
    expect(verifyToken(expired, base)).toMatch(/expiration/)

    const future = token({ created_at: NOW + 3600 })
    expect(verifyToken(future, base)).toMatch(/future/)
  })

  it('matches the t verb exactly', () => {
    expect(verifyToken(token({ tags: [['t', 'upload'], ['x', HASH], ['expiration', String(NOW + 5)]] }), base)).toMatch(
      /"get"/,
    )
  })

  it('requires an x tag for upload but not for get', () => {
    const withoutX = token({ tags: [['t', 'upload'], ['expiration', String(NOW + 5)]] })
    expect(verifyToken(withoutX, { verb: 'upload', hash: HASH, now: NOW, requireHash: true })).toMatch(
      /x tag is required/,
    )
    expect(verifyToken(withoutX, { verb: 'upload', hash: HASH, now: NOW })).toBeNull()
  })

  it('rejects an x tag for another blob', () => {
    const other = token({ tags: [['t', 'get'], ['x', 'b'.repeat(64)], ['expiration', String(NOW + 5)]] })
    expect(verifyToken(other, base)).toMatch(/does not match/)
  })

  it('honours server scoping only when the token carries it', () => {
    const scopedElsewhere = token({
      tags: [['t', 'get'], ['server', 'cdn.example.com'], ['expiration', String(NOW + 5)]],
    })
    expect(verifyToken(scopedElsewhere, base)).toMatch(/another server/)
    expect(verifyToken(scopedElsewhere, { ...base, server: 'cdn.example.com' })).toBeNull()
    // a token without a server tag works everywhere
    expect(verifyToken(token(), { verb: 'get', hash: HASH, now: NOW })).toBeNull()
  })
})

describe('checkAuthHeader', () => {
  it('reports the parsed event on success and a reason otherwise', () => {
    const ok = checkAuthHeader(headerFor(token()), { verb: 'get', hash: HASH, now: NOW })
    expect(ok.ok).toBe(true)
    expect(ok.event.pubkey).toBe(pubkey)

    const bad = checkAuthHeader(headerFor(token({ kind: 1 })), { verb: 'get', hash: HASH, now: NOW })
    expect(bad.ok).toBe(false)
    expect(bad.reason).toMatch(/kind/)
  })
})

describe('groupOf', () => {
  it('reads the h tag', () => {
    expect(groupOf(token({ tags: [['h', 'engineering']] }))).toBe('engineering')
    expect(groupOf(token({ tags: [] }))).toBeNull()
  })
})

describe('blobHashFromPath', () => {
  it('accepts /<sha256> with or without an extension', () => {
    expect(blobHashFromPath('/' + HASH)).toBe(HASH)
    expect(blobHashFromPath('/' + HASH + '.png')).toBe(HASH)
    expect(blobHashFromPath('/' + HASH.toUpperCase() + '.PDF')).toBe(HASH)
  })

  it('rejects anything else', () => {
    expect(blobHashFromPath('/upload')).toBeNull()
    expect(blobHashFromPath('/' + HASH + '/extra')).toBeNull()
    expect(blobHashFromPath('/' + 'abc')).toBeNull()
  })
})
