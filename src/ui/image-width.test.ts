import { describe, expect, it } from 'vitest'
import { clampImageWidth, imageWidth, withImageWidth } from './image-width'

describe('the width of an image, kept in its URL', () => {
  it('reads a width out of the fragment and nothing else', () => {
    expect(imageWidth('http://host/a.png')).toBeNull()
    expect(imageWidth('http://host/a.png#width=480')).toBe(480)
    expect(imageWidth('http://host/a.png#width=0')).toBeNull()
    expect(imageWidth('http://host/a.png#width=abc')).toBeNull()
    expect(imageWidth('http://host/a.png#viewBox')).toBeNull()
  })

  it('sets, replaces and clears it', () => {
    expect(withImageWidth('http://host/a.png', 480)).toBe('http://host/a.png#width=480')
    expect(withImageWidth('http://host/a.png#width=200', 480)).toBe('http://host/a.png#width=480')
    expect(withImageWidth('http://host/a.png#width=480', null)).toBe('http://host/a.png')
  })

  it('is one entry in the fragment, not the whole fragment', () => {
    // Somebody else's fragment parameter survives — this is their URL, not ours.
    expect(withImageWidth('http://host/a.svg#viewBox=0 0 1 1', 480)).toBe(
      'http://host/a.svg#viewBox=0 0 1 1&width=480',
    )
    expect(withImageWidth('http://host/a.svg#viewBox=0 0 1 1&width=480', null)).toBe(
      'http://host/a.svg#viewBox=0 0 1 1',
    )
  })

  it('keeps a width inside what a picture can be', () => {
    expect(clampImageWidth(0)).toBe(80)
    expect(clampImageWidth(10_000)).toBe(2400)
    expect(clampImageWidth(480.6)).toBe(481)
    expect(withImageWidth('http://host/a.png', 5)).toBe('http://host/a.png#width=80')
  })
})
