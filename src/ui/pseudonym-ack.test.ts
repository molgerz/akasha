// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acknowledge, readAcknowledged } from './pseudonym-ack'

/**
 * The fallbacks, which the component tests never reach because they only ever
 * drive the happy path. Each one decides whether somebody gets the warning, and
 * the direction they fail in is the whole point: a store that cannot be read or
 * written has to show the notice again, never skip it.
 */
const STORAGE_KEY = 'nc-pseudonym-ack'
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

describe('pseudonym-ack', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('treats an unwritten store as nobody having been told', () => {
    expect(readAcknowledged().size).toBe(0)
  })

  it('forgets a store it cannot parse rather than trusting it', () => {
    localStorage.setItem(STORAGE_KEY, 'not json')
    expect(readAcknowledged().size).toBe(0)
  })

  it('forgets a store that is valid JSON but not a list of npubs', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [A]: true }))
    expect(readAcknowledged().size).toBe(0)
  })

  it('keeps the entries it can read and drops the ones it cannot', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([A, 42, null, { B }]))
    expect([...readAcknowledged()]).toEqual([A])
  })

  it('remembers every npub told so far, not just the last one', () => {
    acknowledge(A)
    acknowledge(B)
    expect([...readAcknowledged()].sort()).toEqual([A, B].sort())
  })

  // A private window may refuse the write. The notice then reappears next time
  // — it costs a click, where skipping it costs the warning.
  it('still reports the npub as told for this session when the write fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(acknowledge(A).has(A)).toBe(true)

    vi.restoreAllMocks()
    expect(readAcknowledged().has(A)).toBe(false)
  })
})
