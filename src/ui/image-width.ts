/**
 * How large an image is drawn — kept in its URL.
 *
 * `![alt](url)` has no room for a size: the alt text is a label, the title is a
 * tooltip, and this app renders no raw HTML (`rehype-sanitize` strips it). Any
 * syntax invented for it — `{width=480}`, `=480x` — would be printed as text by
 * every other Nostr client, because they would not know it.
 *
 * A URL fragment is the one place that is already there. No server ever sees it
 * (browsers strip it from the request), no client draws it, and the picture
 * itself is unchanged: `http://host/<sha256>#width=480`. A client that knows
 * nothing about it fetches the same image and draws it at its natural size.
 *
 * **Cost, stated plainly:** the fragment is visible in the source, the history
 * and the diff, and another client draws the image at natural size rather than
 * the width chosen here. docs/13-editing.md
 */

/** Nobody resizes a picture into nothing, and nobody needs 4000px of it. */
export const MIN_IMAGE_WIDTH = 80
export const MAX_IMAGE_WIDTH = 2400

/** The fragment parameter the width lives in. */
const PARAM = 'width'

/** The width an image URL asks for, in CSS pixels, or `null` if it asks for none. */
export function imageWidth(src: string): number | null {
  const hash = src.indexOf('#')
  if (hash < 0) return null
  for (const part of src.slice(hash + 1).split('&')) {
    const [key, value = ''] = part.split('=')
    if (key !== PARAM || !/^\d+$/.test(value)) continue
    const width = Number(value)
    if (width > 0) return width
  }
  return null
}

/**
 * The same URL with a width — or without one, for `null`. Other fragment
 * parameters are kept: ours is one entry in the list, not the whole fragment.
 */
export function withImageWidth(src: string, width: number | null): string {
  const hash = src.indexOf('#')
  const base = hash < 0 ? src : src.slice(0, hash)
  const parts = (hash < 0 ? [] : src.slice(hash + 1).split('&')).filter(
    (part) => part.length > 0 && part.split('=')[0] !== PARAM,
  )
  if (width !== null) parts.push(`${PARAM}=${clampImageWidth(width)}`)
  return parts.length === 0 ? base : `${base}#${parts.join('&')}`
}

export function clampImageWidth(width: number): number {
  return Math.min(MAX_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, Math.round(width)))
}
