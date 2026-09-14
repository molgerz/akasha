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
`npm run build && npm run preview` serves the **production build** with the
**real header**. That makes the policy checkable on the artefact that actually
ships, without inventing a deployment.

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
`'unsafe-inline'` in `script-src` plus `ws:` and `http:` in `connect-src` for
the local relay and Blossom — which neuters the one directive this is about
while adding a second policy to keep in sync. `npm run preview` is where the
policy can be checked against the real build — see "How to exercise the policy
by hand" below for what that takes.

One consequence worth knowing before it confuses someone: `npm run preview`
against the **local** relay shows `connect-src` violations in the console, for
`ws://localhost:8080` and its `http://` NIP-11 fetch. That is the policy
working as intended — plaintext `ws:`/`http:` are not in it, and a production
relay is `wss:`.

### How to exercise the policy by hand

The default checkout cannot do it: `.env.example` points `VITE_RELAY_URL` at
`ws://localhost:8080`, which the policy blocks by design. A run that actually
exercises the app under the header therefore needs a `wss://` relay:

```bash
VITE_RELAY_URL=wss://<relay-host> npm run build
npm run preview
# then, against the previewed origin:
curl -sI http://localhost:4173/ | grep -i content-security-policy
```

With the page open, keep the DevTools console visible and walk the paths that
each touch a different directive: first paint and theme (no flash, no
`script-src` violation for `/theme-bootstrap.js`), a page with a code block
(Shiki and CodeMirror's injected `<style>`), a page with an image from a
foreign host (`img-src`), relay connect plus NIP-42 AUTH (`connect-src wss:`
and the `https:` NIP-11 fetch), and a Blossom upload. A clean console across
those five is what acceptance #3 means.

This is the method, not a record of a run: **no such run is recorded for the
current state of the branch.** The automated guard below covers only the
invariants of the policy string itself, not the app's behaviour under it.

### What is checked automatically

`src/csp.test.ts` pins the invariants this document argues for, so that a
future edit cannot quietly widen them: `script-src` carries neither
`'unsafe-inline'` nor `'unsafe-eval'`, `object-src`/`base-uri`/
`frame-ancestors` stay exactly `'none'`, `img-src` still allows `*`, and
`index.html` contains no inline `<script>` body. The policy lives in its own
module (`src/csp.ts`) so the test can import it without booting Vite's
plugins — there is still exactly one definition of it.

### The risk: the app does not have a CSP yet

**State it without hedging: the shipped app has no Content-Security-Policy.**
What this repo has is a policy that is defined, reviewed and testable — one
definition in `src/csp.ts`, guarded by `src/csp.test.ts`, and provably
delivered on the production build by `npm run preview`. What it does not have
is any path by which a browser visiting a deployed Akasha receives the header.

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
