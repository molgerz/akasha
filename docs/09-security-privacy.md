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
| XSS through Markdown from arbitrary npubs | `rehype-sanitize` with a strict allowlist, no `dangerouslySetInnerHTML`, no raw HTML, no `javascript:` links |
| Images/iframes used as trackers | **Accepted trade:** every image is loaded directly, whatever host it points at — so a host learns the reader's IP, which page is being read and when, and can count reads. No iframes. See "Images are loaded directly" below |
| Forged `h` tags (an event from another group smuggled in) | Checked after loading: `h` must match the open space, otherwise the event is discarded |
| Forgetting to verify signatures | Verification is enforced in the data layer, not optional per call |
| Impersonation via display names | The npub is the truth and stays one hover or one click away — the author tooltip, a revision's Details view, `/settings/profile`; the member badge only appears for entries in `39002` |
| Spam in open spaces | Relay rate limits + moderated deletion (`9005`) + a "members only" UI filter |
| Key theft through the app | No handling of nsec at all. NIP-07/NIP-46 only |
| A link choosing which relay your browser talks to | An unfamiliar relay host is asked about once before anything is sent, and the answer is remembered per host (by default — the reader can answer for this visit only). See "Relay connections follow links" below |

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

## Relay connections follow links

A space carries its relay inside its own address — `/s/<host>'<group>` — which
is what makes a link to a space self-contained. It also means the link's author
picks the host, and until CON-46 the rest was automatic:

1. `AppShell` and `useSpaceRoute` turn the route parameter into a `relayUrl`,
   with no allowlist and no prompt.
2. `useRelay(relayUrl)` does two things to that host from its effects:
   `client.want()` opens a WebSocket to it, and `fetchRelayInfo` fetches
   `https://<host>` for the NIP-11 document.
3. `NostrClient` sets `pool.automaticallyAuth`, so a signed-in visitor answers
   the relay's NIP-42 challenge with no interaction at all.

Following a link was therefore enough to make a signed-in reader's browser
contact a host a stranger chose and hand it a signed statement of who they are —
npub, IP address, and the time they clicked. Nothing here was a bug in any one
of those three steps; the problem is that they compose into a disclosure that
the reader never agreed to.

### What was considered

1. **Leave it.** A relay in a link is how the addressing works, and a reader who
   follows a link to a wiki has arguably asked to reach it. Rejected: the thing
   disclosed is a signed identity, not a page view, and it is disclosed before
   anything is on screen to judge.
2. **Ask once per new host** — the host is named, the reader decides, the answer
   is remembered. **Chosen.**
3. **Connect, but withhold AUTH** until the reader has confirmed the host: the
   socket and the NIP-11 fetch happen immediately, only the signed NIP-42 event
   waits. Rejected, for three reasons that compound. It keeps back the npub but
   not the IP, the timing, or *which space* is being opened — the NIP-11 fetch
   to `https://<host>` has already said all of that before the first frame. It
   does not save the prompt either: a `private` group serves an unauthenticated
   reader zero events and no error at all (docs/04-permissions-nip29.md, the
   "Stranger, no AUTH" rows), so the reader still has to be asked — in front of
   a space that is empty for reasons nothing on screen can explain. And it
   is the wider change of the two — `signAuth` is not only
   `pool.automaticallyAuth` (`src/nostr/client.ts:172`), it is passed as
   `onauth` to every read and publish and called by `refreshAuth`
   (`client.ts:430, 486, 515, 556, 576, 597`), so a gate that touched only the
   automatic hook would leave every read signing anyway. Option 2 withholds
   everything this option withholds, plus the socket and the fetch, from one
   decision in one place.
4. **An allowlist fixed at build time.** Strongest, and it is what a
   single-relay deployment should arguably do. Rejected as the general answer:
   it makes every legitimate federated link a dead end, and the app's own
   addressing scheme then only works for addresses the operator foresaw.

### How it works

`src/nostr/known-relays.ts` holds the decision, keyed by the bare host (the
exact `GroupAddress.host`, e.g. `relay.example:8443`) in `localStorage` under
`nc-trusted-relays`. The scheme is never part of the key — it is derived from
the host — so one decision cannot acquire two spellings.

`src/ui/layout/AppShell.tsx` is where it bites. The relay-consuming half of the
shell — `useRelay`, `useSpace`, and `<Outlet>` — sits in a child component that
either mounts or does not. That is structural rather than stylistic: both
disclosures happen in *effects* inside `useRelay`, so withholding them means
never calling the hook, and a hook cannot be called conditionally.

Two independent reasons reach that one mechanism, kept apart in the code:

- **unreadable** — the address is not `<host>'<group>` at all. It names no
  relay, so nothing is contacted. This also replaces an older accident: an
  unparsable address used to fall back to `DEFAULT_RELAY_URL` and connect
  *there*, so that each view could draw "Invalid group address." over the top
  of a connection nobody had asked for.
- **untrusted** — it parses, and names a host with no decision on record.

Two kinds of host are trusted by construction and never reach the prompt:
loopback (asked through `isLocalRelayHost`, so the dev workflow is unaffected),
and the host of `DEFAULT_RELAY_URL`.

**Remembering is the default, not the only answer.** "Remember this relay" is
checked when the prompt opens; unchecking it still connects, but the decision
then lives only in the shell's own state (`allowedOnce` in `AppShell`) and is
gone on reload. That set is keyed by host as well, so following a link on from
an approved relay to a *second* unfamiliar one asks again rather than inheriting
the first answer.

**The gate stands in front of `/s/:group`, not `/settings/spaces/:group`.**
Both routes read the same `group` parameter, so a hand-written settings link can
still carry an unapproved host. It discloses nothing: that route calls no
`useRelay`, so nobody ever calls `client.want` for that host, and `useSpace`
alone cannot reach a socket — `SpaceStore.start()` returns at
`if (!connection.ready)` on a connection nothing asked for. An interstitial
there would buy no privacy and would sit in front of the settings navigation
instead. `src/ui/layout/AppShell.trust.test.tsx` pins that, so the day something
does wire a relay through the settings route, a test says so.

### Not behind the prompt, on purpose

`DEFAULT_RELAY_URL` (`VITE_RELAY_URL`) and the profile relays
(`VITE_PROFILE_RELAYS`) are **operator configuration**, chosen by whoever built
and deployed the app. They are not link input, and no visitor's link can change
them. Putting them behind the same prompt would ask readers to approve their
own deployment on every fresh browser, which teaches exactly the reflex —
clicking "Connect" without reading the host — that the prompt exists to avoid.

### Residual risk, stated plainly

- **The prompt is a decision, and decisions get clicked through.** A reader in a
  hurry approves an unfamiliar host in one click, and the disclosure follows
  immediately. All this buys is that the host is on screen, in a monospace face,
  before anything is sent.
- **It is per browser, not per person.** `localStorage` is cleared by a private
  window, a new device, or clearing site data — and lost trust means a second
  prompt, which is the safe direction, but it does mean the prompt recurs.
- **There is no in-app way to take an approval back.** `forgetRelay` exists in
  `src/nostr/known-relays.ts` and nothing calls it: today, undoing a "Remember
  this relay" clicked in haste means clearing the site's data, which drops every
  other decision with it. A "Trusted relays" list under `/settings/profile` —
  the screen that already owns per-browser state — is the obvious home for it
  and is deliberately not in CON-46.
- **Once approved, the host is approved for everything.** There is no
  distinction between "let it see my IP" and "let it see my npub"; connecting is
  one act, and NIP-42 follows from it automatically.
- **A trusted relay is still just a relay.** It reads everything in the group in
  plaintext (see "Confidentiality" above). The gate is about *which* relay gets
  to, not about what it can then see.
- **A group id can still be a lie.** The gate checks the host, not the space:
  a link to a relay you have already approved can name any group on it.

### It does not narrow the CSP

CON-46's ticket text claimed a known-hosts list would let CON-44's
`connect-src` be narrowed. That is wrong, and worth writing down so it is not
tried. `connect-src` is baked into the document at build time; relay hosts are
discovered at *runtime*, from links. Unless a deployment has exactly one relay
host — in which case it should say so directly in its CSP and skip the general
mechanism — the relay sources have to stay scheme-scoped (`https:` / `wss:`)
however much the trust gate remembers. The two measures are independent: the
CSP bounds what the page *can* reach, the gate bounds what it *does* reach
without asking.

## Privacy note for users

An npub is a permanent pseudonym: everything a person posts is linkable across
relays. For teams where npubs map to real names, that effectively means a public
activity history. This belongs on the app's onboarding page, not in the fine
print. **Open:** there is no onboarding page yet.
