import { describe, expect, it } from 'vitest'
import { attachmentMarkdown, resolveAttachmentUrl } from './blossom'

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

  // The other half of the same problem: a `)` ends the destination just as a
  // `]` ends the label, and whitespace starts the link title behind it.
  it('encodes the characters that would end the destination early', () => {
    expect(attachmentMarkdown({ url: 'https://x/a)b.png', type: 'image/png' }, 'p.png')).toBe(
      '![p.png](https://x/a%29b.png)',
    )

    expect(attachmentMarkdown({ url: 'https://x/a b.png', type: 'image/png' }, 'p.png')).toBe(
      '![p.png](https://x/a%20b.png)',
    )
    expect(attachmentMarkdown({ url: 'https://x/a<b>c\\d(e.png', type: '' }, 'p.png')).toBe(
      '[p.png](https://x/a%3Cb%3Ec%5Cd%28e.png)',
    )
  })

  // `\s` matches more than a space, and percent-encoding is defined over UTF-8
  // bytes: from its UTF-16 code unit, U+00A0 would come out as the undecodable
  // `%A0` and U+2003 as `%2003`, which decodes to `%20` plus a literal `03`.
  it('encodes non-ASCII whitespace as the bytes a reader can decode again', () => {
    expect(attachmentMarkdown({ url: 'https://x/a\u00a0b.png', type: 'image/png' }, 'p.png')).toBe(
      '![p.png](https://x/a%C2%A0b.png)',
    )
    expect(attachmentMarkdown({ url: 'https://x/a\u2003b.png', type: 'image/png' }, 'p.png')).toBe(
      '![p.png](https://x/a%E2%80%83b.png)',
    )
    expect(decodeURIComponent('https://x/a%C2%A0b.png')).toBe('https://x/a\u00a0b.png')
  })

  it('leaves an ordinary url byte for byte alone', () => {
    const url = 'https://blossom.example/a1b2c3.png?v=2&x=1'
    expect(attachmentMarkdown({ url, type: 'image/png' }, 'p.png')).toBe(`![p.png](${url})`)
  })
})

describe('resolveAttachmentUrl', () => {
  // `new URL` parses these happily, so the protocol check is what rejects them.
  it('refuses a scheme that is not http(s) and addresses the blob by its hash instead', () => {
    expect(resolveAttachmentUrl({ url: 'javascript:alert(1)' }, 'abc', 'https://b.example')).toBe(
      'https://b.example/abc',
    )
    expect(resolveAttachmentUrl({ url: 'data:text/html,x' }, 'abc', 'https://b.example')).toBe(
      'https://b.example/abc',
    )
  })

  it('keeps an absolute http(s) url the server returned', () => {
    expect(resolveAttachmentUrl({ url: 'https://cdn.example/abc' }, 'abc', 'https://b.example')).toBe(
      'https://cdn.example/abc',
    )
    expect(resolveAttachmentUrl({ url: 'http://cdn.example/abc' }, 'abc', 'https://b.example')).toBe(
      'http://cdn.example/abc',
    )
  })

  it('falls back when there is no usable url at all', () => {
    expect(resolveAttachmentUrl({}, 'abc', 'https://b.example')).toBe('https://b.example/abc')
    expect(resolveAttachmentUrl({ url: 42 }, 'abc', 'https://b.example')).toBe('https://b.example/abc')
    expect(resolveAttachmentUrl(null, 'abc', 'https://b.example')).toBe('https://b.example/abc')
  })

  // A relative url throws in `new URL` and takes the same way out.
  it('falls back for a relative url', () => {
    expect(resolveAttachmentUrl({ url: '../relative' }, 'abc', 'https://b.example')).toBe(
      'https://b.example/abc',
    )
  })

  // A configured server ending in `/` used to produce `https://b.example//abc`.
  it('does not double the slash when the configured server ends in one', () => {
    expect(resolveAttachmentUrl({}, 'abc', 'https://b.example/')).toBe('https://b.example/abc')
  })

  // `new URL` ignores this padding, so the gate passes; handing the padded
  // string on would store `%20https://x/a%20` and break the link it accepted.
  it('drops the padding the URL parser ignored', () => {
    expect(resolveAttachmentUrl({ url: ' https://x/a ' }, 'abc', 'https://b.example')).toBe(
      'https://x/a',
    )
    expect(resolveAttachmentUrl({ url: '\r\nhttps://x/a\t' }, 'abc', 'https://b.example')).toBe(
      'https://x/a',
    )
  })

  // …and no further: U+00A0 is part of the path to the URL parser, so removing
  // it (as `trim()` would) would point the link at a different blob.
  it('keeps Unicode whitespace the URL parser counts as part of the path', () => {
    expect(resolveAttachmentUrl({ url: 'https://x/a\u00a0' }, 'abc', 'https://b.example')).toBe(
      'https://x/a\u00a0',
    )
  })
})
