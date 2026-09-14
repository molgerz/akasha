import { describe, expect, it } from 'vitest'
import { CONTENT_SECURITY_POLICY, CSP_DIRECTIVES } from './csp'
// The raw document, not the DOM: what matters is what ships in index.html,
// including anything a `<script>` tag would carry that jsdom might normalise
// away. `?raw` is Vite's own text import, so this needs no Node types.
import indexHtml from '../index.html?raw'

/**
 * Guards for the CSP invariants (CON-44). Every one of these is a rule the
 * docs state in prose and nothing enforced until now — the failure mode they
 * exist for is a future edit that silences a console error by widening the
 * policy, or that puts an inline script back into index.html, and passes CI
 * untouched.
 */
describe('Content-Security-Policy', () => {
  it('keeps script-src free of unsafe-inline and unsafe-eval', () => {
    expect(CSP_DIRECTIVES['script-src']).not.toContain("'unsafe-inline'")
    expect(CSP_DIRECTIVES['script-src']).not.toContain("'unsafe-eval'")
  })

  it("pins object-src, base-uri and frame-ancestors to 'none'", () => {
    expect(CSP_DIRECTIVES['object-src']).toBe("'none'")
    expect(CSP_DIRECTIVES['base-uri']).toBe("'none'")
    expect(CSP_DIRECTIVES['frame-ancestors']).toBe("'none'")
  })

  it('leaves img-src open to any host', () => {
    // Deliberate, and the one directive most likely to be "tidied up" by
    // someone who has not read docs/09-security-privacy.md: pages embed
    // images from arbitrary hosts and the app loads them directly.
    expect(CSP_DIRECTIVES['img-src'].split(/\s+/)).toContain('*')
  })

  it('serialises every directive into the header value', () => {
    for (const [directive, value] of Object.entries(CSP_DIRECTIVES)) {
      expect(CONTENT_SECURITY_POLICY).toContain(`${directive} ${value}`)
    }
  })

  it('has no inline script in index.html', () => {
    // script-src 'self' blocks inline script bodies outright, with no hash
    // and no nonce to fall back on. This assertion fails against the tree as
    // it stood before CON-44, where the theme bootstrap sat inline here.
    const inlineBodies = [...indexHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1].trim())
      .filter((body) => body.length > 0)

    expect(inlineBodies).toEqual([])
  })
})
