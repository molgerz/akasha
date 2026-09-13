import { KINDS } from './kinds'
import type { Signer } from './signer'
import { BLOSSOM_SERVER } from './blossom'

/**
 * Loading attachments that are protected by their group (CON-26).
 *
 * A blob on our own Blossom server is no longer readable by whoever knows its
 * hash: the server wants a `t=get` token and checks that the token's key is a
 * member of the group the blob was uploaded to. BUD-11 puts that token in the
 * `Authorization` header, and a plain `<img src>` cannot send one — so a
 * protected image is fetched here and handed to the renderer as an object URL.
 *
 * Everything on a foreign host is left exactly as it was: it is not ours to
 * protect, and it keeps loading directly (docs/09-security-privacy.md).
 */

/** The credential a caller supplies once signed in, or null when it is not. */
export type AttachmentLoader = (url: string) => Promise<string>

let loader: AttachmentLoader | null = null

/** Who can sign a read token right now. SessionProvider owns this. */
export function setAttachmentLoader(next: AttachmentLoader | null): void {
  loader = next
}

/** This server's hostname, without the port — BUD-11 scopes by domain. */
function serverHost(): string {
  try {
    return new URL(BLOSSOM_SERVER).hostname
  } catch {
    return ''
  }
}

/**
 * The sha256 a URL names on a given Blossom server, or null when it does not
 * point there. This is the line between "we can protect it" and "somebody
 * else's host" — only the former is fetched with a token. Split out from
 * `protectedHash` so it can be tested without the build-time environment.
 */
export function protectedHashFor(
  url: string,
  server: string,
  origin?: string,
): string | null {
  if (!server) return null
  let target: URL
  let base: URL
  try {
    target = new URL(url, origin)
    base = new URL(server)
  } catch {
    return null
  }
  if (target.host !== base.host) return null
  const match = /^\/([0-9a-fA-F]{64})(?:\.[A-Za-z0-9]+)?$/.exec(target.pathname)
  return match ? match[1].toLowerCase() : null
}

export function protectedHash(url: string): string | null {
  return protectedHashFor(
    url,
    BLOSSOM_SERVER,
    typeof window === 'undefined' ? undefined : window.location.origin,
  )
}

export function isProtectedAttachment(url: string): boolean {
  return protectedHash(url) !== null
}

/**
 * The URL to draw immediately, or null when it has to be fetched with a token
 * first. Foreign URLs stay synchronous, so nothing that never touched our
 * Blossom server changes behaviour.
 */
export function attachmentSrcSync(url: string): string | null {
  return isProtectedAttachment(url) ? null : url
}

/** Object URLs are alive until revoked; keep the newest ones, drop the rest. */
const objectUrls = new Map<string, string>()
const inFlight = new Map<string, Promise<string>>()
const MAX_OBJECT_URLS = 64

function rememberObjectUrl(hash: string, url: string): string {
  const existing = objectUrls.get(hash)
  if (existing) {
    URL.revokeObjectURL(url)
    return existing
  }
  objectUrls.set(hash, url)
  while (objectUrls.size > MAX_OBJECT_URLS) {
    const oldest = objectUrls.keys().next().value
    if (oldest === undefined) break
    const stale = objectUrls.get(oldest)
    objectUrls.delete(oldest)
    if (stale) URL.revokeObjectURL(stale)
  }
  return url
}

function base64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Fetch a protected blob once, as an object URL, and remember it. */
async function loadProtected(signer: Signer, url: string, hash: string): Promise<string> {
  const cached = objectUrls.get(hash)
  if (cached) return cached
  const running = inFlight.get(hash)
  if (running) return running

  const task = (async () => {
    const now = Math.floor(Date.now() / 1000)
    const auth = await signer.signEvent({
      kind: KINDS.BLOSSOM_AUTH,
      created_at: now,
      tags: [
        ['t', 'get'],
        ['x', hash],
        ['server', serverHost()],
        ['expiration', String(now + 300)],
      ],
      content: 'read attachment',
    })
    const target = new URL(url, window.location.origin)
    target.hash = ''
    const response = await fetch(target.toString(), {
      headers: { Authorization: `Nostr ${base64Url(JSON.stringify(auth))}` },
    })
    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new Error(
        `The Blossom server answered ${response.status}${message ? `: ${message.slice(0, 200)}` : ''}`,
      )
    }
    const blob = await response.blob()
    return rememberObjectUrl(hash, URL.createObjectURL(blob))
  })().finally(() => inFlight.delete(hash))

  inFlight.set(hash, task)
  return task
}

/** The loader SessionProvider installs: sign a get token, fetch, object URL. */
export function attachmentLoaderFor(signer: Signer): AttachmentLoader {
  return (url) => {
    const hash = protectedHash(url)
    return hash ? loadProtected(signer, url, hash) : Promise.resolve(url)
  }
}

/**
 * The URL an image or link should actually use. Foreign and unsigned cases fall
 * through unchanged; only ours needs the loader, and without a session there is
 * nothing to fetch it with.
 */
export async function loadAttachmentUrl(url: string): Promise<string> {
  if (!isProtectedAttachment(url)) return url
  if (!loader) throw new Error('Sign in to load this attachment.')
  return loader(url)
}

/**
 * Open a protected, non-image attachment. Downloading through a blob URL keeps
 * the token out of the address bar and off the history.
 */
export async function openAttachment(url: string): Promise<void> {
  const resolved = await loadAttachmentUrl(url)
  const link = document.createElement('a')
  link.href = resolved
  link.rel = 'noreferrer noopener'
  link.download = ''
  document.body.appendChild(link)
  link.click()
  link.remove()
}
