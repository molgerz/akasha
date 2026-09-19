/**
 * The app's own views and a space's page slugs share the /s/:group prefix.
 * Where a slug can end, the views must not begin: every app-view path starts
 * with '~', and normalizeSlug (src/nostr/kinds.ts) keeps only letters,
 * numbers, combining marks and '-' — so no slug can ever produce a segment
 * starting with '~', whatever client wrote the page (CON-50). The invariant
 * is pinned by the corpus test in space-urls.test.ts; the reasoning lives in
 * docs/06-ui-information-architecture.md.
 */
export const APP_VIEW_PREFIX = '~'

/**
 * The route pattern for one space, mirroring the ':group' parameter in the
 * router. App-view paths are built from it, so a route can never end up
 * relative (":group/~new") and match nothing.
 */
export const SPACE_ROUTE_PATTERN = '/s/:group'

/** Appends query parameters, dropping the ones that are absent or empty. */
function withQuery(url: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value)
  }
  const query = search.toString()
  return query === '' ? url : `${url}?${query}`
}

/**
 * The "create a page" view. 'slug' pre-fills the editor with a title that has
 * no page yet (from PageView's empty state), 'parent' makes the new page a
 * subpage of the given one.
 */
export function spaceNewUrl(base: string, opts: { slug?: string; parent?: string } = {}): string {
  return withQuery(`${base}/${APP_VIEW_PREFIX}new`, { slug: opts.slug, parent: opts.parent })
}

/** The search view; 'q' carries the query typed into the Topbar. */
export function spaceSearchUrl(base: string, q?: string): string {
  return withQuery(`${base}/${APP_VIEW_PREFIX}search`, { q })
}

/** The archive listing. */
export function spaceArchiveUrl(base: string): string {
  return `${base}/${APP_VIEW_PREFIX}archive`
}
