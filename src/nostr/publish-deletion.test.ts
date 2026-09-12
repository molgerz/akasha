import { afterEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { Signer } from './signer'
import { KINDS, TAGS } from './kinds'
import { client } from './client'
import { publishRevisionDeletion } from './publish-deletion'

vi.mock('./client', () => ({
  client: { publish: vi.fn() },
}))

const secretKey = generateSecretKey()
const signer: Signer = {
  kind: 'dev',
  getPublicKey: async () => getPublicKey(secretKey),
  signEvent: async (template) => finalizeEvent(template, secretKey),
}
const base = {
  relayUrl: 'ws://relay.example',
  groupId: 'engineering',
  revisionId: 'a'.repeat(64),
}

describe('publishRevisionDeletion', () => {
  afterEach(() => {
    vi.mocked(client.publish).mockReset()
  })

  it('signs a kind 5 naming the revision, its kind and the group', async () => {
    vi.mocked(client.publish).mockResolvedValue({ ok: true, message: 'accepted' })
    await publishRevisionDeletion(signer, base)
    const event = vi.mocked(client.publish).mock.calls[0][1]
    expect(event.kind).toBe(KINDS.DELETION_REQUEST)
    expect(event.tags).toContainEqual([TAGS.DELETED_EVENT, base.revisionId])
    expect(event.tags).toContainEqual([TAGS.DELETED_KIND, String(KINDS.PAGE_REVISION)])
    expect(event.tags).toContainEqual([TAGS.GROUP, base.groupId])
    expect(event.content).toBe('')
  })

  it('publishes to the space relay', async () => {
    vi.mocked(client.publish).mockResolvedValue({ ok: true, message: 'accepted' })
    await publishRevisionDeletion(signer, base)
    expect(client.publish).toHaveBeenCalledWith(base.relayUrl, expect.anything())
  })

  it('passes a relay rejection through', async () => {
    vi.mocked(client.publish).mockResolvedValue({ ok: false, reason: 'restricted: not allowed' })
    await expect(publishRevisionDeletion(signer, base)).resolves.toEqual({
      ok: false,
      reason: 'restricted: not allowed',
    })
  })
})
