import { afterEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { Signer } from './signer'
import { KINDS, TAGS } from './kinds'
import { client } from './client'
import { placementAddress, publishPlacementDeletion } from './publish-deletion'
import { parseDeletion } from '../domain/deletion'

vi.mock('./client', () => ({
  client: { publish: vi.fn() },
}))

const secretKey = generateSecretKey()
const author = getPublicKey(secretKey)
const signer: Signer = {
  kind: 'dev',
  getPublicKey: async () => author,
  signEvent: async (template) => finalizeEvent(template, secretKey),
}

const base = {
  relayUrl: 'ws://relay.example',
  groupId: 'engineering',
  slug: 'onboarding',
  author,
}

describe('placementAddress', () => {
  it('is kind:pubkey:d, which is how NIP-09 names an addressable event', () => {
    expect(placementAddress('abc', 'onboarding')).toBe(`${KINDS.PAGE_PLACEMENT}:abc:onboarding`)
  })
})

describe('publishPlacementDeletion', () => {
  afterEach(() => {
    vi.mocked(client.publish).mockReset()
  })

  it('names the placement by address, never by event id', async () => {
    vi.mocked(client.publish).mockResolvedValue({ ok: true, message: 'accepted' })
    await publishPlacementDeletion(signer, base)
    const event = vi.mocked(client.publish).mock.calls[0][1]

    expect(event.kind).toBe(KINDS.DELETION_REQUEST)
    expect(event.tags).toContainEqual([TAGS.DELETED_ADDRESS, placementAddress(author, base.slug)])
    expect(event.tags).toContainEqual([TAGS.DELETED_KIND, String(KINDS.PAGE_PLACEMENT)])
    expect(event.tags).toContainEqual([TAGS.GROUP, base.groupId])
    // Every move replaces the placement, so an id would point at a version
    // that may already be gone.
    expect(event.tags.some((tag) => tag[0] === TAGS.DELETED_EVENT)).toBe(false)
  })

  it('round trips: what it signs is what the parser reads back', async () => {
    vi.mocked(client.publish).mockResolvedValue({ ok: true, message: 'accepted' })
    await publishPlacementDeletion(signer, base)
    const event = vi.mocked(client.publish).mock.calls[0][1]

    const deletion = parseDeletion(event, base.groupId)
    expect(deletion?.addresses).toEqual([placementAddress(author, base.slug)])
    expect(deletion?.author).toBe(author)
  })
})
