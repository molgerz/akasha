import { describe, expect, it } from 'vitest'
import { hideConfirmation } from './hide-page'
import { buildPages, childSlugs } from '../domain/pages'
import type { Revision } from '../domain/revision'

function rev(slug: string, title: string, parentSlug: string | null = null): Revision {
  return {
    id: slug,
    author: 'alice',
    createdAt: 1000,
    group: 'engineering',
    slug,
    title,
    parentSlug,
    order: null,
    parentRevs: [],
    summary: null,
    content: 'text',
    tombstone: false,
  }
}

const pages = buildPages([
  rev('handbook', 'Handbook'),
  rev('onboarding', 'Onboarding', 'handbook'),
  rev('leave', 'Leave', 'handbook'),
  rev('deploy', 'Deploy'),
])

function page(slug: string) {
  const found = pages.find((entry) => entry.slug === slug)
  if (!found) throw new Error(`no page ${slug}`)
  return found
}

/**
 * The confirmation is the only place a user is told what removing a page does
 * before they do it, and both of its claims are ones people assume the other
 * way round: the page survives for anyone with the link, and the subpages do
 * not go with it. A reworded dialogue that quietly drops either is the failure
 * this guards. docs/05-versioning-history.md
 */
describe('hideConfirmation', () => {
  it('names the page and says nothing is deleted', () => {
    const text = hideConfirmation(page('deploy'), 0)
    expect(text).toContain('"Deploy"')
    expect(text).toContain('Nothing is deleted')
    expect(text).toContain('bring it back')
  })

  it('warns that the subpages stay behind, counted', () => {
    const subpages = childSlugs(pages, 'handbook')
    expect(subpages).toHaveLength(2)
    expect(hideConfirmation(page('handbook'), subpages.length)).toContain('Its 2 subpages will stay')
  })

  it('counts a single subpage in the singular', () => {
    expect(hideConfirmation(page('handbook'), 1)).toContain('Its 1 subpage will stay')
  })

  it('says nothing about subpages when there are none', () => {
    expect(hideConfirmation(page('deploy'), 0)).not.toContain('subpage')
  })
})
