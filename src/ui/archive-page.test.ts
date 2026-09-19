import { describe, expect, it } from 'vitest'
import { archiveConfirmation } from './archive-page'
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
    archived: false,
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
 * The confirmation is the only place a user is told what archiving a page does
 * before they do it, and both of its claims are ones people assume the other
 * way round: the page survives for anyone with the link, and the subpages do
 * not go with it. A reworded dialogue that quietly drops either is the failure
 * this guards. docs/05-versioning-history.md
 */
describe('archiveConfirmation', () => {
  it('names the page in the title and says nothing is deleted', () => {
    const { title, body } = archiveConfirmation(page('deploy'), 0)
    expect(title).toContain('"Deploy"')
    expect(body).toContain('Nothing is deleted')
    expect(body).toContain('bring it back')
  })

  it('warns that the subpages stay behind, counted', () => {
    const subpages = childSlugs(pages, 'handbook')
    expect(subpages).toHaveLength(2)
    expect(archiveConfirmation(page('handbook'), subpages.length).subpages).toContain(
      'Its 2 subpages will stay',
    )
  })

  it('counts a single subpage in the singular', () => {
    expect(archiveConfirmation(page('handbook'), 1).subpages).toContain('Its 1 subpage will stay')
  })

  it('has nothing to say about subpages when there are none', () => {
    // null and not an empty string: the dialog renders a paragraph per part,
    // and an empty one would be a blank line nobody put there.
    expect(archiveConfirmation(page('deploy'), 0).subpages).toBeNull()
  })
})
