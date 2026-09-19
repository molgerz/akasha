# 05 — Versioning & working together

## The model: Git semantics in Nostr events

A revision is a commit:

| Git | Here |
|---|---|
| Commit hash | Event `id` (a hash over the event) |
| Author | `pubkey` → npub, **cryptographic, not claimed** |
| Timestamp | `created_at` |
| Parent commit | Tag `parent-rev` |
| Commit message | Tag `summary` |
| Blob | `content` (complete Markdown snapshot) |
| Branch head | Leaf of the chain |
| Merge commit | Revision with two `parent-rev` tags |

The chain is therefore verifiable: order comes from `parent-rev`, not from the
relay's timestamp. A relay can withhold events, but it cannot claim a false
order and cannot invent someone else's authorship.

```
rev1 (alice) ──► rev2 (bob) ──► rev3 (carol)   ← head
                     │
                     └──► rev2b (dave)          ← fork, unresolved conflict
```

## Saving with an optimistic lock

Confluence says "this page was changed in the meantime". That is exactly what we
need, because concurrent editing loses text otherwise.

1. The editor opens the page on base `base = <head id>`.
2. On "save": fetch the head from the relay again.
3. `head == base` → publish a revision with `parent-rev = base`. Done.
4. `head != base` → **three-way merge**, and without a dialog: the app merges,
   writes the result into the editor and explains above it what happened.
   Nothing is published in the process.
   - If the changes do not touch each other, the finished result is right there
     and only needs to be reviewed and saved again.
   - If they overlap, conflict markers sit in the text and saving stays blocked
     until they are removed.
5. The result of a resolution is a merge revision with two `parent-rev` tags.

**Solved differently than planned:** there is no dialog with three buttons and
no "save as a fork" option. A dialog would ask for a decision before you can see
the result; this way you see the merged text first and decide based on it. A
fork still *comes into being* when two people publish at the same time — it can
be resolved via "merge versions" on the page.

**Decision:** no silent overwrite. If the head has moved, we always ask.

## The history view

One timeline per page, newest first:

```
● 11:40  carol   "added a deployment section"      [diff] [restore]
● 11:15  bob     "typo"                            [diff] [restore]
● 10:02  alice   created the page                  [diff]
```

Every entry shows an avatar and the display name from `kind 0`. The npub is the
truth and the name is convenience, but the list no longer repeats the key after
every name: the shortened npub appears only when a key has no profile, and the
revision's *Details* view prints the full npub next to the event id.
[06](06-ui-information-architecture.md)

Features:

- **Diff** — pick two revisions, line diff with word-level highlighting
  (`jsdiff`). Because every revision is a full-text snapshot, any pair can be
  compared, not just neighbours.
- **Blame** — line-by-line attribution: for each line the most recent revision
  that introduced it, with its author's npub in the cell's tooltip. Computed
  client-side from the chain.
- **Restore** — publishes a *new* revision with the old content,
  `parent-rev = current head`, plus the tag `restore-of = <old id>`. Nothing is
  deleted; the history stays append-only.
- **Verify signature** — the detail view of a revision shows the event id, the
  signature status and the `content-hash`. This is the point where "bound to an
  npub" becomes checkable for users instead of merely asserted.

## Deleting

- **Implemented:** an admin deletes an event via NIP-29 `kind 9005`; the group
  relay enforces it. Applies to revisions and comments, with a confirmation
  prompt in the UI.
- **Open:** a user deleting their *own* revision via NIP-09 `kind 5` — a
  *request* to relays, to be phrased in the UI as "request deletion".
- **Implemented:** archiving a whole page, from the foot of its history. A new
  revision carries the `archived` tag and the page leaves the tree, the search
  and the space overview. It is a step in the chain, not a deletion — nothing
  is removed, and publishing a later revision without the tag brings the page
  back, so "restore" needs no mechanism of its own.

  The tag is named for what it does. A *tombstone*, in the distributed-systems
  sense the word comes from, marks a deletion — and nothing is deleted here.
  *Hidden* was the other candidate and promises secrecy the feature does not
  deliver: an archived page still answers its own URL. `archived` is also the
  word the wikis people arrive from use for exactly this, and the only one of
  the three not already spoken for elsewhere in this codebase.

  The plan here used to add `9005` on the predecessors. That is dropped: it
  would destroy the history of a page somebody may want back, to hide a page
  that the archived tag already takes out of the navigation. Consequences worth
  knowing, because each is easy to assume the other way round:

  - **The page still answers its own URL.** It is out of the *navigation*, so
    nobody comes across it — but the link keeps working for everyone who has
    it, and `PageView` says so on the page rather than letting a reader assume
    otherwise. Archiving is not access control; a private space is
    ([09](09-security-privacy.md)).
  - **The head decides.** `Page.archived` is read off the head revision, so on
    a fork the newer leaf wins — the same rule that already decides which text
    is shown, rather than a second one nobody could predict.
  - **Subpages stay.** They come up to the top level by the rule `buildTree`
    already applies to a missing parent. Archiving a page is a statement about
    that page; taking a branch off screen would remove pages nobody asked to
    remove.
  - **The placement (`31818`) is left alone.** It has no effect while the page
    is archived, and deleting it would make a restore land the page
    wherever its title sorts instead of where it was. The genuinely orphaned
    case — a placement whose slug has no revisions at all — is a different
    problem ([02](02-data-model-events.md)).
  - **The archive is a place.** `/s/:group/~archive` lists what was archived,
    newest first, with the way back on every row — linked from under the page
    tree and from the space overview ([06](06-ui-information-architecture.md)).
    Without it, taking a page out of the tree, the search and the overview
    leaves its own URL as the only route back to it, which is exactly what
    somebody who archived a page by mistake no longer has. Ordered by when
    each page left rather than by title: an archive is read as a log of what
    was taken out, not as a second page index.

## Relationship to ngit / NIP-34

ngit was the original inspiration — the Git-over-Nostr stack: NIP-34 with
`30617` repo announcements, `1617` patches, `1621` issues. Two routes:

| Route | Upside | Downside |
|---|---|---|
| **A: our own revision chain (`1818`)** — chosen | Tailored to wiki pages, one event = one readable page, no Git repo needed | No tooling ecosystem, an application-specific kind |
| B: NIP-34 patches (`1617`) | Compatible with ngit/gitworkshop, real diffs, merge requests already exist | Reading a page requires replaying patches; the repo concept fits "space with 200 pages" poorly |

**Decision:** route A for the MVP, because it keeps reading down to a single
event fetch. The Git properties that matter here (authorship by npub, parent
chaining, diff, blame, merge) are fully provided by route A. A NIP-34 export
remains possible as a later feature.

## Real-time collaboration (phase 6)

For simultaneous typing: a CRDT (Yjs or Loro) transported over ephemeral events
(`20000`–`29999`) scoped to the group's `h` — relays do not store those. On save
the CRDT state is committed as a normal `1818` revision. That keeps the history
clean (one revision per save), and live cursors become an addition rather than a
change to the data model.

**Non-goal for the MVP** — deliberately later, because the conflict model in
step 4 already works without a CRDT.
