// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Signer } from './signer'
import { protectedHashFor } from './attachment-access'

const HASH = 'a'.repeat(64)
const SERVER = 'http://localhost:3355'

describe('protectedHashFor', () => {
  it('recognises a blob on our own server, extension and fragment included', () => {
    expect(protectedHashFor(`${SERVER}/${HASH}`, SERVER)).toBe(HASH)
    expect(protectedHashFor(`${SERVER}/${HASH}.png#width=480`, SERVER)).toBe(HASH)
    expect(protectedHashFor(`http://localhost:3355/${HASH.toUpperCase()}.PDF`, SERVER)).toBe(HASH)
  })

  it('leaves foreign hosts, other ports and non-blob paths alone', () => {
    expect(protectedHashFor(`https://example.com/${HASH}`, SERVER)).toBeNull()
    expect(protectedHashFor(`http://localhost:9999/${HASH}`, SERVER)).toBeNull()
    expect(protectedHashFor(`${SERVER}/upload`, SERVER)).toBeNull()
    expect(protectedHashFor(`${SERVER}/${HASH}/extra`, SERVER)).toBeNull()
  })

  it('protects nothing without a configured server', () => {
    expect(protectedHashFor(`${SERVER}/${HASH}`, '')).toBeNull()
  })
})

/** A fresh module with the build-time Blossom server stubbed in. */
async function withServer() {
  vi.resetModules()
  vi.stubEnv('VITE_BLOSSOM_SERVER', SERVER)
  return import('./attachment-access')
}

describe('loadAttachmentUrl', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('returns a foreign URL unchanged, with or without a session', async () => {
    const mod = await withServer()
    mod.setAttachmentLoader(null)
    expect(await mod.loadAttachmentUrl('https://example.com/x.png')).toBe('https://example.com/x.png')
  })

  it('refuses a protected blob without a session', async () => {
    const mod = await withServer()
    mod.setAttachmentLoader(null)
    await expect(mod.loadAttachmentUrl(`${SERVER}/${HASH}`)).rejects.toThrow(/Sign in/)
  })

  it('fetches a protected blob with a t=get token and caches the object URL', async () => {
    const mod = await withServer()
    const templates: Array<Record<string, unknown>> = []
    const signer = {
      kind: 'dev',
      getPublicKey: async () => 'p',
      signEvent: async (template: Record<string, unknown>) => {
        templates.push(template)
        return { ...template, id: '1', pubkey: 'p', sig: 's' }
      },
    } as unknown as Signer

    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true })
    // A minimal response object: jsdom's Blob and Node's Response do not agree
    // on `.stream`, and the code under test only reads ok/status/blob/text.
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => '',
      blob: async () => new Blob(['x'], { type: 'image/png' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    mod.setAttachmentLoader(mod.attachmentLoaderFor(signer))
    expect(await mod.loadAttachmentUrl(`${SERVER}/${HASH}`)).toBe('blob:mock')
    // A second render of the same blob reuses the object URL instead of fetching again.
    expect(await mod.loadAttachmentUrl(`${SERVER}/${HASH}`)).toBe('blob:mock')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const tags = templates[0].tags as string[][]
    expect(templates[0].kind).toBe(24242)
    expect(tags).toContainEqual(['t', 'get'])
    expect(tags).toContainEqual(['x', HASH])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${SERVER}/${HASH}`)
    expect(init.headers).toMatchObject({ Authorization: expect.stringMatching(/^Nostr /) })
  })
})
