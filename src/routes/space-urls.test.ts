import { describe, expect, it } from 'vitest'
import { normalizeSlug } from '../nostr/kinds'
import {
  APP_VIEW_PREFIX,
  spaceArchiveUrl,
  spaceNewUrl,
  spaceSearchUrl,
} from './space-urls'

const BASE = "/s/localhost%3A8080'engineering"

describe('space-urls', () => {
  it.each([
    ['new', spaceNewUrl(BASE), `${BASE}/~new`],
    ['new with a pre-filled slug', spaceNewUrl(BASE, { slug: '_archive' }), `${BASE}/~new?slug=_archive`],
    ['new as a subpage', spaceNewUrl(BASE, { parent: 'notes' }), `${BASE}/~new?parent=notes`],
    ['search', spaceSearchUrl(BASE), `${BASE}/~search`],
    ['search with a query', spaceSearchUrl(BASE, 'two words'), `${BASE}/~search?q=two+words`],
    ['archive', spaceArchiveUrl(BASE), `${BASE}/~archive`],
  ])('builds the %s url behind the prefix', (_name, actual, expected) => {
    expect(actual).toBe(expected)
  })

  it('keeps slug and parent apart when both are given', () => {
    expect(spaceNewUrl(BASE, { slug: 'a', parent: 'b' })).toBe(`${BASE}/~new?slug=a&parent=b`)
  })
})

describe('the app-view prefix cannot collide with a page slug (CON-50)', () => {
  // The app routes are reachable only because no slug can ever begin with
  // the prefix. normalizeSlug keeps only letters, numbers, combining marks
  // and '-', so '~' and '_' cannot survive — this corpus pins that property
  // for the inputs that matter: the colliding titles, the prefix characters
  // themselves, and the shapes that try to sneak them through (NFC vs NFD,
  // separator padding, emoji that could leave an invisible remainder).
  const corpus = [
    'Archive', 'Search', 'New', 'archive', 'search', 'new',
    '~', '~~archive', '~archive', '_archive', '-~archive',
    ' Archive ', 'archive\u00a0', 'a\u0303', '\u00d1o\u006e\u006f',
    'Roadmap \ud83d\ude80', '???', '   ', '', '\u{1d407}\u{1d41e}\u{1d425}',
    'seite ~neu', 'tilde-title', '\u00fe~-', '!!!!', '\u037earchive',
  ]

  it.each(corpus)('normalizeSlug(%j) never starts with %s', (input) => {
    const slug = normalizeSlug(input)
    expect(slug.startsWith(APP_VIEW_PREFIX)).toBe(false)
  })

  it('strips the prefix characters outright, so no title can smuggle them in', () => {
    expect(normalizeSlug('~archive')).toBe('archive')
    expect(normalizeSlug('_archive')).toBe('archive')
    expect(normalizeSlug('~')).toBe('')
  })
})
