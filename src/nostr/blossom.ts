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
    const descriptor = body as Record<string, unknown>
    const url = typeof descriptor.url === 'string' ? descriptor.url : `${BLOSSOM_SERVER}/${hash}`
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
 * Markdown embed for an uploaded file.
 *
 * The filename is user input and goes inside the label, where a `]`, a `[` or a
 * line break would end it early and break the Markdown — a file called
 * `notes].md` would produce a link whose target swallows the rest of the line.
 * Those characters are dropped and, if nothing readable is left, the label
 * falls back to a neutral word.
 */
export function attachmentMarkdown(result: {
  url: string
  type: string
}, name: string): string {
  const isImage = result.type.startsWith('image/')
  const label = name.replace(/[[\]\r\n]/g, '').trim() || 'attachment'
  return isImage ? `![${label}](${result.url})` : `[${label}](${result.url})`
}
