import { describe, expect, it } from 'vitest'
import { normaliseInvisibleLines, rehypeBlankLines } from './markdown-blank-lines'

type HastNode = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
  position?: { start: { line: number }; end: { line: number } }
}

/** a block that occupies the lines `from` … `to` of the source */
const block = (from: number, to = from): HastNode => ({
  type: 'element',
  tagName: 'p',
  children: [],
  position: { start: { line: from }, end: { line: to } },
})

const gap = '1rem'

function run(children: HastNode[]): HastNode[] {
  const tree: HastNode = { type: 'root', children }
  rehypeBlankLines({ blank: gap })(tree)
  return tree.children ?? []
}

/** the heights of the spacers that were put in, in order */
const heights = (nodes: HastNode[]) =>
  nodes.filter((n) => n.tagName === 'div').map((n) => n.properties?.style)

describe('rehypeBlankLines', () => {
  it('keeps the single empty line that separates two paragraphs', () => {
    // line 1 = text, line 2 = empty, line 3 = text. The writer typed a line,
    // so the page draws a line — the same as the editor.
    expect(heights(run([block(1), block(3)]))).toEqual([`height:calc(1 * ${gap})`])
  })

  it('keeps one empty line per line the writer left', () => {
    // three empty lines between them are three lines tall
    expect(heights(run([block(1), block(5)]))).toEqual([`height:calc(3 * ${gap})`])
  })

  it('keeps the empty lines before the first block — there is nothing to separate', () => {
    expect(heights(run([block(3)]))).toEqual([`height:calc(2 * ${gap})`])
  })

  it('puts the spacer in front of the block it belongs to', () => {
    const out = run([block(1), block(4)])
    expect(out.map((n) => n.tagName)).toEqual(['p', 'div', 'p'])
  })

  it('measures from the end of a block, not from where it started', () => {
    // a block over lines 1–3, one empty line, then the next: one line kept
    expect(heights(run([block(1, 3), block(5)]))).toEqual([`height:calc(1 * ${gap})`])
  })

  it('puts no spacer after the last block — trailing lines are where the cursor was left', () => {
    const out = run([block(1), block(3)])
    expect(out.map((n) => n.tagName ?? n.type)).toEqual(['p', 'div', 'p'])
    expect(out.at(-1)?.tagName).toBe('p')
  })

  it('passes the newlines between blocks through untouched', () => {
    const newline: HastNode = { type: 'text' }
    const out = run([block(1), newline, block(5)])
    expect(out.map((n) => n.tagName ?? n.type)).toEqual(['p', 'text', 'div', 'p'])
  })
})

describe('normaliseInvisibleLines', () => {
  it('turns a line holding only U+00A0 into an empty line', () => {
    expect(normaliseInvisibleLines('a\n\u00a0\nb')).toBe('a\n\nb')
  })

  it('turns the other invisible spaces and zero-width characters into empty lines', () => {
    const invisible = ['\u2009', '\u202f', '\u3000', '\u200b', '\u2060']
    for (const character of invisible) {
      expect(normaliseInvisibleLines(`a\n${character}\nb`)).toBe('a\n\nb')
    }
  })

  it('turns an ASCII space or tab line into an empty line — already blank to CommonMark', () => {
    expect(normaliseInvisibleLines('a\n   \nb')).toBe('a\n\nb')
    expect(normaliseInvisibleLines('a\n\t\nb')).toBe('a\n\nb')
  })

  it('keeps an invisible character that sits inside real text', () => {
    expect(normaliseInvisibleLines('a\u00a0b')).toBe('a\u00a0b')
    expect(normaliseInvisibleLines('a\u200bb')).toBe('a\u200bb')
  })

  it('leaves ordinary lines and empty lines as they are', () => {
    expect(normaliseInvisibleLines('a\n\nb')).toBe('a\n\nb')
  })
})
