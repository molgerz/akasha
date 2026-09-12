import { describe, expect, it } from 'vitest'
import { attachmentMarkdown } from './blossom'

describe('attachmentMarkdown', () => {
  it('embeds images', () => {
    expect(
      attachmentMarkdown({ url: 'http://x/abc', type: 'image/png' }, 'screenshot.png'),
    ).toBe('![screenshot.png](http://x/abc)')
  })

  it('links everything else instead of embedding it as an image', () => {
    expect(attachmentMarkdown({ url: 'http://x/abc', type: 'application/pdf' }, 'contract.pdf')).toBe(
      '[contract.pdf](http://x/abc)',
    )
    expect(attachmentMarkdown({ url: 'http://x/abc', type: '' }, 'data.bin')).toBe(
      '[data.bin](http://x/abc)',
    )
  })

  // The filename is user input inside the label: a `]` or a line break there
  // would end the link early and let the rest of the file name become the text.
  it('strips the characters that would break the label out of its brackets', () => {
    expect(attachmentMarkdown({ url: 'http://x/abc', type: 'image/png' }, 'a[b]c\nd.png')).toBe(
      '![abcd.png](http://x/abc)',
    )
  })

  it('falls back to a neutral label when nothing readable is left', () => {
    expect(attachmentMarkdown({ url: 'http://x/abc', type: '' }, '[]')).toBe(
      '[attachment](http://x/abc)',
    )
  })
})
