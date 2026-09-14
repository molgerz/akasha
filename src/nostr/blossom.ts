import { KINDS } from './kinds'
import type { Signer } from './signer'

/**
 * File attachments via Blossom (BUD-01/02).
 *
 * Nostr does not store files. A blob is uploaded to a Blossom server, addressed
 * there by its sha256 and embedded into the Markdown as a URL. The upload is
 * authorised with a kind 24242 event — the server verifies a signature, not a
 * password.
 */
export type UploadResult =
  | { ok: true; url: string; sha256: string; size: number; type: string }
  | { ok: false; reason: string }

export const BLOSSOM_SERVER: string = (import.meta.env.VITE_BLOSSOM_SERVER ?? '').trim()

export function attachmentsEnabled(): boolean {
  return BLOSSOM_SERVER.length > 0
}

/** Why an upload cannot happen without a server — shown, not swallowed. */
export const NO_BLOSSOM_SERVER = 'No Blossom server configured (VITE_BLOSSOM_SERVER).'

const UTF8 = new TextEncoder()

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * There is deliberately no `isOwnAttachment` any more.
 *
 * It was the test behind the click-to-load gate on images, which is gone: every
 * image in a page is loaded directly, ours or anybody's. Keeping a function
 * that answers "is this ours?" with nothing asking the question would only
 * suggest a gate that is no longer there. docs/09-security-privacy.md
 */

/**
 * The address an uploaded blob is reachable at.
 *
 * The server answers an upload with a descriptor, and its `url` is taken at its
 * word — but only once it is an absolute http(s) URL. `javascript:alert(1)` and
 * `data:text/html,…` parse as perfectly valid URLs, so it is the protocol check
 * and not the parse that rejects them; a relative string throws and falls
 * through the same way. Nothing executable gets through rendering either
 * (rehype-sanitize and react-markdown's URL transform both refuse those
 * schemes) and the server is operator-configured, not attacker-supplied — this
 * is the second line, so that what is *stored* in a page is already sound for
 * every future reader rather than only for this client's renderer.
 *
 * The fallback is deterministic: a blob is addressed by its sha256, so
 * `<server>/<hash>` is where it has to be. The trailing slash is stripped here
 * exactly as the upload request strips it, so a `VITE_BLOSSOM_SERVER` that ends
 * in `/` cannot produce a `//` in the stored URL. `server` is a parameter
 * because the module-level constant is read from `import.meta.env` at load
 * time, which a test cannot change afterwards.
 */
export function resolveAttachmentUrl(
  descriptor: unknown,
  hash: string,
  server: string = BLOSSOM_SERVER,
): string {
  const candidate = (descriptor as Record<string, unknown> | null)?.url
  if (typeof candidate === 'string') {
    const subject = withoutUrlPadding(candidate)
    try {
      const url = new URL(subject)
      if (url.protocol === 'http:' || url.protocol === 'https:') return subject
    } catch {
      /* not absolute — fall through to the deterministic path */
    }
  }
  return `${server.replace(/\/$/, '')}/${hash}`
}

/**
 * The padding the URL parser ignores, removed before the string is handed on.
 *
 * `new URL` discards leading and trailing C0 controls and spaces, so a url
 * padded with a space passes the gate above — and passing the *unstripped*
 * string on then stores `%20https://x/a%20`, a destination that decodes to a
 * relative path with a literal space in it: a broken link built out of a URL
 * that was fine. What is returned is therefore the exact string the parser
 * validated.
 *
 * Not `trim()`, which also strips Unicode whitespace the URL parser treats as
 * part of the path: a url ending in U+00A0 addresses a blob whose name ends in
 * a no-break space, and trimming it would silently point the link elsewhere.
 * Written as a loop rather than a regex because a character class over the C0
 * range is what `no-control-regex` exists to flag.
 */
function withoutUrlPadding(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && value.charCodeAt(start) <= 0x20) start += 1
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end -= 1
  return value.slice(start, end)
}

export async function uploadAttachment(signer: Signer, file: File): Promise<UploadResult> {
  if (!attachmentsEnabled()) {
    return { ok: false, reason: NO_BLOSSOM_SERVER }
  }

  const data = await file.arrayBuffer()
  const hash = await sha256Hex(data)

  const auth = await signer.signEvent({
    kind: KINDS.BLOSSOM_AUTH,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', 'upload'],
      ['x', hash],
      ['expiration', String(Math.floor(Date.now() / 1000) + 300)],
    ],
    content: `upload attachment ${file.name}`,
  })

  try {
    const response = await fetch(`${BLOSSOM_SERVER.replace(/\/$/, '')}/upload`, {
      method: 'PUT',
      headers: {
        Authorization: `Nostr ${btoa(JSON.stringify(auth))}`,
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: data,
    })

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      return {
        ok: false,
        reason: `The server answered ${response.status}${message ? `: ${message.slice(0, 200)}` : ''}`,
      }
    }

    const body: unknown = await response.json()
    const url = resolveAttachmentUrl(body, hash)
    return {
      ok: true,
      url,
      sha256: hash,
      size: file.size,
      type: file.type || 'application/octet-stream',
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'upload failed',
    }
  }
}

/**
 * A destination that cannot end the link early.
 *
 * Every one of these characters means something between the parentheses of a
 * Markdown link: a bare `)` closes the destination, whitespace begins the
 * optional title behind it, `<` and `>` are the alternative `<…>` destination
 * form, and a backslash escapes whatever follows. Percent-encoding them keeps
 * the link working — a server decodes `%29` back to `)` when it resolves the
 * path — while the stored text stays unambiguous.
 *
 * Percent-encoding is defined over UTF-8 *bytes*, not over UTF-16 code units,
 * and `\s` also matches non-ASCII whitespace: encoding U+00A0 from its code
 * unit yields `%A0`, which no reader can decode, and U+2003 yields `%2003`,
 * which decodes to `%20` followed by a literal `03`. Both point the link at
 * something other than the blob. Encoding the character's bytes is what makes
 * the promise above true for every character the class matches.
 *
 * Deliberately not `encodeURIComponent` over the whole URL: it would also
 * encode `:`, `/`, `?`, `&` and `=`, which buys nothing here and makes a
 * stored page harder to read in a diff or a three-way merge. Not per matched
 * character either — `encodeURIComponent` leaves `(` and `)` untouched, and
 * those are the two characters this function exists for.
 */
function markdownDestination(url: string): string {
  return url.replace(/[()<>\s\\]/g, (character) =>
    [...UTF8.encode(character)]
      .map((byte) => '%' + byte.toString(16).toUpperCase().padStart(2, '0'))
      .join(''),
  )
}

/**
 * Markdown embed for an uploaded file.
 *
 * The filename is user input and goes inside the label, where a `]`, a `[` or a
 * line break would end it early and break the Markdown — a file called
 * `notes].md` would produce a link whose target swallows the rest of the line.
 * Those characters are dropped and, if nothing readable is left, the label
 * falls back to a neutral word.
 *
 * The destination has the same problem from the other side, where a `)` ends
 * the link just as effectively. Both are handled here, at insertion time: what
 * gets stored has to be valid Markdown for whoever reads the page later, and a
 * fix in our own renderer would only ever help us.
 */
export function attachmentMarkdown(result: {
  url: string
  type: string
}, name: string): string {
  const isImage = result.type.startsWith('image/')
  const label = name.replace(/[[\]\r\n]/g, '').trim() || 'attachment'
  const destination = markdownDestination(result.url)
  return isImage ? `![${label}](${destination})` : `[${label}](${destination})`
}
