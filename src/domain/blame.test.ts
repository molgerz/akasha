import { describe, expect, it } from 'vitest'
import { blame, firstParentChain } from './blame'
import { buildPages } from './pages'
import type { Revision } from './revision'

function rev(id: string, content: string, parents: string[] = [], author = 'alice'): Revision {
  return {
    id,
    author,
    createdAt: 1000,
    group: 'engineering',
    slug: 'page',
    title: 'Page',
    parentSlug: null,
    order: null,
    parentRevs: parents,
    summary: null,
    content,
  }
}

describe('firstParentChain', () => {
  it('walks back from the head and returns the chain in order', () => {
    const r1 = rev('r1', 'a')
    const r2 = rev('r2', 'a\nb', ['r1'])
    const r3 = rev('r3', 'a\nb\nc', ['r2'])
    expect(firstParentChain([r1, r2, r3], r3).map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('does not break on a cycle', () => {
    const a = rev('a', 'x', ['b'])
    const b = rev('b', 'y', ['a'])
    expect(firstParentChain([a, b], a).map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('stops when a predecessor is missing', () => {
    const r2 = rev('r2', 'a', ['missing'])
    expect(firstParentChain([r2], r2).map((r) => r.id)).toEqual(['r2'])
  })
})

describe('blame', () => {
  it('attributes every line to the revision that introduced it', () => {
    const r1 = rev('r1', 'one\ntwo', [], 'alice')
    const r2 = rev('r2', 'one\ntwo\nthree', ['r1'], 'bob')
    const result = blame([r1, r2], r2)
    expect(result.map((line) => [line.text, line.revision.author])).toEqual([
      ['one', 'alice'],
      ['two', 'alice'],
      ['three', 'bob'],
    ])
  })

  it('attributes a changed line to the revision that changed it', () => {
    const r1 = rev('r1', 'one\ntwo', [], 'alice')
    const r2 = rev('r2', 'one\nTWO', ['r1'], 'bob')
    const result = blame([r1, r2], r2)
    expect(result[0].revision.author).toBe('alice')
    expect(result[1].revision.author).toBe('bob')
  })

  it('keeps the attribution across several revisions', () => {
    const r1 = rev('r1', 'a\nb\nc', [], 'alice')
    const r2 = rev('r2', 'a\nb\nc\nd', ['r1'], 'bob')
    const r3 = rev('r3', 'a\nB\nc\nd', ['r2'], 'carol')
    const result = blame([r1, r2, r3], r3)
    expect(result.map((line) => line.revision.author)).toEqual(['alice', 'carol', 'alice', 'bob'])
  })

  // The page's revisions are already the repaired list (src/domain/pages.ts),
  // so blame walks over the gap without knowing about the deletion itself.
  it('reaches across a removed revision and keeps earlier attribution', () => {
    const r1 = rev('r1', 'one\ntwo\nthree', [], 'alice')
    const r2 = rev('r2', 'one\ntwo\nthree\nfour', ['r1'], 'bob')
    const r3 = rev('r3', 'one\ntwo\nthree\nfour\nfive', ['r2'], 'carol')
    const page = buildPages([r1, r2, r3], new Map(), new Set(['r2']))[0]

    const result = blame(page.revisions, page.head)

    expect(result.map((line) => [line.text, line.revision.author])).toEqual([
      ['one', 'alice'],
      ['two', 'alice'],
      ['three', 'alice'],
      ['four', 'carol'],
      ['five', 'carol'],
    ])
  })

  it('yields no lines for an empty head instead of crashing', () => {
    const head = rev('head', '')
    expect(blame([head], head)).toEqual([])
  })
})
