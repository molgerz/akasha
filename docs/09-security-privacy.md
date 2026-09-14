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
print.

**Built (CON-13):** `PseudonymNotice` says it once, as a dialog, on the first
sign-in with a given npub — before anything can be written under it. Three
sentences: what is signed stays linked to the npub forever, publishing cannot
reliably be undone, and a private space restricts access rather than encrypting.
A banner under the top bar would have been cheaper and is exactly what the
paragraph above rules out; a strip that can be scrolled past is the fine print.

Acknowledgement is stored **per npub**, not per browser (`nc-pseudonym-ack`, see
`src/ui/pseudonym-ack.ts`). A browser is not an identity: a second person on the
same machine, or the same person starting a deliberately unlinked second
pseudonym, has not been told anything. There is still no onboarding *page* — the
app has no sign-in page either, on purpose (docs/06), so the notice goes to the
reader instead of the reader to it.

Only the button acknowledges. Escape closes the dialog — a dialog the keyboard
cannot leave is its own accessibility problem — but records nothing, so the
notice is back on the next load; and the dialog itself takes the focus rather
than its button, so Enter has nothing to activate. There is one warning per npub
and nothing in the app brings it back, which is the whole reason a reflex must
not be able to spend it. While it is up the rest of the shell is `inert`
(`src/ui/layout/AppShell.tsx`): nothing behind the backdrop is focusable, which
is also what stops the top bar's Ctrl/Cmd+K from putting the caret into a search
field the reader cannot see.
