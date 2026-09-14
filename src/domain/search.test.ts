import { describe, expect, it } from 'vitest'
import { highlightParts, searchPages } from './search'
import { buildPages } from './pages'
import type { Revision } from './revision'

function rev(slug: string, title: string, content: string): Revision {
  return {
    id: slug,
    author: 'alice',
    createdAt: 1000,
    group: 'engineering',
    slug,
    title,
    parentSlug: null,
    order: null,
    parentRevs: [],
    summary: null,
    content,
    tombstone: false,
  }
}

const pages = buildPages([
  rev('onboarding', 'Onboarding', '# Onboarding\n\nRequest VPN access.\n\nPick up a laptop.'),
  rev('deployment', 'Deployment', '# Deployment\n\nBuild, test, deploy.\n\nVPN is required for this.'),
  rev('leave', 'Leave', '# Leave\n\nFile a request in the tool.'),
])

describe('searchPages', () => {
  it('finds pages by content and sorts by relevance', () => {
    const hits = searchPages(pages, 'vpn')
    expect(hits.map((hit) => hit.page.slug)).toEqual(['deployment', 'onboarding'])
  })

  it('weighs a title hit higher than a content hit', () => {
    const hits = searchPages(pages, 'deployment')
    expect(hits[0].page.slug).toBe('deployment')
    expect(hits[0].titleMatch).toBe(true)
  })

  it('requires every search term', () => {
    expect(searchPages(pages, 'vpn laptop').map((hit) => hit.page.slug)).toEqual(['onboarding'])
    expect(searchPages(pages, 'vpn nonexistent')).toEqual([])
  })

  it('ignores case', () => {
    expect(searchPages(pages, 'ONBOARDING')).toHaveLength(1)
  })

  it('returns nothing for empty input', () => {
    expect(searchPages(pages, '   ')).toEqual([])
  })

  it('returns snippets with a line number and no blank lines', () => {
    const [hit] = searchPages(pages, 'laptop')
    expect(hit.snippets).toEqual([{ line: 5, text: 'Pick up a laptop.' }])
  })
})

describe('highlightParts', () => {
  it('separates hits from the surrounding text', () => {
    expect(highlightParts('Request VPN access', 'vpn')).toEqual([
      { text: 'Request ', hit: false },
      { text: 'VPN', hit: true },
      { text: ' access', hit: false },
    ])
  })

  it('marks several occurrences', () => {
    const parts = highlightParts('VPN and VPN', 'vpn')
    expect(parts.filter((part) => part.hit)).toHaveLength(2)
  })

  it('returns the text unchanged when nothing matches', () => {
    expect(highlightParts('nothing here', 'vpn')).toEqual([{ text: 'nothing here', hit: false }])
  })
})

describe('a hidden page', () => {
  it('is never a search hit — a result is navigation', () => {
    const revisions = [
      rev('notes', 'Release notes', 'the release notes'),
      { ...rev('notes', 'Release notes', 'the release notes'), id: 'gone', createdAt: 2000, parentRevs: ['notes'], tombstone: true },
    ]
    const pages = buildPages(revisions)
    expect(pages[0].hidden).toBe(true)
    expect(searchPages(pages, 'release')).toEqual([])
  })
})

