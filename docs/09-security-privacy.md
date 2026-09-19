# 09 — Security & privacy

## What is cryptographically guaranteed

- **Authorship**: every revision is signed with the key behind its npub. Nobody
  — not even the relay — can produce content in someone else's name.
- **Integrity**: the event `id` is a hash over content and tags. Changing an
  event after the fact is impossible; only a new revision is.
- **Order**: `parent-rev` anchors every revision to its predecessor.

## What is explicitly not guaranteed

- **Completeness**: a relay can withhold events. Partial mitigation: NIP-29
  timeline references (`previous`) would make gaps detectable, and the app could
  then say "history may be incomplete" instead of showing a smooth list.
  Limitation: `groups_relay` does not implement timeline references according to
  its README, so it does not check the tag — and we do not write it yet. Gap
  detection therefore remains a client-side heuristic over `parent-rev` chains
  with missing links.
- **Confidentiality**: a `private` NIP-29 group is *access-restricted*, not
  encrypted. The relay operator reads everything in plaintext.
  **Decision (confirmed):** that is fine for this use case — the relay belongs
  to the company or the admin, and the trust model matches a self-hosted wiki.
  Consequence for the UI: no padlock icon and no wording that suggests E2EE.
  Instead, literally: "members and the relay operator can see this content."
  E2EE stays deliberately out of scope; it would also be incompatible with
  relay-enforced permissions and full-text search.
- **Deletion**: NIP-09 is a request. Once published, content may survive on
  copies. UI wording: "request deletion".
- **Timestamps**: `created_at` is set by the client and therefore manipulable.
  Ordering primarily follows the `parent-rev` chain; the clock is for display.

## Client-side attack surface

| Risk | Countermeasure |
|---|---|
| XSS through Markdown from arbitrary npubs | `rehype-sanitize` with a strict allowlist, no `dangerouslySetInnerHTML`, no raw HTML, no `javascript:` links — and a Content-Security-Policy behind it as a second layer, see below |
| The `url` a Blossom server returns for an upload (`javascript:`, `data:`, or one that ends the Markdown link early) | Accepted only if it parses as an absolute `http(s)` URL, otherwise the blob is addressed by its own sha256; the link destination is percent-encoded at insertion time exactly as the label already was. Second line: the renderer refuses those schemes anyway and the server is operator-configured — this is about what gets *stored*, which every other client reads too (`src/nostr/blossom.ts`) |
| Images/iframes used as trackers | **Accepted trade:** every image is loaded directly, whatever host it points at — so a host learns the reader's IP, which page is being read and when, and can count reads. No iframes. See "Images are loaded directly" below |
| Forged `h` tags (an event from another group smuggled in) | Checked after loading: `h` must match the open space, otherwise the event is discarded |
| Forgetting to verify signatures | Verification is enforced in the data layer, not optional per call |
| Impersonation via display names | The npub is the truth and stays one hover or one click away — the author tooltip, a revision's Details view, `/settings/profile`; the member badge only appears for entries in `39002` |
| Spam in open spaces | Relay rate limits + moderated deletion (`9005`) + a "members only" UI filter |
| Key theft through the app | No handling of nsec at all. NIP-07/NIP-46 only |

## Content-Security-Policy

The sanitising pipeline above is the first layer, and as of this writing it is
correct — the CSP closes no hole that is open today. It is the **second** layer,
and it exists for the day a regression in that pipeline, or a compromised npm
dependency somewhere in the tree, puts a script into the page anyway. The app
renders Markdown written by arbitrary public keys, so that day is worth
planning for.

**This section describes a policy the app is *meant* to be served with. Today
nothing in production sends it — see "The risk" at the end before reading any
further.**

The policy is defined once, in `src/csp.ts`, which `vite.config.ts` imports:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src * data:; connect-src 'self' https: wss:; font-src 'self';
object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none';
form-action 'none'; frame-ancestors 'none'
```

### A header, not a meta tag

`<meta http-equiv="Content-Security-Policy">` silently ignores
`frame-ancestors`, `report-uri`/`report-to` and `sandbox`; they are only
honoured on an HTTP response header. `frame-ancestors 'none'` is part of this
policy, so a meta tag could not deliver it. A meta tag would also break
`npm run dev` (see below) and leave two copies of the policy to keep in sync.

`vite.config.ts` puts the header on `preview.headers`, so
`npm run build && npm run preview` serves the **production build** under the
policy. That makes it checkable on the artefact that actually ships, without
inventing a deployment — with one deliberate difference in `connect-src`, see
"Preview relaxes `connect-src`, and only that" below.

### The directives that are not obvious

- **`script-src 'self'`** — no `'unsafe-inline'`, no `'unsafe-eval'`. This is
  the whole point of the exercise. It cost one change: the theme bootstrap that
  used to sit inline in `index.html` now lives in `public/theme-bootstrap.js`
  ([12](12-theming.md)). `src/` contains no `eval` and no `new Function`.
- **`style-src 'unsafe-inline'`** — forced, and deliberate. The **binding**
  constraint is CodeMirror, not our own components: `@codemirror/view` mounts
  its theme through `style-mod`'s `StyleModule.mount`, which for a document
  root — every mount in this app, since nothing here uses shadow DOM — creates
  a `<style>` element and assigns its `textContent`. That is an inline style
  *element* (`style-src-elem`), and no refactor on our side removes it: the
  only alternative is a per-response nonce (`EditorView.cspNonce` exists for
  exactly that), which a static host cannot mint. Secondary, and by itself
  removable: five computed React `style` attributes — `src/ui/Markdown.tsx`
  twice, including the per-token Shiki styles that are by far the most
  numerous at runtime, `src/ui/layout/TableOfContents.tsx` once and
  `src/ui/layout/Sidebar.tsx` twice. CSP governs style *attributes* too,
  through `style-src-attr`, so without this they would silently stop applying
  — no error, just wrong indentation and unhighlighted code. Inline **styles**
  cannot execute script; the directive that must stay clean is `script-src`.
- **`img-src * data:`** — deliberately open, and **not** to be tightened by
  mistake. Pages embed images from arbitrary hosts and the app loads them
  directly, by the decision under "Images are loaded directly" below. `*` does
  not cover the `data:` scheme, hence listing it; no `blob:`, because `src/`
  never calls `createObjectURL`.
- **`connect-src 'self' https: wss:`** — scheme-scoped rather than an
  allowlist of hosts, because **no host allowlist can exist here**. The space
  relay is chosen at runtime from the route — whoever wrote the link picks the
  host — and a static CSP is fixed at build time. The app also fetches that
  host's NIP-11 document over `https` (`src/nostr/relay-status.ts`), the
  profile relays from `VITE_PROFILE_RELAYS` and the Blossom server from
  `VITE_BLOSSOM_SERVER`. This follows from the relay-trust decision (CON-46);
  tightening it breaks every shared space link.

### The dev server gets no policy

`@vitejs/plugin-react` injects an inline `<script type="module">` (the Fast
Refresh preamble) into `index.html` in dev, and the HMR client opens a
WebSocket to the dev server. A dev policy would therefore need
`'unsafe-inline'` in `script-src`, which neuters the one directive this is
about, on top of a second policy to keep in sync. `npm run preview` is where
the policy can be checked against the real build. The preview policy below
does relax `connect-src` for the same local hosts a dev policy would need —
but it leaves `script-src` exactly as it ships, which is what makes it worth
serving at all.

### Preview relaxes `connect-src`, and only that

The shipped policy allows outbound connections over `https:` and `wss:` only.
The local setup is plaintext — the dev relay is `ws://localhost:<port>` with
an `http://` NIP-11 fetch to the same host, and the Blossom server is
`http://localhost:3355` — and `'self'` does not cover them, because the
previewed origin is a different port. Under the shipped policy verbatim,
`npm run preview` therefore never loads a space, and exactly the paths that
need one cannot be walked: Shiki highlighting on a real page, a foreign-host
image, relay connect and AUTH, an upload. The only thing such a run would
prove is that a header arrives.

That defeats the purpose of `preview.headers`, so the preview server sends a
derived policy instead: the shipped directives with
`ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*`
appended to `connect-src`, and nothing else changed. Both spellings are
listed because CSP matches a host source by name and resolves nothing;
`[::1]` cannot be listed at all, since CSP's host grammar has no form for an
IPv6 literal, so an IPv6-only relay stays blocked there. The ports are open
(`:*`) because they are configuration, not constants.

**What this costs:** `connect-src` is the one directive `npm run preview`
does not verify. That is the cheapest one to give up. It can never be narrow
in production either — the relay host comes out of the link at runtime
(CON-46) — so it is scheme-scoped by necessity rather than by measurement.
Every directive this section is actually about is verified exactly as it
ships: `script-src 'self'` with no `'unsafe-inline'`, `style-src`,
`frame-ancestors`, `object-src`, `img-src`.

**What was rejected:** putting `ws:` into the shipped policy. It would permit
plaintext to *any* host, which is most of what CON-45 exists to prevent, and
`src/csp.test.ts` now fails if someone tries. Also rejected: accepting that
the content-dependent half is simply unverifiable locally, which would leave
the second layer's behaviour unknown until a real deployment exercises it.

Both policies come from one set of directives (`CSP_DIRECTIVES` and the
`PREVIEW_CSP_DIRECTIVES` derived from it, in `src/csp.ts`) rather than being
written out twice, because two hand-kept strings drift and the drift would be
invisible — only one of them is ever served by anything.

### How to exercise the policy by hand

```bash
./scripts/dev-relay-up.sh    # the local relay the preview policy allows
npm run build && npm run preview
curl -sI http://localhost:4173/ | grep -i content-security-policy
```

With the page open, keep the DevTools console visible and walk the paths that
each touch a different directive: first paint and theme (no flash, no
`script-src` violation for `/theme-bootstrap.js`), a page with a code block
(Shiki and CodeMirror's injected `<style>`), a page with an image from a
foreign host (`img-src`), relay connect plus NIP-42 AUTH, and a Blossom
upload. A clean console across those five is what acceptance #3 means.

Two things the local run still cannot show. `connect-src` as it ships is not
under test here, by the trade above; checking that needs a `wss://` relay and
`VITE_RELAY_URL=wss://<host> npm run build`. And the dev signer
(`?devsigner`) is gated on `import.meta.env.DEV`, so it does not exist in a
production build — signing in under the preview policy needs a real browser
extension.

### What is checked automatically

`src/csp.test.ts` pins the invariants this document argues for, so that a
future edit cannot quietly widen them: `script-src` carries neither
`'unsafe-inline'` nor `'unsafe-eval'`, `object-src`/`base-uri`/
`frame-ancestors` stay exactly `'none'`, `img-src` still allows `*`, the
shipped `connect-src` names no plaintext scheme and no loopback host, and
`index.html` contains no inline `<script>` body. The policy lives in its own
module (`src/csp.ts`) so the test can import it without booting Vite's
plugins — there is still exactly one definition of it.

The preview variant is pinned against the shipped one: the two differ in
`connect-src` and nowhere else, preview only ever *adds* sources to it, and
deriving it leaves the shipped policy unmutated. That is what keeps the
relaxation from growing — a second directive loosened "for preview" fails the
suite rather than quietly making the preview run say nothing about what a
host will serve.

### The risk: the app does not have a CSP yet

**State it without hedging: the shipped app has no Content-Security-Policy.**
What this repo has is a policy that is defined, reviewed and testable — one
definition in `src/csp.ts`, guarded by `src/csp.test.ts`, and exercisable on
the production build through `npm run preview` (bar `connect-src`, see
above). What it does not have is any path by which a browser visiting a
deployed Akasha receives the header.

The gap is not an oversight in the policy, it is the missing serve step. This
repo does not deploy itself: there is no app Dockerfile, no nginx or Caddy
config, no `_headers`, `netlify.toml` or `vercel.json`, and no deployment yet
([08](08-relay-setup.md) covers the relay, not the app). `preview.headers`
configures Vite's own preview server and **nothing else** — it is a local
development server, and its header never reaches a user. A static bundle
cannot set its own response headers, and a `<meta>` tag cannot carry
`frame-ancestors`, so nothing inside `dist/` can close this on its own.

Consequences, in the order they matter:

1. Until a host is configured to send the header, the app's only defence
   against injected script is the Markdown sanitiser. The second layer this
   section describes is **not** in force for any real reader.
2. Wiring it is a deployment task, deliberately left to whoever picks the
   host — adding a `Dockerfile`, `public/_headers` or an nginx snippet here
   would pick that decision for the project, and it is tracked as its own
   follow-up instead.
3. Whatever that host turns out to be, the header value must come from
   `src/csp.ts` rather than being retyped, or the guard test stops guarding
   what is actually served.

## Images are loaded directly

Loading an image from a foreign host tells that host who is reading which page,
and when: a page with a picture on it is a read receipt, and a 1×1 image is a
read counter. The app used to gate that — an image from anywhere but our own
Blossom server was only fetched once the reader clicked it ("load image from
example.com").

**Decision (2026-09-12): the gate is gone.** A wiki whose pictures are missing
until each of them has been clicked is not the page, and reading the page is what
the app is for. Every image is loaded directly now, in the editor and on the
rendered page alike.

**What that costs, stated plainly:** any member who can write a page can put an
image URL into it, and every reader of that page then announces themselves to
that host — IP, referrer, time. What still limits it is structural rather than
technical: the page is only reachable from inside the group, the relay belongs to
the deployment, and the images that matter are attachments on our own Blossom
server. Bringing the gate back for foreign origins is a small change: the two
places that draw an image are `MarkdownImage` in `src/ui/Markdown.tsx` and
`ImageWidget` in `src/ui/markdown-live.ts`.

## Privacy note for users

An npub is a permanent pseudonym: everything a person posts is linkable across
relays. For teams where npubs map to real names, that effectively means a public
activity history. This belongs on the app's onboarding page, not in the fine
print. **Open:** there is no onboarding page yet.
