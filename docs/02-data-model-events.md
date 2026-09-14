# 02 — Data model & events

## Terminology

| Confluence | Here | Nostr equivalent |
|---|---|---|
| Instance | App | Static web app in the browser |
| Space | Space | NIP-29 group on a relay |
| Page | Page | `(group id, slug)` + chain of revisions |
| Version | Revision | Immutable, signed event |
| User | npub | Pubkey from NIP-07 |
| Permission | Membership | Enforced by the relay (NIP-29) |

## Event kinds at a glance

| Kind | Origin | Role |
|---|---|---|
| `0` | User | Profile (name, avatar) for bylines |
| `22242` | User | NIP-42 relay AUTH |
| `39000` | **Relay** | Group metadata: name, picture, `public`/`private`, `open`/`closed` |
| `39001` | **Relay** | The group's admin list |
| `39002` | **Relay** | The group's member list |
| `39003` | **Relay** | Role definitions |
| `9000`–`9009` | User (admin) | Moderation: add/remove member, edit metadata, delete event |
| `9021` / `9022` | User | Join / leave request |
| `9` / `11` / `12` | User | Group chat and threads (space discussion, phase 6) |
| **`1818`** | User | **Page revision — the actual content** |
| `1111` | User | Comment (NIP-22) on a page |
| `5` / `9005` | User / admin | Deletion request, or moderated deletion |

## Attachments

Nostr does not store files. An attachment is uploaded to a **Blossom** server
(BUD-01/02), lives there under its sha256 and appears in the Markdown only as a
URL — the file itself is never inside the event. The upload is authorised with a
kind `24242` event: the server verifies a signature, not a password. Configured
via `VITE_BLOSSOM_SERVER`; without it the `/` menu's attachment entry says so
rather than failing silently ([13](13-editing.md)).

A tiny server for local development ships with the repo:
`node scripts/dev-blossom.mjs`.

Before the first publish the app checks the `supported_kinds` tag in `39000`: if
the group lists kinds and `1818` is missing, it warns instead of publishing
blindly ([04](04-permissions-nip29.md)).

**Decision:** `1818` is an application-specific kind in the regular range (so
immutable, not replaceable). NIP-54 uses `818` for merge requests in a wiki
context; `1818` deliberately echoes that but stands on its own.
**Open:** whether to use NIP-34 patches (`1617`) instead — see
[11](11-open-questions.md).

## The core event: page revision (`1818`)

```json
{
  "kind": 1818,
  "pubkey": "<author's npub, hex>",
  "created_at": 1757250000,
  "content": "# Onboarding\n\nWelcome to the team …",
  "tags": [
    ["h", "engineering"],
    ["d", "onboarding"],
    ["title", "Onboarding"],
    ["parent-rev", "<event id of the preceding revision>"],
    ["content-hash", "<sha256 of content>"],
    ["page-parent", "handbook"],
    ["m", "text/markdown"],
    ["summary", "fixed a typo"],
    ["p", "<hex pubkey the text mentions>"],
    ["alt", "Wiki page 'Onboarding' in space engineering"],
    ["previous", "a1b2c3d4", "e5f6a7b8"]
  ],
  "id": "…", "sig": "…"
}
```

What the tags mean:

- **`h`** — group id. Mandatory in NIP-29; the relay uses this tag to check
  whether the author may write. This is our entire permission mechanism.
- **`d`** — the page's normalised slug (`lowercase-with-hyphens`). Single-letter
  tags are indexed by relays, so they can be filtered with `#d`. Normalised
  exactly as NIP-54 prescribes for a wiki article's `d` tag, because the same
  title has to yield the same slug in every client — otherwise two people
  editing "Möbel für das Büro" end up on two different pages. See below.
- **`parent-rev`** — event id of the preceding revision. Absent = first
  revision. Present twice = merge revision.
- **`content-hash`** — lets us recognise identical content (restore, no-op save)
  without comparing full text.
- **`page-parent`** — slug of the parent page, and **`page-order`** — the sort
  key among its siblings. Together they say where the page hangs in the tree.
  In a revision they are the **initial** placement, set when the page is
  created; a page that is later moved gets a `31818` (see "Where a page hangs"
  below), which takes precedence. Subpages always move with their parent,
  because they name it by slug and the slug never changes.
- **`p`** — one per key the content mentions. Mentions live in the Markdown as
  NIP-27 `nostr:npub1…` URIs, never as a display name — a name is freely
  chosen, not unique and can change, so a stored `@alice` would point at
  whoever calls themselves alice on the day the page is read
  ([13](13-editing.md)). NIP-27 asks for the tag, and without it the mention is
  findable by whoever reads the page but not by the person mentioned. The same
  applies to a comment (`1111`), where the key of the author being replied to
  joins the set. Note that on a NIP-29 relay a `p` tag here is only data: `h` is
  what decides who may write.
- **`previous`** — NIP-29 timeline references: short ids of recently seen group
  events. Prevents a relay from forging events or re-parenting them into a
  different group history. **Not implemented yet:** the app does not write the
  tag, and `groups_relay` does not verify it anyway
  ([09](09-security-privacy.md)).

**Decision: full-text snapshot instead of a diff.** Every revision carries the
complete Markdown text, not just the change. The reasoning: reading a page then
needs exactly one event instead of replaying a chain, diffs can be computed
client-side from two snapshots, and text pages are small. The `parent-rev` chain
provides the Git semantics, the snapshot provides the convenience. A
patch-based variant can be added later if needed.

## Page identity and head resolution

A page is `(h, d)`. Its current content is the **head** of the revision chain:

1. Load all `1818` events with `#h=<group>` and `#d=<slug>`.
2. Verify signatures, discard events with a foreign `h`.
3. Build a directed graph over `parent-rev`.
4. Determine the leaves (events no other revision points at).
5. One leaf → that is the head. Several leaves → a fork; the UI shows a conflict
   banner and offers to merge ([05](05-versioning-history.md)).

With several leaves the *displayed* one is the newest (`created_at`, ties broken
by the lexicographically smaller `id` — deterministic across clients). The fork
is never hidden.

## The page tree for the sidebar

For each `d` value the head is determined from all `1818` events in the group;
its `title` and `page-parent` produce the tree. No separate index event is
needed — the tree is a projection of the revisions.

- Upside: no inconsistency between index and content.
- Cost: loading a space for the first time means loading many events.
  Mitigation: an IndexedDB cache plus subscribing only from the last known
  `created_at`.
## The slug — NIP-54's rules

A page is `(group, slug)`, so the slug is its identity and every client has to
derive it from a title the same way. Rather than invent that, we take NIP-54's
normalisation for the `d` tag of a wiki article (`normalizeSlug` in
`src/nostr/kinds.ts`):

- letters with case variants become lowercase,
- whitespace becomes `-`, consecutive `-` collapse, leading and trailing `-` go,
- punctuation and symbols are removed — *removed*, not replaced, so "What's Up?"
  is `whats-up` and not `what-s-up`,
- numbers are kept,
- letters of every script are kept as UTF-8: `Москва` is `москва`, `日本語
  Article` is `日本語-article`, `Möbel` is `möbel`.

The last rule is the one that costs something. Slugs carry umlauts now, in the
`d` tag and in the URL. The alternative — transliterating `ö` to `oe`, which
this app used to do — is friendlier to a German eye but is a rule only we would
apply: no other client would ever arrive at `moebel`, and a page whose slug
nobody else can compute is a page nobody else can link to.

Two deviations, both deliberate:

- **Letters outside the basic multilingual plane are dropped** — historic
  scripts, and the styled pseudo-fonts people paste out of the web. Each is two
  UTF-16 units, and the order keys below do arithmetic on single units. A title
  made only of those normalises to nothing, and the editor then refuses to save
  and says why (`src/ui/PageEditor.tsx`).
- **The result is capped at 96 characters.** A slug is also a URL segment.

Because the slug *is* the page's identity, a **new** page may not take a slug
that is already in use: the editor refuses the publish and names the page that
owns it, with a way through to that page (`src/ui/PageEditor.tsx`). The check is
on the normalised slug and not on the visible heading — two headings that
normalise alike are one page, and two that do not are two, however similar they
read. What the client cannot see is another client creating the same slug at the
same moment: the relay puts no uniqueness constraint on `1818`, so that race
stays open. Editing an existing page is untouched — its saves still append to its
own chain.

## Where a page hangs — kind `31818`

Two gestures have to be expressible: filing a page **under** another one, and
dropping it **between** two rows so that it stays a sibling at that position.
The second one needs a stored order.

**Decision: an addressable event per page** — `31818`, keyed by the page's slug
(`h` = group, `d` = slug, tags `page-parent` and `page-order`, no content).
Moving a page **replaces** it.

The number avoids `30819`, which NIP-54 defines as a wiki redirect. An
addressable event is identified by `(kind, pubkey, d)` alone, so the same
person's redirect for a slug and our placement for it would be the *same event*
and overwrite each other. `31818` is undefined in every NIP and echoes our
`1818`.

```json
{
  "kind": 31818,
  "tags": [
    ["h", "engineering"],
    ["d", "onboarding"],
    ["page-parent", "handbook"],
    ["page-order", "am"],
    ["alt", "Position of wiki page \"onboarding\" below \"handbook\""]
  ],
  "content": ""
}
```

Why not in the revision, where the tree used to read it from:

- **A move is not an edit.** With the placement inside the revision, dragging a
  page in the sidebar appends to its history and moves its head — the byline
  would then claim somebody edited the page when all they did was sort it.
- **Restoring must not move a page.** A restore takes the content of an old
  revision. If that revision also carried the placement, going back in time
  would drag the page somewhere else as a side effect. Now it cannot: the
  restored revision carries the placement the page has *now*, and for a page
  with a `31818` those tags are only the fallback anyway.

Why not one event holding the order of the whole space (the `30820` this
document used to suggest): everybody who sorts anything would rewrite the same
event, and the last writer would win over an order nobody chose. Per page,
two people sorting two different pages never collide.

What it costs, deliberately:

- **There is no history of moves.** Only the current placement is signed and
  visible; earlier ones are overwritten and gone.
- Addressable events are replaced **per author**, so two people moving the same
  page leave one event each. The newer one wins, with the id breaking a tie so
  that every client agrees. A position has nothing to merge, so
  last-writer-wins is the honest semantics — unlike text, where a fork is shown
  and merged ([05](05-versioning-history.md)).
- The tree is now a projection of the revisions **plus** the placements. Pages
  that were never moved need no `31818` at all.

**How an order key is found** (`src/domain/order.ts`): keys are compared as plain
strings, and a page without a key is ordered by its **normalised title** — the
implicit key. Both live in the same key space, which is what makes it possible
to file a page between two neighbours *without touching their events*: the new
key is simply a string that sorts between theirs. Two properties of string
comparison carry it: every proper prefix of a key sorts before it, and every
extension sorts after it — so a gap can always be subdivided, however often.

Consequences worth knowing:

- Dropping a page **onto** another one clears its key: in its new level it
  sorts by title until somebody drags it into place. That is predictable, and
  it avoids carrying a key from a level where it meant something else.
- Two pages whose titles normalise identically compare equal; the slug breaks
  the tie, so every client shows the same order.
- **A whole level can be sorted in one action (CON-21).** The order is still
  per page, and there is no batch signing in NIP-07 — so the way out is not a
  bigger event but a smaller one: **"Sort by title" clears the keys** instead of
  computing new ones, because a page without a key is ordered by its title
  anyway. Only the pages that actually carry one are rewritten, and the first
  refusal stops the run (a half-sorted level is worse than an unsorted one).

  Handing out fresh keys `a`, `b`, `c` … would have been the obvious
  implementation and is worse in every way: an event per page instead of only
  the ones that need it, and today's alphabet frozen into the data, so a later
  rename would no longer move the page.

  It lives in the space settings under *Page tree*, not on every branch row:
  re-sorting a level is rare, and a control on every row would be permanent
  weight for it.
- **A placement whose page is gone can be cleaned up (CON-21).** It was inert
  rather than harmful, and that is exactly why it needed somewhere to be seen —
  nothing else in the app would ever mention it. The settings page lists them
  and asks the relay to drop them with a NIP-09 `kind 5` naming the **address**
  (`31818:<pubkey>:<d>`), the only way to name an addressable event: every move
  replaces the placement, so an event id points at a version that may already
  be gone.

  Two gates, both ours because the relay enforces neither: the request counts
  only from the placement's **own author** (an addressable event is identified
  per author, and a relay honours nobody else's request), and only for a slug
  with **no revisions** — so a stale request cannot silently unplace a page
  that came back. A placement somebody else left behind stays theirs to remove,
  and the UI says so instead of offering a button that would do nothing.

  Our relay stores the `kind 5` without deleting anything, the same as for a
  revision ([05](05-versioning-history.md)), so the client stops counting them
  while the events themselves may remain.

## No NIP-54 mirror (`30818`) — decided against

The idea was to write a NIP-54 wiki article alongside every revision, with
`d = slug` and `rev = <revision id>`, so that other Nostr wiki clients could
read a page. It is not going to happen, and not because of the effort.

`30818` is addressable, and an addressable event is identified by
`(kind, pubkey, d)`. The author is part of its identity, so a mirror exists once
**per author**: on a page that two people edit there would be two events
claiming to be the same page, and nothing but `created_at` to say which is
current — a mirror written by somebody who has not edited in months looks just
as authoritative as today's. The mirror would be structurally incapable of
saying what the page *is*.

That is the same reason `30818` cannot be the source of truth either
([11](11-open-questions.md)): "one page, many editors" is not expressible as a
replaceable event on Nostr at all, because every replaceable event's identity
contains its author. Hence `(group, slug)` plus a revision chain.

A wiki client that wants to read our pages can read this document instead. What
we do take from NIP-54 is its slug normalisation, rule for rule
(`src/nostr/kinds.ts`).

## Comments (`1111`) — implemented

A NIP-22 comment, anchored to `h` (group) and `d` (slug), with `K = 1818` for
the kind of the root object, `k` for the kind of the direct parent and `e`
pointing at the parent comment in replies.

**Deviation from the letter of the NIP:** NIP-22 points at a single root event
via `A`/`E`. Our page *is* not a single event but the pair `(group, slug)` — a
reference to one revision would dangle after the next edit and orphan the
thread. Hence the same anchoring the revisions use.

**Open:** inline comments on a text selection (quote anchors). Needs a selection
API in the editor, and therefore CodeMirror.
