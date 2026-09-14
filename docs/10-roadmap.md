# 10 — Roadmap

Every phase ends with a verifiable result. The order is chosen so that risk
surfaces early: relay and permissions first, comfort later.

## Phase 0 — Foundation ✅ (2026-09-07)
- Vite/React/TS project, Tailwind, routing skeleton
- **Theme tokens and a system/light/dark switch** ([12](12-theming.md)) —
  deliberately first, because retrofitting means touching every component again
- A development relay ([08](08-relay-setup.md))
- `src/nostr/kinds.ts` with all kinds from [02](02-data-model-events.md)
- **Done when:** the app connects, the relay status is displayed, and both modes
  look right in every view that exists

Completed and verified:

| Building block | Location |
|---|---|
| Vite + React 19 + TS, routing per [06](06-ui-information-architecture.md) | `src/routes/router.tsx` |
| Light/dark theme tokens, `@theme inline` | `src/index.css` |
| System/light/dark switch with persistence | `src/theme/theme.tsx`, `src/ui/ThemeToggle.tsx` |
| No flash on load | Inline script in `index.html` |
| All kinds and tags in one place, slug normalisation | `src/nostr/kinds.ts` |
| Parsing the group address `host'id` | `src/nostr/group-address.ts` |
| Relay connection + NIP-11 + backoff | `src/nostr/relay-status.ts` |
| Confluence layout: top bar, sidebar, content, right rail | `src/ui/layout/` |
| Tasks `relay`, `seed`, `dev`, `check` | `justfile` |

Verified in the browser: light/dark switching in every view, persistence across
a reload (`data-theme` and the toggle state survive), the relay status showing
"connected" with the relay's name, and the offline state with a reconnect
counter after stopping the relay.

## Phase 1 — Sign-in (requirement 1) ✅ (2026-09-07)
- NIP-07 detection, `getPublicKey`, profile (`kind 0`), session
- NIP-42 AUTH including an automatic retry after reconnect
- A signer interface (for NIP-46 later)
- **Done when:** signing in with Alby works and a publish after a reconnect does
  not fail silently

Completed and verified:

| Building block | Location |
|---|---|
| Signer interface, `window.nostr` detection with polling | `src/nostr/signer.ts` |
| Relay layer with NIP-42: sign the challenge automatically, retry publish after `auth-required`, backoff reconnect | `src/nostr/client.ts` |
| Session, profile from kind 0, detecting an account switch before writing | `src/session/session.tsx` |
| Sign-in button, account chip, failure strip, write probe | `src/ui/SignInButton.tsx`, `src/ui/UserChip.tsx`, `src/ui/SessionNotice.tsx`, `src/ui/WriteCheck.tsx` |
| Throwaway signer for automated tests without an extension (DEV only, only with `?devsigner`) | `src/dev/fake-nip07.ts` |

Library decision from the spike: **nostr-tools**, not NDK — see
[07](07-tech-stack.md).

Cross-checked against the real NIP-29 relay (`groups_relay`,
ws://localhost:8080): signing in, session across a reload, and a write probe
that the relay confirmed as accepted and delivered back through our own
subscription.

Three findings that would not have surfaced without testing:
- `pool.get` takes no `onauth` hook. On a relay with enforced NIP-42 it
  therefore returns empty results silently. Reading now goes through
  `subscribeEose` with `onauth`.
- Ephemeral events need a subscriber, otherwise the relay rejects them. The
  write probe therefore subscribes first and waits for its own event.
- `subscribeEose` closes the subscription on EOSE. That is too early for the
  echo of an ephemeral event — there `pool.subscribe` plus manual closing is
  needed.

## Phase 2 — Space & sidebar (requirement 2) ✅ (2026-09-07)
- Load groups (`39000`–`39002`), space header, member list
- Left bar with fixed entries
- Page tree, routing complete
- **Done when:** a space created by the seed script is fully navigable

Implemented in `src/nostr/space-store.ts` (one store per space, holding the
relay events and deriving pages and tree) and `src/domain/group-state.ts`. The
overview shows name, description, the flags from `39000`, members from `39002`
and roles from `39001`, plus an "you are admin/member" badge.

## Phase 3 — Reading and creating pages (requirement 3) ✅ (2026-09-07)
- Publish `1818` revisions (the first revision creates the page)
- Head resolution, Markdown rendering with sanitising
- Page tree from revisions, slug normalisation
- Editor with preview and a `summary` field
- **Done when:** two browser profiles see each other's pages

| Building block | Location |
|---|---|
| Reading revisions from events, checking the h tag | `src/domain/revision.ts` |
| Head resolution over `parent-rev`, leaves, page tree | `src/domain/pages.ts` |
| Signing and publishing a revision (with `content-hash`) | `src/nostr/publish-page.ts` |
| Rendering Markdown with `rehype-sanitize` | `src/ui/Markdown.tsx` |
| Editor for new and existing pages | `src/ui/PageEditor.tsx` |
| Page, history, overview, sidebar tree | `src/routes/`, `src/ui/layout/Sidebar.tsx` |

Verified against the running NIP-29 relay: created the page "Deployment" as a
subpage of "Handbook", then edited it — the second revision points at the first
via `parent-rev`, the history lists both with npub and note, and the sidebar
tree nests the page under its parent.

**Deviation since resolved:** the editor started out as a plain textarea; since
phase 6 it is CodeMirror 6 with Markdown highlighting.

Fork detection from phase 4 is already present as a display: if a page has more
than one leaf, both the page and the sidebar show it. Merging came later.

## Phase 4 — Editing together (requirements 4 & 6) ✅ (2026-09-07)
- Joining: use auto-join in `open` groups, `9021` fallback for stricter relays
- Optimistic lock: check the head before publishing
- Three-way merge, fork banner, merge revision
- **Done when:** concurrent editing loses no text and the conflict is visible

| Building block | Location |
|---|---|
| Line-based three-way merge with conflict markers | `src/domain/merge.ts` |
| Most recent common ancestor of two revisions | `findCommonAncestor` in `src/domain/pages.ts` |
| Optimistic lock and merge in the editor | `src/ui/PageEditor.tsx` |
| Merging a forked page | `src/routes/EditorView.tsx` with `?merge=1` |

What happens on save: if the head of the chain has moved since the editor was
opened, nothing is published — the versions are merged and a human is asked. If
the changes overlap, conflict markers sit in the text and saving stays blocked
until they are gone. The result of a merge is a revision with two `parent-rev`
tags.

Played through against the running relay: two competing revisions created via
`nak`, merged in the app (merge revision `bc523a4b` with both predecessors),
then a foreign revision published while the editor was open — on save the app
merged instead of overwriting, marked the conflict and refused to save until the
markers were removed.

Two bugs found in the process: line numbers from unified-diff hunks are
ambiguous for pure insertions (an inserted section landed one line too far
down) — change detection now runs over `diffArrays` on line arrays. And the
merge started as soon as two leaves had loaded while the common base was still
in flight; the editor now waits for the load to complete.

## Phase 5 — History (requirement 5) ✅ (2026-09-07)
- Timeline per page with npub, time and `summary`
- Diff between arbitrary revisions, blame per line
- Restore as a new revision, signature detail view
- **Done when:** every version of a page is attributable to an npub and
  verifiable

| Building block | Location |
|---|---|
| Line diff with line numbers for both sides, folding long unchanged runs | `src/domain/diff.ts`, `src/ui/DiffView.tsx` |
| Line origin across the chain | `src/domain/blame.ts`, `src/routes/BlameView.tsx` |
| Comparing arbitrary revisions, details, restore | `src/routes/HistoryView.tsx` |

Comparison works between **arbitrary** revisions, not just neighbours —
possible because every revision carries a full-text snapshot. Additions and
removals are marked with `+` and `−` as well, not by colour alone.

Restoring deletes nothing: a new revision is created with the old content,
pointing at its template via `restore-of` and at the current head as its
predecessor.

Played through against the running relay; the chain of the test page shows the
whole arc: root, fork, merge revision with two predecessors, competing revision,
conflict resolution, restore with `restore-of`.

**Known simplification:** line origin follows the first parent. In a merge
revision the lines of the second branch therefore appear as introduced by the
merge — the same behaviour as `git blame` without extra options.

## Phase 6 — Expansion (in progress)

Done:

| Building block | Location |
|---|---|
| Full-text search over titles and content, local instead of NIP-50 | `src/domain/search.ts`, `src/routes/SearchView.tsx` |
| Collapsible sidebar, state preserved | `src/ui/layout/Sidebar.tsx` |
| Comments with threads (kind 1111) | `src/domain/comment.ts`, `src/ui/Comments.tsx` |
| Moderation: add and remove members, delete events | `src/nostr/moderation.ts`, `src/ui/MemberAdmin.tsx` |
| Mobile layout: sidebar as an overlay, compact top bar | `src/ui/layout/AppShell.tsx`, `Topbar.tsx` |
| "On this page" table of contents with anchors | `src/domain/toc.ts`, `src/ui/layout/TableOfContents.tsx` |
| Display names and avatars from kind 0, fetched in batches | `src/nostr/profile-store.ts`, `src/ui/Author.tsx` |
| CodeMirror 6 editor with **live Markdown formatting** — write and read mode look the same, no preview toggle | `src/ui/MarkdownEditor.tsx`, `src/ui/markdown-live.ts` |
| `@` mentions over the space's members, stored as NIP-27 `nostr:` URIs and drawn as a name | `src/nostr/mentions.ts`, `src/ui/editor-complete.ts` |
| `:` emoji dropdown that inserts the character, not the shortcode | `src/ui/emoji.ts` |
| Attachments via Blossom (upload, markdown insertion) | `src/nostr/blossom.ts`, `scripts/dev-blossom.mjs` |
| Editing one's own profile (kind 0, NIP-01 fields), foreign fields preserved | `src/nostr/publish-profile.ts`, `src/routes/ProfileSettings.tsx` |
| Reading typography: 16px body, heading scale, 70-character measure, second density for comments | `src/ui/Markdown.tsx` |
| Collapsible branches in the page tree, folded state kept | `src/ui/layout/Sidebar.tsx` |
| Markdown completed: `h4`–`h6`, `hr`, GFM task lists, wide tables scroll | `src/ui/Markdown.tsx` |
| `color-scheme` per mode, so the browser draws controls and scrollbars to match | `src/index.css` |
| Syntax highlighting for code blocks (Shiki, dual themes, grammars lazy) | `src/ui/code-highlight.ts` |
| `/login` dropped: sign in where the click is, failures in a strip under the top bar | `src/ui/SignInButton.tsx`, `src/ui/SessionNotice.tsx` |

Open: real-time CRDT (simultaneous typing), NIP-46 sign-in.

**Live Markdown formatting (2026-09-09):** the editor draws the text the way
it will be read while it is being typed — `# ` sizes the line as a heading, `- `
becomes a bullet, `**bold**` goes bold, `- [ ]` a real checkbox that can be
ticked. The markup shows only on the line the cursor is on. A decoration layer
over CodeMirror, **not** a WYSIWYG document model: the stored text stays plain
Markdown, because the diff, blame and the three-way merge all work on it.
`@` mentions the space's members (stored as the key, drawn as the name, tagged
with `p`), `:` opens an emoji dropdown. All of it in
[13](13-editing.md), verified by 17 DOM tests against a real editor
(`src/ui/markdown-live.test.ts`, jsdom per file).

**Editor stripped to title + Markdown only (2026-09-09):** `PageEditor` no
longer renders "Filed under", the Attach button, the Write/Preview toggle or
the "what did you change?" summary field — Create and Edit now show just the
title and a plain, unframed Markdown area, with Publish/Cancel moved into the
breadcrumb bar via `HeaderActions` (`src/ui/layout/PageFrame.tsx`). The upload
plumbing in `src/nostr/blossom.ts` and the drag & drop hook in
`MarkdownEditor` (`onDropFiles`) are wired up again from `PageEditor` through
the `/` insert menu ([13](13-editing.md)): its attachment entry opens the file
picker, and the menu also writes the table, code block, quote and divider that
the plain editor needs. The toolbar button's job is done without the toolbar.

### Described in the docs but not built yet

As of 2026-09-07, found while comparing the docs against the code:

| Gap | Where it is described |
|---|---|
| IndexedDB cache: instant rendering on reload, offline reading | [01](01-architecture.md), [07](07-tech-stack.md) |
| End-to-end tests (Playwright), including the colour-mode regression | [07](07-tech-stack.md), [12](12-theming.md) |
| `9021` join flow for relays without auto-join | [04](04-permissions-nip29.md) |
| Writing `previous` timeline references | [02](02-data-model-events.md) |
| Sidebar entries "all pages", "recently changed", "space settings" | [06](06-ui-information-architecture.md) |
| Onboarding note that an npub is a permanent pseudonym | [09](09-security-privacy.md) |
| Help editing a table — column-aware movement and alignment; the skeleton itself comes from the `/` menu | [13](13-editing.md) |

### Deliberately solved differently than planned

Not a backlog, just a different choice — each justified where the original
decision was made:

| Instead of | Now | Justified in |
|---|---|---|
| Zustand as a state library | our own stores via `useSyncExternalStore` | [07](07-tech-stack.md) |
| MiniSearch | our own search over the loaded pages | [07](07-tech-stack.md) |
| The `diff3` package | our own three-way merge | [07](07-tech-stack.md) |
| A `data/` folder, files `revision-graph.ts`/`tree.ts` | `nostr/space-store.ts`, `domain/pages.ts` | [07](07-tech-stack.md) |
| A session with pubkey **and** timestamp | pubkey only; checked before every write | [03](03-auth-nip07-nip42.md) |
| A merge dialog with three buttons | the merge lands in the editor, the decision is made on the finished text | [05](05-versioning-history.md) |
| A yellow "saved locally only" strip | the editor stays open and shows the relay's reason literally | [06](06-ui-information-architecture.md) |
| A single `--diff-word-bg` token | separate tokens for added and removed | [12](12-theming.md) |
| A `30818` interop mirror for NIP-54 wiki clients | no mirror; the data model is documented instead | [02](02-data-model-events.md) |
| Placements on kind `30819` | `31818`, because `30819` is NIP-54's wiki redirect | [02](02-data-model-events.md) |

**Also open and required for real use:** the group is so far created entirely
outside the app through `nak` — there is no button to create a space (`9007`),
change its metadata (`9002`) or request to join (`9021`, for relays without
auto-join). On top of that, a relay under its own domain with TLS instead of
`localhost`. See [NOSTR.md](../NOSTR.md), section "Right now".

## Why this order

Requirement 5 (history) comes late even though it matters a lot — because from
phase 3 onwards the data model produces it *automatically*. Every save is
already an immutable, signed revision; phase 5 only builds the view on top. If
history were a feature bolted on afterwards, it would have to come earlier. That
is exactly why the event design is what it is.
