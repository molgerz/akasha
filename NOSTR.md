# What this project uses from Nostr

Akasha is a wiki with no server of its own: identity is an npub,
storage is relay events, permissions come from a NIP-29 group. This file lists
which NIPs, event kinds and tags are actually involved — including everything
that deliberately does **not** follow the spec.

Legend: ✅ implemented · ⚠️ implemented, but with a caveat or home-grown ·
❌ deliberately not (yet)

* * *

## Right now: a prototype, not for production

> **Everything runs on `localhost`, with no TLS and no deployment. As long as
> that is the case, do not put anything in here whose loss would hurt.**

Important for anyone reading this for the first time — **it is not meant to stay
this way**:

- **The app can create a space** (`9007`) and gives it default metadata
  (`9002`: name, description, the `private`/`closed`/`restricted` flags,
  `supported_kinds`) right away — `src/ui/CreateSpaceForm.tsx`,
  `src/nostr/moderation.ts`. What is still missing is a settings page to
  **change** that metadata afterwards, and self-service joining (`9021`) for
  relays without auto-join.
- **The seed script remains useful for sample content and a second member**:
  [`scripts/dev-group-seed.sh`](scripts/dev-group-seed.sh) creates the
  `engineering` space with two pages, a second revision, and two throwaway
  keys — handy for trying the app against data that already has some history,
  not required for creating a space in the first place any more.
- **Everything runs locally.** Relay on `localhost:8080`, attachments on
  `localhost:3355`, profiles on `localhost:10577`. There is no deployment, no
  domain, no TLS.

What is **not** (any longer) simulated: the group itself. It lives on a real
NIP-29 relay ([`verse-pbc/groups_relay`](https://github.com/verse-pbc/groups_relay))
that genuinely enforces membership and permissions. An earlier version signed
the group metadata `39000`/`39001`/`39002` itself using `nak serve` — that was a
stand-in in which nothing was checked, and it was deliberately removed
(reasoning in [AGENTS.md](AGENTS.md)).

**What is therefore missing for real use:** changing metadata from the app
(`9002`, beyond the defaults set at creation), requesting to join (`9021`) for
relays without auto-join, and a relay under its own domain with TLS. All in the
backlog, see [docs/10](docs/10-roadmap.md).

### Why "not for production yet"

| Reason | What it means in practice |
|---|---|
| No settings page | A space's name, description and flags can be set at creation but not changed afterwards from the app |
| Local only, no TLS | A browser will not allow `ws://` from an HTTPS page — outside `localhost` this does not run at all |
| Throwaway keys in the seed | `scripts/.dev-keys` are test keys, not identities |
| Our own kinds `1818` and `31818` | The data model is not set in stone. If a tag changes, existing events would need migrating — and there is no tool for that yet |
| No E2EE | The relay operator reads everything in plaintext. A deliberate decision, but it has to fit the content |
| Deletion is relative | `9005` takes effect on this relay; copies elsewhere remain |
| No backup procedure | An event export is possible and verifiable, but not set up |

* * *

## NIPs

| NIP | Status | What for | Code |
|---|---|---|---|
| [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) base | ✅ | Events, filters, `REQ`/`EVENT`/`OK` | `src/nostr/client.ts` |
| [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) browser signer | ✅ | Sign-in via `window.nostr`, signing without a key in the app | `src/nostr/signer.ts` |
| [NIP-11](https://github.com/nostr-protocol/nips/blob/master/11.md) relay info | ✅ | Relay name, `supported_nips`, relay pubkey for `naddr` | `src/nostr/relay-status.ts` |
| [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md) bech32 | ✅ | Displaying `npub`, accepting npub input in member administration | `src/nostr/profile.ts` |
| [NIP-22](https://github.com/nostr-protocol/nips/blob/master/22.md) comments | ⚠️ | Comments (kind 1111) — the anchoring deviates, see below | `src/domain/comment.ts` |
| [NIP-27](https://github.com/nostr-protocol/nips/blob/master/27.md) text references | ✅ | Mentions: `nostr:npub1…` inline in the Markdown plus a `p` tag per mentioned key. The name is drawn from kind 0, the key is what is stored | `src/nostr/mentions.ts` |
| [NIP-29](https://github.com/nostr-protocol/nips/blob/master/29.md) groups | ✅ | Spaces, membership, moderation. The relay is the authority | `src/domain/group-state.ts`, `src/nostr/moderation.ts` |
| [NIP-31](https://github.com/nostr-protocol/nips/blob/master/31.md) `alt` | ✅ | Plain-text description on our own kinds so foreign clients can show something | `src/nostr/publish-page.ts` |
| [NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md) AUTH | ✅ | Authenticating to the relay, automatically on every new connection, retried after `auth-required` | `src/nostr/client.ts` |
| [Blossom](https://github.com/hzrd149/blossom) BUD-01/02 | ✅ | Attachments: the blob lives on the server under its sha256, the event only holds the URL | `src/nostr/blossom.ts` |
| [NIP-09](https://github.com/nostr-protocol/nips/blob/master/09.md) deletion request | ⚠️ | A user asks for their *own* revision (`kind 5`). The NIP-29 relay stores the request but does not delete, so the client skips the revision as a tombstone and reconnects the chain. Admin deletion stays `9005`, which the relay enforces | `src/domain/deletion.ts`, `src/nostr/publish-deletion.ts` |
| [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md) bunker | ❌ | Planned as a second signer implementation behind the same interface | — |
| [NIP-50](https://github.com/nostr-protocol/nips/blob/master/50.md) search | ❌ | Deliberately not: not every relay supports it, and a relay-dependent search would break offline. Search runs locally | `src/domain/search.ts` |
| [NIP-54](https://github.com/nostr-protocol/nips/blob/master/54.md) wiki | ⚠️ | Its slug normalisation for the `d` tag, rule for rule. The wiki kinds themselves are deliberately unused — see below | `src/nostr/kinds.ts` |
| [NIP-34](https://github.com/nostr-protocol/nips/blob/master/34.md) git | ❌ | Evaluated and rejected: reading a page would require replaying patches. The Git semantics live in our own revision kind instead | [docs/05](docs/05-versioning-history.md) |
| [NIP-96](https://github.com/nostr-protocol/nips/blob/master/96.md) file storage | ❌ | An alternative to Blossom, not implemented | — |

* * *

## Event kinds

### What we write

| Kind | Status | Meaning |
|---|---|---|
| **1818** page revision | ⚠️ our own kind | The actual content. Immutable, chained via `parent-rev`, a full-text snapshot. **Not a standard** — other clients will not render it |
| **31818** page placement | ⚠️ our own kind | Where a page hangs in the tree: `page-parent` and `page-order`. Addressable on `(pubkey, 31818, d)`, so moving a page **overwrites** it — a move is not an edit and appends nothing to the page's history. Not `30819`, which is NIP-54's wiki redirect |
| **1111** comment | ⚠️ | NIP-22, but anchored to `(h, d)` instead of a root event |
| **20817** diagnostic ping | ⚠️ our own kind | Ephemeral (20000–29999), not stored. Only answers "may I write here?" |
| **24242** Blossom upload | ✅ | Authorises a file upload. Not a relay event; it goes to the Blossom server over HTTP |
| **22242** relay AUTH | ✅ | NIP-42, produced by `nostr-tools` |
| **9000** / **9001** add/remove member | ✅ | A request to the relay, which verifies admin status |
| **9005** delete event | ✅ | Moderation; the relay enforces the deletion |
| **9002** edit metadata | ✅ | Sent by the app right after `9007` to set name, description and the invite-only flags, and again from the space's admin settings page (`/settings/spaces/:group`). `scripts/dev-group-seed.sh` also sends one, for the seeded space |
| **9007** create group | ✅ | `src/ui/CreateSpaceForm.tsx` → `src/nostr/moderation.ts` |

### What we read

| Kind | Status | Meaning |
|---|---|---|
| **0** profile | ✅ | Display name and avatar, fetched in batches. A NIP-29 relay does not accept kind 0 — profiles come from other relays (`VITE_PROFILE_RELAYS`) |
| **39000** group metadata | ✅ | Name, description, flags, `supported_kinds`. Signed by the relay |
| **39001** admins | ✅ | Roles; controls who sees the moderation controls |
| **39002** members | ✅ | Member list |
| **39003** role definitions | ❌ | Not evaluated |
| **30818** wiki article | ❌ | Deliberately not, see "Deviations and limits" |
| **5** deletion request | ✅ | The author's own revision; the client skips it (see NIP-09 above) |
| **9021** join | ❌ | Unnecessary in open groups: the relay adds the author on their first write. The fallback for stricter relays is still missing |

* * *

## Tags

| Tag | Where | Meaning |
|---|---|---|
| `h` | everywhere | Group id. **This is the tag the relay checks write permission against** — it is our entire permission system |
| `d` | 1818, 1111, 31818 | Normalised page slug, by NIP-54's rules for a wiki article's `d` tag: lowercase, whitespace to `-`, punctuation *removed*, letters of every script kept as UTF-8 (so `möbel`, not `moebel`). Single-letter, so relay-indexed and filterable. In `31818` it is also the addressable identifier |
| `title` | 1818 | Display title |
| `parent-rev` | 1818 | Preceding revision. None = first revision, two = a merge |
| `page-parent` | 1818, 31818 | Slug of the parent page. In `1818` the **initial** placement, set when the page is created; a `31818` for the same slug takes precedence |
| `page-order` | 1818, 31818 | Sort key among the siblings of a level, compared as a plain string. Absent = the level orders the page by its title. Same precedence as `page-parent` (`src/domain/order.ts`) |
| `summary` | 1818 | Change note, the equivalent of a commit message |
| `content-hash` | 1818 | sha256 of the content |
| `restore-of` | 1818 | A restore points at the revision it copied |
| `tombstone` | 1818 | The revision hides its page: it leaves the tree, the search and the overview, while the history stays and the URL keeps working. **Presence is the signal, the value is unread** (written as `1`; a bare one-element tag is legal NIP-01 but an edge every relay handles a bit differently). A later revision without the tag brings the page back. Not a standard — our own kind, our own tag |
| `m` | 1818 | Always `text/markdown` |
| `alt` | 1818, 1111, 31818 | NIP-31 fallback for foreign clients |
| `K` / `k` / `e` | 1111 | NIP-22: kind of the root object, kind of the direct parent, parent comment |
| `p` | 1818, 1111 | Everybody the content mentions, one tag per key, plus (in `1111`) the author being replied to. NIP-27 — without it a mention is findable by whoever reads the page but not by the person mentioned. Written from `nostr:` URIs in the text (`src/nostr/mentions.ts`) |
| `supported_kinds` | 39000 (read) | Kinds the group accepts. If `1818` is missing, the app warns **before** publishing |
| `previous` | — | ❌ NIP-29 timeline references are **not** written. `groups_relay` does not check them anyway |

### Example: a page revision

```json
{
  "kind": 1818,
  "pubkey": "<author's npub, hex>",
  "content": "# Onboarding\n\nWelcome to the team …",
  "tags": [
    ["h", "engineering"],
    ["d", "onboarding"],
    ["title", "Onboarding"],
    ["m", "text/markdown"],
    ["content-hash", "<sha256>"],
    ["alt", "Wiki page \"Onboarding\" in space engineering"],
    ["page-parent", "handbook"],
    ["summary", "added an access section"],
    ["parent-rev", "<id of the preceding revision>"],
    ["p", "<hex pubkey mentioned in the text>"]
  ]
}
```

### Mentions in the content

The content is Markdown (`m: text/markdown`), and a mention inside it is a
NIP-27 URI — `nostr:npub1…` or `nostr:nprofile1…`, written inline. Never the
display name: a name is freely chosen, not unique and can change, so `@alice`
in a stored page would point at whoever calls themselves alice on the day it is
read. The app draws the name and keeps the key ([docs/13](docs/13-editing.md)).

Every key found this way is also written as a `p` tag, as NIP-27 asks. A
relay-side consequence: on a NIP-29 relay a `p` tag on a `1818` is just data —
it is `h` that decides who may write, and nothing else.

A page is therefore **not a single event** but the pair `(group, slug)` plus the
chain of its revisions. Why it has to be that way: addressable events (`30xxx`)
always belong to exactly one key pair — two people could not otherwise edit the
same page. In detail in [docs/02](docs/02-data-model-events.md).

### Example: a page placement

```json
{
  "kind": 31818,
  "pubkey": "<whoever moved the page, hex>",
  "content": "",
  "tags": [
    ["h", "engineering"],
    ["d", "onboarding"],
    ["page-parent", "handbook"],
    ["page-order", "am"],
    ["alt", "Position of wiki page \"onboarding\" below \"handbook\""]
  ]
}
```

Here being addressable is exactly what is wanted: dragging a page in the sidebar
must not append to its history nor move its head, or the byline would claim
somebody edited the page when all they did was sort it. And a restore cannot
drag a page somewhere, because the placement is not part of the text being
restored. The price is that it is addressable **per author** — two people moving
the same page leave one event each, and the newer one wins (ties broken by id).
A position has nothing to merge, so last-writer-wins is honest here, unlike text
([docs/02](docs/02-data-model-events.md)).

* * *

## What the relay has to support

| Requirement | Why |
|---|---|
| NIP-29 (`supported_nips` contains 29) | Without real group logic, membership and permissions are a stand-in |
| NIP-42 | Private groups and write access depend on it |
| `1818`, `1111` and `31818` in the group's `supported_kinds` | Otherwise the relay rejects pages, comments or moves even though the person is a member. `groups_relay` does not currently enforce the list, but a relay is allowed to |
| The group set to `private` + `closed` + `restricted` | Akasha is for closed teams: only npubs an admin added may read, and only they may write. All three tags have to be sent — the relay changes a flag only when its tag is present |

Verified and recommended: [`verse-pbc/groups_relay`](https://github.com/verse-pbc/groups_relay).
`nak serve` is **not** a NIP-29 relay — details and pitfalls are in
[docs/08](docs/08-relay-setup.md) and [AGENTS.md](AGENTS.md).

```bash
./scripts/dev-relay-up.sh     # relay on ws://localhost:8080
./scripts/dev-group-seed.sh   # group and sample pages, exclusively via nak group
```

* * *

## Inspecting things with `nak`

Important against this relay: use `--fpa` (force-pre-auth), not `--auth` — it
filters out unauthenticated readers silently instead of rejecting them.

```bash
source scripts/.dev-keys

# every page revision in the group
nak req --fpa --sec "$ALICE_SEC" -k 1818 -t h=engineering ws://localhost:8080

# one specific page with its chain
nak req --fpa --sec "$ALICE_SEC" -k 1818 -t d=onboarding ws://localhost:8080

# the group state produced by the relay
nak req --fpa --sec "$ALICE_SEC" -k 39000 -k 39001 -k 39002 ws://localhost:8080

# comments
nak req --fpa --sec "$ALICE_SEC" -k 1111 -t h=engineering ws://localhost:8080

# where the pages hang (one event per moved page, addressable)
nak req --fpa --sec "$ALICE_SEC" -k 31818 -t h=engineering ws://localhost:8080

# write a page by hand
nak event --fpa --sec "$ALICE_SEC" -k 1818 -h engineering -d notes \
  -t title=Notes -t m=text/markdown -c '# Notes' ws://localhost:8080
```

`nak group info|members|edit-metadata` does **not** work against this relay (its
internal pool does not authenticate, and `info` hangs). Hence the raw `req`.

* * *

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `VITE_RELAY_URL` | `ws://localhost:8080` | The group relay. It is part of a space's identity (`host'group`) |
| `VITE_PROFILE_RELAYS` | empty | Relays for kind 0. Empty means the app shows npubs instead of names — more honest than an invented name |
| `VITE_BLOSSOM_SERVER` | empty | Blossom server for attachments. Empty means the attachment button is disabled |

* * *

## Deviations and limits

Named honestly, because they matter when building on top of this:

- ⚠️ **`1818` is not a standard kind**, and neither is `31818`. The content is
  invisible to other Nostr clients, and the `alt` tag is the only consolation.
  **Decided against changing that:** a `30818` mirror per save was considered
  and dropped. An addressable event is identified by `(kind, pubkey, d)`, so a
  mirror exists once *per author* — on a page two people edit it would be two
  events claiming to be the same page, one of them quietly stale. A wiki client
  that wants to read along can read the data model here and in
  [docs/02](docs/02-data-model-events.md) instead. What we do take from NIP-54
  is its slug normalisation.
- ⚠️ **There is no history of moves.** Only the current `31818` per page is
  signed and visible; earlier placements are overwritten and gone. Nothing
  cleans up the placement of a deleted page either — it is inert, because a
  placement whose slug has no revisions is ignored.
- ⚠️ **Comments are anchored to `(h, d)`**, not to a root event via `A`/`E`. A
  reference to one revision would dangle after the next edit
  ([docs/02](docs/02-data-model-events.md)).
- ⚠️ **`previous` timeline references are missing.** A relay can withhold
  events; gaps would only be detectable through those tags. `groups_relay` does
  not check them anyway.
- ⚠️ **Line origin follows the first parent.** In a merge revision the lines of
  the second branch appear as introduced by the merge — like `git blame` without
  extra options.
- ⚠️ **Permissions apply per group, not per page.** NIP-29 knows nothing finer.
  A "locked page" would be pure UI cosmetics, so it does not exist
  ([docs/04](docs/04-permissions-nip29.md)).
- ⚠️ **No E2EE.** A `private` group is access-restricted, not encrypted: the
  relay operator reads along. A deliberate decision
  ([docs/09](docs/09-security-privacy.md)).
- ⚠️ **Deletion is relative.** `9005` takes effect on this relay; copies
  elsewhere remain.
- ⚠️ **`created_at` is manipulable**, because the client sets it. Ordering
  primarily follows the `parent-rev` chain; the clock is for display.

* * *

## Where things live

| Topic | File |
|---|---|
| All kinds and tags in one place | `src/nostr/kinds.ts` |
| Relay connection, NIP-42, publish with retry | `src/nostr/client.ts` |
| Signer interface (NIP-07, NIP-46 later) | `src/nostr/signer.ts` |
| Reading revisions, head resolution, page tree | `src/domain/revision.ts`, `src/domain/pages.ts` |
| Where a page hangs, and the sibling order | `src/domain/placement.ts`, `src/domain/order.ts`, `src/nostr/publish-placement.ts` |
| Three-way merge | `src/domain/merge.ts` |
| Group state and moderation | `src/domain/group-state.ts`, `src/nostr/moderation.ts` |
| Attachments | `src/nostr/blossom.ts`, `scripts/dev-blossom.mjs` |

The reasoning behind every decision is in [docs/](docs/README.md), the working
rules for this repo in [AGENTS.md](AGENTS.md).
