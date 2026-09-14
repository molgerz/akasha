// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { AkashaMark } from './AkashaMark'

/**
 * The mark is a violet tile with a white wave on it, and two properties of
 * that are invisible in the markup and would break quietly: it must not be
 * announced a second time next to the wordmark, and two marks on one page must
 * not share a gradient id -- the second would then paint through a reference
 * that no longer resolves to the gradient it wrote.
 */
function render(node: ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(node)
  })
  return host
}

describe('AkashaMark', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('stays out of the accessible name, which the wordmark already carries', () => {
    const host = render(<AkashaMark />)
    expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('is a tile with the wave knocked out in white', () => {
    const host = render(<AkashaMark />)
    expect(host.querySelector('rect')?.getAttribute('rx')).toBe('22')
    expect(host.querySelector('g')?.getAttribute('fill')).toBe('#fff')
    expect(host.querySelectorAll('path')).toHaveLength(2)
  })

  it('paints each instance from its own gradient', () => {
    const host = render(
      <>
        <AkashaMark />
        <AkashaMark />
      </>,
    )
    const ids = [...host.querySelectorAll('linearGradient')].map((g) => g.id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
    for (const id of ids) {
      // Whatever useId() returns has to survive a url(#...) reference unescaped.
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    }
    const fills = [...host.querySelectorAll('rect')].map((r) => r.getAttribute('fill'))
    expect(fills).toEqual([`url(#${ids[0]})`, `url(#${ids[1]})`])
  })
})
