import { describe, expect, it } from 'vitest'
import {
  CONTENT_SECURITY_POLICY,
  CSP_DIRECTIVES,
  LOCAL_CONNECT_SOURCES,
  PREVIEW_CONTENT_SECURITY_POLICY,
  PREVIEW_CSP_DIRECTIVES,
} from './csp'
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

  it.each([
    ['shipped', CSP_DIRECTIVES, CONTENT_SECURITY_POLICY],
    ['preview', PREVIEW_CSP_DIRECTIVES, PREVIEW_CONTENT_SECURITY_POLICY],
  ])('serialises every %s directive into its header value', (_name, directives, header) => {
    expect(header.split('; ')).toHaveLength(Object.keys(directives).length)
    for (const [directive, value] of Object.entries(directives)) {
      expect(header).toContain(`${directive} ${value}`)
    }
  })

  it('keeps the shipped policy free of plaintext schemes', () => {
    // The rejected way out of the preview problem: widening the shipped
    // connect-src by `ws:`/`http:` would permit plaintext to *any* host,
    // which is most of what CON-45 exists to prevent. Loopback belongs in
    // the preview variant only.
    const sources = CSP_DIRECTIVES['connect-src'].split(/\s+/)
    expect(sources).not.toContain('ws:')
    expect(sources).not.toContain('http:')
    expect(CONTENT_SECURITY_POLICY).not.toContain('localhost')
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

/**
 * The preview policy is the shipped one with loopback allowed in
 * `connect-src`, so that `npm run preview` can walk the app against the
 * local relay under the real header. These exist to keep that difference
 * from growing: the moment a second directive is relaxed "just for preview",
 * the run stops saying anything about what a host will serve.
 */
describe('the preview policy', () => {
  it('differs from the shipped policy in connect-src and nowhere else', () => {
    expect(Object.keys(PREVIEW_CSP_DIRECTIVES)).toEqual(Object.keys(CSP_DIRECTIVES))
    for (const directive of Object.keys(CSP_DIRECTIVES)) {
      if (directive === 'connect-src') continue
      expect(PREVIEW_CSP_DIRECTIVES[directive]).toBe(CSP_DIRECTIVES[directive])
    }
  })

  it('adds the loopback sources to connect-src and removes none', () => {
    expect(PREVIEW_CSP_DIRECTIVES['connect-src'].split(/\s+/)).toEqual([
      ...CSP_DIRECTIVES['connect-src'].split(/\s+/),
      ...LOCAL_CONNECT_SOURCES.split(/\s+/),
    ])
  })

  it('covers the local relay under both spellings, on any port', () => {
    // CSP matches a host source by name and resolves nothing, so localhost
    // and 127.0.0.1 are different sources and both have to be listed. The
    // ports are configuration (VITE_RELAY_URL, VITE_PROFILE_RELAYS,
    // VITE_BLOSSOM_SERVER), hence `:*`. `[::1]` has no valid CSP spelling.
    expect(LOCAL_CONNECT_SOURCES.split(/\s+/)).toEqual([
      'ws://localhost:*',
      'http://localhost:*',
      'ws://127.0.0.1:*',
      'http://127.0.0.1:*',
    ])
  })
})
