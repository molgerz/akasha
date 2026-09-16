import { afterEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { Signer } from './signer'
import { KINDS, TAGS } from './kinds'
import { client } from './client'
import { publishRevision } from './publish-page'
import { parseRevision } from '../domain/revision'
import { buildPages, buildTree } from '../domain/pages'

/**
 * Hiding a page and bringing it back, end to end through the real signer and
 * the real parser — the round trip is the claim CON-11 makes, and it only
 * holds if the tag the publisher writes is the tag the parser reads.
 * docs/05-versioning-history.md
 */
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
  slug: 'onboarding',
  title: 'Onboarding',
  parentSlug: null,
  order: null,
  summary: null,
  content: '# Onboarding\n\nWelcome.',
  parentRevs: [] as string[],
}

async function publish(input: Parameters<typeof publishRevision>[1]) {
  vi.mocked(client.publish).mockResolvedValue({ ok: true, message: 'accepted' })
  await publishRevision(signer, input)
  return vi.mocked(client.publish).mock.calls.at(-1)![1]
}

describe('publishRevision that archives the page', () => {
  afterEach(() => {
    vi.mocked(client.publish).mockReset()
  })

  it('writes the tag, and writes nothing when the page stays visible', async () => {
    expect((await publish({ ...base, archived: true })).tags).toContainEqual([TAGS.ARCHIVED, '1'])

    const visible = await publish(base)
    expect(visible.tags.some((tag) => tag[0] === TAGS.ARCHIVED)).toBe(false)
  })

  it('is still an ordinary revision — the text travels with it', async () => {
    const event = await publish({ ...base, archived: true })
    expect(event.kind).toBe(KINDS.PAGE_REVISION)
    // Not an empty body: that would be indistinguishable from somebody
    // clearing the page, and it would make restoring lossy.
    expect(event.content).toBe(base.content)
  })

  it('says in the alt text that the page was archived, for a foreign client', async () => {
    const event = await publish({ ...base, archived: true })
    const alt = event.tags.find((tag) => tag[0] === TAGS.ALT)![1]
    expect(alt).toContain('was archived')
  })

  it('round trips: published, parsed, and the page is out of the tree', async () => {
    const first = await publish(base)
    const removal = await publish({ ...base, archived: true, parentRevs: [first.id] })

    const revisions = [
      parseRevision(first, base.groupId)!,
      parseRevision(removal, base.groupId)!,
    ]
    const pages = buildPages(revisions)
    expect(pages[0].archived).toBe(true)
    expect(buildTree(pages)).toEqual([])
  })

  it('round trips back: a revision without the tag brings the page back', async () => {
    const first = await publish(base)
    const removal = await publish({ ...base, archived: true, parentRevs: [first.id] })
    const back = await publish({ ...base, parentRevs: [removal.id] })

    const pages = buildPages(
      [first, removal, back].map((event) => parseRevision(event, base.groupId)!),
    )
    expect(pages[0].archived).toBe(false)
    expect(buildTree(pages).map((node) => node.slug)).toEqual(['onboarding'])
    // nothing was deleted on the way there and back
    expect(pages[0].revisions).toHaveLength(3)
  })
})
