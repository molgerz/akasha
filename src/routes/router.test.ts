// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { matchRoutes } from 'react-router-dom'
import { router } from './router'
import { SPACE_ROUTE_PATTERN, spaceArchiveUrl, spaceNewUrl, spaceSearchUrl } from './space-urls'

// A space URL as the app builds it: /s/ plus the encoded host'group address.
const BASE = `/s/${encodeURIComponent("localhost:8080'engineering")}`

function lastMatch(pathname: string): string | undefined {
  return matchRoutes(router.routes, pathname)?.at(-1)?.route.path
}

describe('the space route table (CON-50)', () => {
  // The literal paths, not the builders: the builders are what builds them,
  // so comparing them to themselves would pass even if every route came out
  // relative and matched nothing.
  it.each([
    ['new page', '/s/:group/~new'],
    ['search', '/s/:group/~search'],
    ['archive', '/s/:group/~archive'],
  ])('serves the %s view from an absolute, prefixed path', (_name, path) => {
    const paths = router.routes[0].children!.map((r) => r.path)
    expect(paths).toContain(path)
    // No route may be relative to the layout route: ':group/~new' matched
    // nothing and left every view unreachable.
    expect(paths.every((p) => p === undefined || p.startsWith('/') || p === '*')).toBe(true)
  })

  it('builds the view routes from the shared pattern, so they cannot drift from the links', () => {
    const paths = router.routes[0].children!.map((r) => r.path)
    expect(paths).toContain(spaceNewUrl(SPACE_ROUTE_PATTERN))
    expect(paths).toContain(spaceSearchUrl(SPACE_ROUTE_PATTERN))
    expect(paths).toContain(spaceArchiveUrl(SPACE_ROUTE_PATTERN))
  })

  it.each([
    ['archive', spaceArchiveUrl(SPACE_ROUTE_PATTERN)],
    ['search', spaceSearchUrl(SPACE_ROUTE_PATTERN)],
    ['new', spaceNewUrl(SPACE_ROUTE_PATTERN)],
  ])('resolves a page called %j to PageView, not to the app view', (slug, viewPath) => {
    expect(lastMatch(`${BASE}/${slug}`)).toBe('/s/:group/:slug')
    expect(viewPath.startsWith('/s/:group/')).toBe(true)
  })

  it.each([
    ['new page', spaceNewUrl(BASE), '/s/:group/~new'],
    ['search', spaceSearchUrl(BASE), '/s/:group/~search'],
    ['archive', spaceArchiveUrl(BASE), '/s/:group/~archive'],
  ])('matches the %s URL to its own view route', (_name, url, path) => {
    expect(lastMatch(url)).toBe(path)
  })

  it('keeps the search query on the search route', () => {
    expect(lastMatch(spaceSearchUrl(BASE, 'two words'))).toBe('/s/:group/~search')
  })

  it('leaves page URLs untouched — the ones people share', () => {
    expect(lastMatch(`${BASE}/roadmap`)).toBe('/s/:group/:slug')
    expect(lastMatch(`${BASE}/roadmap/history`)).toBe('/s/:group/:slug/history')
    expect(lastMatch(BASE)).toBe('/s/:group')
  })
})
