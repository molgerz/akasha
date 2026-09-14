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
 * `npm run build && npm run preview` serves the production build with the
 * real header and the policy can be checked on the artefact that ships.
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

export const CONTENT_SECURITY_POLICY: string = Object.entries(CSP_DIRECTIVES)
  .map(([directive, value]) => `${directive} ${value}`)
  .join('; ')
