// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetRelay, isTrustedRelay, trustRelay } from './known-relays'

/**
 * The decider behind the trust gate (CON-46). Everything here is about the
 * question "may the app open a socket to this host without asking", so the
 * cases that matter are the ones where a wrong answer is a disclosure: a host
 * nobody approved must not come back trusted, and a storage that is missing,
 * blocked or full of nonsense must not be able to turn into a yes — or into a
 * crash, which would take the gate down with it.
 */
const STORAGE_KEY = 'nc-trusted-relays'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('isTrustedRelay / trustRelay / forgetRelay', () => {
  it('remembers a host until it is forgotten again', () => {
    expect(isTrustedRelay('relay.example')).toBe(false)

    trustRelay('relay.example')
    expect(isTrustedRelay('relay.example')).toBe(true)
    // and only that host — trust is not a blanket yes
    expect(isTrustedRelay('other.example')).toBe(false)
    expect(isTrustedRelay('evil.relay.example')).toBe(false)

    forgetRelay('relay.example')
    expect(isTrustedRelay('relay.example')).toBe(false)
  })

  it('keys by host including the port, so a second port is a second decision', () => {
    trustRelay('relay.example:8443')
    expect(isTrustedRelay('relay.example:8443')).toBe(true)
    expect(isTrustedRelay('relay.example')).toBe(false)
  })

  it('is idempotent — StrictMode runs effects twice', () => {
    trustRelay('relay.example')
    trustRelay('relay.example')
    trustRelay('relay.example')

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual(['relay.example'])
    // and one forget is still enough to undo all three
    forgetRelay('relay.example')
    expect(isTrustedRelay('relay.example')).toBe(false)
  })

  it('treats corrupt storage as nothing remembered, not as a reason to throw', () => {
    localStorage.setItem(STORAGE_KEY, '{not json at all')
    expect(isTrustedRelay('relay.example')).toBe(false)

    // the wrong shape counts the same way, and entries that are not strings
    // are dropped rather than compared
    localStorage.setItem(STORAGE_KEY, '{"relay.example":true}')
    expect(isTrustedRelay('relay.example')).toBe(false)
    localStorage.setItem(STORAGE_KEY, '[17,null,"relay.example"]')
    expect(isTrustedRelay('relay.example')).toBe(true)

    // and it stays writable afterwards
    trustRelay('other.example')
    expect(isTrustedRelay('other.example')).toBe(true)
  })

  it('stays usable when localStorage itself throws (a private window)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('access denied')
    })

    expect(() => trustRelay('relay.example')).not.toThrow()
    // it cannot be remembered, so it is not trusted — failing closed is the
    // only safe direction for this particular question
    expect(isTrustedRelay('relay.example')).toBe(false)
    // but the local relay still is, because that answer needs no storage
    expect(isTrustedRelay('localhost:8080')).toBe(true)
  })

  it('trusts loopback without storage, so the dev workflow never meets the prompt', () => {
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(isTrustedRelay('localhost:8080')).toBe(true)
    expect(isTrustedRelay('127.0.0.1:8080')).toBe(true)
    expect(isTrustedRelay('[::1]:8080')).toBe(true)

    // trusting it writes nothing: isTrustedRelay already knows
    trustRelay('localhost:8080')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()

    // the CON-45 near-miss stays a near-miss
    expect(isTrustedRelay('localhost.evil.example')).toBe(false)
  })

  it('trusts the deployment’s own relay host without storage', async () => {
    vi.stubEnv('VITE_RELAY_URL', 'wss://relay.operator.example')
    vi.resetModules()
    const fresh = await import('./known-relays')

    expect(fresh.isTrustedRelay('relay.operator.example')).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    // a neighbour of it is not
    expect(fresh.isTrustedRelay('relay.operator.example.evil.example')).toBe(false)

    vi.unstubAllEnvs()
    vi.resetModules()
  })
})
