import { describe, expect, it } from 'vitest'
import { formatGroupAddress, isLocalRelayHost, parseGroupAddress } from './group-address'

describe('parseGroupAddress', () => {
  // CON-45. The old test was `host.startsWith('localhost')`, so every one of
  // these — all registrable by anyone — got an unencrypted ws:// connection,
  // over which the client then signs a NIP-42 AUTH event with the user's
  // pubkey. The address comes out of a route, so a link is enough to pick it.
  it.each([
    'localhost.evil.example',
    '127.0.0.1.evil.example',
    'localhostile.example',
    '127.0.0.1.attacker.tld',
  ])('connects to %s over wss, not ws', (host) => {
    const group = parseGroupAddress(`${host}'engineering`)
    expect(group).toEqual({ host, id: 'engineering', relayUrl: `wss://${host}` })
  })

  it.each([
    ['localhost', 'ws://localhost'],
    ['localhost:8080', 'ws://localhost:8080'],
    ['127.0.0.1:8080', 'ws://127.0.0.1:8080'],
    // a dev relay bound to IPv6 is as local as one bound to IPv4
    ['[::1]:8080', 'ws://[::1]:8080'],
  ])('still reaches the dev relay on %s over ws', (host, relayUrl) => {
    expect(parseGroupAddress(`${host}'engineering`)).toEqual({
      host,
      id: 'engineering',
      relayUrl,
    })
  })

  it.each([
    // reads as the real relay, resolves to evil.example
    ["evil.example/#@real'engineering", 'a host that only reads as another one'],
    ["evil.example/path'engineering", 'a path'],
    ["a b'engineering", 'whitespace'],
    ["user@evil.example'engineering", 'userinfo'],
    ["evil.example?x'engineering", 'a query'],
    ["'engineering", 'an empty host'],
    ["localhost'", 'a missing group id'],
    // React Router hands the param over still encoded when its own decode
    // fails, so this is what actually arrives here. It used to throw URIError
    // out of render — a white screen.
    ["%E0%A4%A'group", 'a malformed percent escape'],
  ])('rejects %j — %s', (raw) => {
    expect(parseGroupAddress(raw)).toBeNull()
  })

  it('normalises the case of the host, as a connection would', () => {
    expect(parseGroupAddress("LocalHost:8080'engineering")?.host).toBe('localhost:8080')
    expect(parseGroupAddress("EVIL.example'engineering")?.relayUrl).toBe('wss://evil.example')
  })

  it('splits on the first apostrophe, so the id may contain one', () => {
    expect(parseGroupAddress("localhost:8080'it's-fine")?.id).toBe("it's-fine")
  })

  // The decision on the double decode (CON-45): React Router already decoded
  // this param, so parseGroupAddress does not decode again. Both of these
  // pin that — the first would throw URIError in a second decodeURIComponent,
  // the second would decode into host `evil.example` and id `x`.
  it('takes its input as already decoded and never decodes a second time', () => {
    expect(parseGroupAddress("localhost:8080'100%")).toEqual({
      host: 'localhost:8080',
      id: '100%',
      relayUrl: 'ws://localhost:8080',
    })
    expect(parseGroupAddress("evil.example%27x'engineering")).toBeNull()
  })

  it('round-trips through formatGroupAddress', () => {
    const raw = "relay.example'engineering"
    const group = parseGroupAddress(raw)
    expect(group).not.toBeNull()
    expect(formatGroupAddress(group!)).toBe(raw)
    expect(parseGroupAddress(formatGroupAddress(group!))).toEqual(group)
  })
})

describe('isLocalRelayHost', () => {
  it.each(['localhost', 'localhost:8080', '127.0.0.1', '127.0.0.1:8080', '[::1]', '[::1]:8080'])(
    'holds for %s',
    (host) => {
      expect(isLocalRelayHost(host)).toBe(true)
    },
  )

  it.each([
    'localhost.evil.example',
    'localhostile.example',
    '127.0.0.1.attacker.tld',
    'evil.example',
    'notlocalhost',
    '127.0.0.10',
  ])('does not hold for %s', (host) => {
    expect(isLocalRelayHost(host)).toBe(false)
  })
})
