/**
 * The Content-Security-Policy the app expects to be served with (CON-44).
 *
 * This is the second layer behind the Markdown sanitiser, not a replacement
 * for it: the app renders Markdown written by arbitrary public keys, so a
 * regression in the sanitising pipeline — or a compromised npm dependency —
 * should still find no way to execute a script. See
 * docs/09-security-privacy.md.
 *
 * It is delivered as an HTTP response header, never as a
 * `<meta http-equiv>` tag: `frame-ancestors`, `report-to` and `sandbox` are
 * ignored in meta form, and `frame-ancestors 'none'` is part of this policy.
 * `vite.config.ts` puts it on `preview.headers`, so
 * `npm run build && npm run preview` serves the production build under the
 * policy and it can be checked on the artefact that ships — with one
 * deliberate difference, `connect-src`, so that the local relay stays
 * reachable there. See `PREVIEW_CSP_DIRECTIVES` at the bottom of this file.
 *
 * The repo does not deploy itself — there is no app Dockerfile, no nginx or
 * Caddy config, no `_headers`/`netlify.toml`/`vercel.json`. Whatever host is
 * eventually chosen has to send this header; until then the policy is tested
 * but nothing in production delivers it.
 *
 * It lives in its own module, rather than inside `vite.config.ts`, so that
 * `src/csp.test.ts` can assert the invariants below without importing the
 * config and booting its plugins. There is still exactly one definition:
 * the config imports this one. Nothing under `src/` imports it, so it never
 * reaches the bundle.
 */
export const CSP_DIRECTIVES: Record<string, string> = {
  'default-src': "'self'",

  // No 'unsafe-inline' and no 'unsafe-eval'. The theme bootstrap moved out of
  // index.html into public/theme-bootstrap.js for this, and src/ contains no
  // eval and no `new Function`.
  'script-src': "'self'",

  // 'unsafe-inline' here is forced and deliberate, and the binding constraint
  // is CodeMirror, not React. @codemirror/view mounts its theme through
  // style-mod's StyleModule.mount, which — for a document root, i.e. every
  // mount in this app, since nothing here uses shadow DOM — creates a
  // `<style>` element and assigns its textContent
  // (node_modules/style-mod/dist/style-mod.cjs:87-94,128). That is an inline
  // style *element*, governed by style-src-elem, and no refactor of our own
  // code removes it: only a per-response nonce would
  // (@codemirror/view exposes EditorView.cspNonce for that), which a static
  // host cannot mint.
  //
  // Secondary, and by itself removable: five computed React `style`
  // attributes — src/ui/Markdown.tsx:131 and :180 (the per-token Shiki
  // styles, by far the most numerous at runtime),
  // src/ui/layout/TableOfContents.tsx:39, src/ui/layout/Sidebar.tsx:481
  // and :626. CSP governs style attributes too, through style-src-attr, so
  // without 'unsafe-inline' those would silently stop applying — no error,
  // just wrong indentation and unhighlighted code.
  //
  // Only script-src has to stay free of 'unsafe-inline'; an inline style
  // cannot execute script.
  'style-src': "'self' 'unsafe-inline'",

  // Deliberately open — do not "fix" this. Pages may embed images from any
  // host and the app loads them directly, by an explicit decision documented
  // under "Images are loaded directly" in docs/09-security-privacy.md.
  // `*` does not cover the `data:` scheme, so it is listed separately. No
  // `blob:`: src/ never calls createObjectURL.
  'img-src': '* data:',

  // Scheme-scoped on purpose. The space relay is chosen at runtime from the
  // route — whoever wrote the link picks the host — and the app also fetches
  // that host's NIP-11 document over https (src/nostr/relay-status.ts), plus
  // the profile relays from VITE_PROFILE_RELAYS and the Blossom server from
  // VITE_BLOSSOM_SERVER. A static policy is fixed at build time, so no host
  // allowlist can be built without breaking every shared space link. This
  // follows from the relay-trust decision (CON-46), it is not an oversight.
  'connect-src': "'self' https: wss:",

  // No web fonts in the repo.
  'font-src': "'self'",

  // No <object>/<embed>, no iframes, and Shiki highlights on the main thread.
  'object-src': "'none'",
  'frame-src': "'none'",
  'worker-src': "'none'",

  // No <base> rewriting, no form posts anywhere (the app submits none), and
  // the app is never meant to be framed. frame-ancestors is the directive
  // that needs the header form.
  'base-uri': "'none'",
  'form-action': "'none'",
  'frame-ancestors': "'none'",
}

function serialize(directives: Record<string, string>): string {
  return Object.entries(directives)
    .map(([directive, value]) => `${directive} ${value}`)
    .join('; ')
}

/**
 * The policy a host is expected to send. This is the one that ships, and the
 * one `src/csp.test.ts` pins.
 */
export const CONTENT_SECURITY_POLICY: string = serialize(CSP_DIRECTIVES)

/**
 * Loopback origins, added to `connect-src` for `npm run preview` only.
 *
 * Both spellings are needed: CSP matches a host source by name and resolves
 * nothing, so `localhost` and `127.0.0.1` are different sources. `[::1]`
 * cannot be expressed at all — CSP's host-part grammar allows only letters,
 * digits, hyphens and dots, so an IPv6 literal is an invalid source
 * expression that a browser drops. A dev relay reachable only over IPv6
 * therefore stays blocked under the preview policy; the scripts in this repo
 * bind IPv4.
 *
 * The port is left open (`:*`) rather than pinned to 8080/8081/3355: the
 * relay, the profile relay and the Blossom server all sit on different ports
 * and the values are configuration (`VITE_RELAY_URL`, `VITE_PROFILE_RELAYS`,
 * `VITE_BLOSSOM_SERVER`), so pinning them would only produce a policy that
 * has to be edited whenever a port moves.
 */
export const LOCAL_CONNECT_SOURCES =
  'ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*'

/**
 * The shipped directives with loopback added to `connect-src`, and nothing
 * else touched — what `npm run preview` serves.
 *
 * Under the shipped `connect-src` a preview run cannot load a space at all:
 * the dev relay is `ws://localhost:<port>` with an `http://` NIP-11 fetch to
 * the same host, the Blossom server is `http://localhost:3355`, and `'self'`
 * does not cover them because the previewed origin is a different port. The
 * run would then prove only that a header arrives, which is not what
 * `preview.headers` is for. The cost — `connect-src` is the one directive a
 * preview run no longer checks as shipped — and why that is the cheapest one
 * to give up are argued in docs/09-security-privacy.md.
 *
 * Derived rather than written out a second time: two hand-kept policy
 * strings drift, and the drift would be invisible, since only one of them is
 * ever served by anything. `src/csp.test.ts` asserts that the two differ in
 * `connect-src` and nowhere else, so relaxing a second directive "just for
 * preview" fails the suite.
 */
export const PREVIEW_CSP_DIRECTIVES: Record<string, string> = {
  ...CSP_DIRECTIVES,
  'connect-src': `${CSP_DIRECTIVES['connect-src']} ${LOCAL_CONNECT_SOURCES}`,
}

/** What `vite.config.ts` puts on `preview.headers`. Never served by a host. */
export const PREVIEW_CONTENT_SECURITY_POLICY: string = serialize(PREVIEW_CSP_DIRECTIVES)
