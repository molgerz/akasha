# 07 — Tech stack

| Area | Choice | Reasoning |
|---|---|---|
| Build | Vite + TypeScript | Static bundle, no server needed; deployable to any static host |
| UI | React | Largest ecosystem for editor and diff components |
| Nostr | **`nostr-tools`** (decided in phase 1) | `pool.automaticallyAuth` signs NIP-42 challenges automatically, `pool.publish` retries after `auth-required` — exactly the hooks [03](03-auth-nip07-nip42.md) asks for. Plus `nip19` for npubs and `verifyEvent` |
| Rejected | NDK (`@nostr-dev-kit/ndk`) | Its cache and event abstractions get in the way of our own revision DAG; the AUTH hooks are more directly accessible in nostr-tools |
| Cache | **none yet** | IndexedDB was planned for instant rendering and offline reading. So far everything lives in memory and is fetched from the relay on every load → open |
| State | **our own stores** (`useSyncExternalStore`) | Zustand was planned but turned out unnecessary: space state hangs off relay subscriptions, which are a store anyway. A library would only have added a layer in between |
| Rendering Markdown | `react-markdown` + `remark-gfm` + **`rehype-sanitize`** | Content comes from arbitrary npubs → sanitising is mandatory, not optional |
| Editor | CodeMirror 6 (`@codemirror/lang-markdown`) | Robust, handles large documents, good selection API for inline comments later. The live formatting is a decoration layer of our own on top of it → [13](13-editing.md) |
| Rejected | TipTap / ProseMirror for the editor | A WYSIWYG document model serialised to Markdown on save reformats lines nobody touched, and every such line becomes a diff hunk and a merge conflict. The document has to *be* Markdown → [13](13-editing.md) |
| Emoji | **a curated list of our own** (`src/ui/emoji.ts`) | An emoji database is ~3800 entries to download so that `:smi` can find 😄. A few hundred hand-ordered ones rank better and cost nothing |
| Diff | `diff` (jsdiff), `diffArrays` over line arrays | Line and word diff, the basis for blame and the three-way merge |
| Three-way merge | **written ourselves** (`src/domain/merge.ts`) | jsdiff v8 no longer ships `merge`. Ours is about 100 lines, fully tested, and we control how conflicts are presented |
| Styling | Tailwind, `dark` variant bound to `data-theme` | Atlassian-like density in tokens; a manual light/dark switch is required → [12](12-theming.md) |
| Syntax highlighting in the editor | CodeMirror, with a highlight style of our own bound to the theme tokens | Only inside fenced code. CodeMirror's `defaultHighlightStyle` also colours headings and bold text, which the live formatting has already answered → [13](13-editing.md) |
| Syntax highlighting when displaying | Shiki (`shiki`, JavaScript regex engine) | Dual themes in one pass, rendered from tokens rather than HTML, grammars loaded lazily — [12](12-theming.md) |
| Search | **written ourselves** (`src/domain/search.ts`) | MiniSearch was planned; for title and line search over the loaded pages, 60 lines are enough — no dependency and no index that can go stale |
| Unit tests | Vitest | The chain logic (head, merge, blame, search) is pure function logic → 179 tests |
| DOM tests | Vitest with **jsdom**, per file via `@vitest-environment` | The live formatting is decorations over a real document, so it can only be checked against a real editor. Set per file, not globally: the other 150 tests are pure logic and should not pay for a DOM |
| End-to-end tests | **none yet** | Playwright was planned, also for the colour-mode regression from [12](12-theming.md). So far testing is done by hand in the browser → open |

## Configuration

`.env.example` documents the switches: `VITE_RELAY_URL` for the group relay,
`VITE_PROFILE_RELAYS` for the relays profiles (kind 0) are fetched from,
`VITE_BLOSSOM_SERVER` for attachments and `VITE_BLOSSOM_SERVICE_PUBKEY` for the
Blossom server's own identity, which has to be a group member for attachment
reads to be checked (CON-26). The profile relays are needed because a
NIP-29 relay does not accept kind 0 at all — every event there needs an `h` tag.
Without configuration the app shows npubs instead of names, which is more honest
than an invented name.

## Structure of the code

This is what it actually looks like:

```
src/
  nostr/     kinds.ts (all kinds and tags), client.ts (relay, NIP-42),
             signer.ts, space-store.ts, profile-store.ts, publish-page.ts,
             publish-comment.ts, moderation.ts, blossom.ts, relay-status.ts
  domain/    revision.ts, pages.ts, merge.ts, blame.ts, diff.ts, search.ts,
             comment.ts, toc.ts, group-state.ts   — pure functions, tested
  session/   session.tsx   (sign-in, session, account switch)
  theme/     theme.tsx     (system/light/dark)
  ui/        layout/ and building blocks (Markdown, DiffView, PageEditor, …)
  routes/
  dev/       fake-nip07.ts (development mode only)
```

Deviations from the original plan, each with a reason:

- **No `data/` folder.** The planned cache layer was not built; what was needed
  from it (subscriptions, per-space state) lives in `nostr/space-store.ts`.
- **Different file names in `domain/`.** Instead of `revision-graph.ts` and
  `tree.ts` there are `pages.ts` (head resolution, tree, common ancestor) and
  `revision.ts` (event → revision). `diff.ts`, `search.ts`, `comment.ts` and
  `toc.ts` were added along the way.
- **`session/` and `theme/` as their own folders**, because both are React
  context and belong to neither the domain nor the Nostr layer.

What has not changed: everything in `domain/` is network-free and tested — that
is the core of the application.
