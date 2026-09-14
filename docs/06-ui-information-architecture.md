# 06 — UI & information architecture

## What the surface is after

The layout is Confluence's — left bar, document, right rail. The *surface* was
reworked to read more quietly: chrome that recedes, neutral greys where
Confluence uses tinted ones, icon-led navigation, and a document that sits on
the chrome rather than in a boxed panel. The icon set, the tokens and the
components are all drawn and written here, for this app.

Three rules came out of that rework, and they are what the rest of this file
applies:

1. **Neutral for state, accent for action.** A selected sidebar row, a pressed
   segment and a hovered list row are grey (`--surface-hover`,
   `--surface-selected`). Blue is left meaning one thing: "this does something."
   The tree used to be a column of blue pills, which made every page look like
   a button.
2. **Global bar for what is always true, page bar for what this page can do.**
   Two bars, not one growing one. See below.
3. **One control vocabulary.** `src/ui/controls.tsx` defines each kind of button
   and notice once, `src/ui/icons.tsx` draws every icon on one grid in one
   stroke weight. Views compose those instead of spelling their own Tailwind.

## Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ ▣  Akasha                🔍 Search pages   ⌘K      ● relay ☼ (M)  │ global bar 52px
├──────────────┬──────────────────────────────────────┬─────────────┤
│ (E) Engineer.│ Engineering / Handbook / Onboarding  │ ON THIS PAGE│ page bar 48px
│     localhos.│              [Read|Edit] ⟲  ≡  ⊞     │             │
│              │                                      │  — Goal     │
│ ⌂ Overview   │  Onboarding                          │  — Access   │
│ 🔍 Search    │  (c) carol · edited 2 h ago          │  — Contact  │
│ + New page   │                                      │             │
│              │  Markdown content …                  │             │
│ PAGES     +  │                                      │             │
│ ▾ ▤ Handbook │  ─────────────────────────           │             │
│   · ▤ Onboa. │  COMMENTS · 3                        │             │
│   · ▤ Tooling│  ┌────────────────────────┐          │             │
│ ▸ ▤ Processes│  │ (b) bob · 1 h ago      │          │             │
│              │  └────────────────────────┘          │             │
│ ⚙ Settings   │                                      │             │
│ ● relay/AUTH │                                      │             │
└──────────────┴──────────────────────────────────────┴─────────────┘
   264px            flexible, max-w-3xl / max-w-4xl      240px
```

The content area is a **raised surface**: `--surface-2`, with a 12px radius on
its top-left corner and a hairline on its top and left edges. The bar and the
global bar share `--surface-1` and carry no dividers of their own, so the
chrome is one continuous field and that one rounded edge is the whole of the
separation. It is a small thing and it is most of the difference: with a border
between three equal-coloured panels the document reads as a pane in a tool,
and without one it reads as a page lying on a desk.

## The global bar

Everything in it is true on every page: the app, the search, the relay, the
colour mode, your account. Three columns rather than a row — the two outer ones
share the remaining width equally, so **the search sits on the centre line of
the window** whatever the wordmark or the account chip are doing. In a plain
flex row it would drift off centre the moment one side grew, and a display name
is exactly the kind of thing that grows.

- **The panel toggle** is two buttons in one slot, one per breakpoint. What it
  toggles is not the same thing at both widths — a column that stays folded
  across reloads, or an overlay that closes on the next navigation — and a
  single button would have to guess the viewport to name what it does. For a
  bare icon the label *is* what it says. (Watch the cascade: `IconButton` is
  already `inline-flex`, Tailwind emits that after `hidden`, so the responsive
  `hidden` has to sit on a wrapper or both buttons show at once.)
- **Search** is a pill with the shortcut printed in it, and the shortcut works —
  ⌘K/Ctrl-K focuses and selects the field. A printed shortcut that does nothing
  is worse than none. It is still a field rather than a command palette: the
  palette is worth building, but not before there is more than one space to
  search across.
- **The relay** moved here from the foot of the left bar, because the left bar
  now folds away entirely and "nothing can be published right now" is not a
  state to hide behind a fold. Quiet while it is fine (a dot and the relay's
  name), coloured and worded the moment it is not (`offline`, `AUTH failed`).
  The full state — url, connection, attempts, AUTH message, NIP-29 support — is
  in the tooltip and spelled out in the left bar's footer.
- **The colour mode** is three icons in one track (system/light/dark,
  [12](12-theming.md)) rather than three words. Spelled out, "System Light Dark"
  was the widest thing in the narrowest strip of the layout; each name stays as
  the tooltip and the accessible name.
- **The account** is the picture alone at the very edge — see *How identity is
  displayed* below.

**"+ Create" is gone from here.** It moved into the left bar next to the page
tree: creating a page is something you do *to a place in the tree*, and next to
the tree it can say which place. In the middle of the top bar it could only ever
mean "somewhere in this space". What replaced it in that slot is nothing — the
search got the room.

## The page bar

A second, thinner bar, **sticky at the top of the content area**, carrying the
breadcrumb on the left and the page's own actions on the right.

Two reasons it is not part of the global bar. It scrolls with nothing, so where
you are and what you can do here stay reachable at the bottom of a long page.
And it keeps the global bar global: search and account do not change when you
navigate, while "Edit" and "History" mean nothing outside a page. Mixing the two
is what makes a top bar grow until it has to be redesigned.

- **The breadcrumb** is the full chain from the space down to the page, walked
  up through `page-parent`. Beyond four steps the *middle* ones collapse to `…`,
  never the ends: the space you are in and the page you are reading are the two
  you need. The walk is guarded against a cycle — `page-parent` comes off the
  relay from an arbitrary key, and two pages naming each other as parent would
  otherwise loop forever.
- **Reading and editing** are two states of one page and sit in one segmented
  switch. The three actions that open a *different* view — history, line origin,
  new subpage — are icon buttons, because four words in a row read as a sentence
  and stop being buttons. Each carries its label as tooltip and accessible name.
- The bar is translucent with a blur, so text scrolling under it is blurred
  away rather than cut off on the pixel it reaches the edge.

`PageFrame` has exactly one knob, `width`: a page is read line by line and gets
`max-w-3xl`; a list of pages or revisions is scanned in two dimensions and
suffocates in a column that narrow, so it gets `max-w-4xl`.

## The left bar — requirement 2 in detail

264px, five zones top to bottom:

1. **Space header** — the initials disc, the space name from `39000`, the relay
   host under it in mono. The disc's colour is derived from the name, so the
   same space is the same colour on every machine without anybody storing one,
   and two spaces in a list are told apart before either is read. The host stays
   visible rather than moving into a tooltip: relay host plus group id *is* the
   identity of a space here. **Open:** a space switcher and a "join" button for
   non-members.
2. **Fixed entries** — *Overview*, *Search*, *New page*, each with an icon.
   The member list is read-only on the overview page; adding/removing members
   lives on that space's admin settings (`/settings/spaces/:group`, reachable
   from an "Admin" button on the overview for admins) rather than in the bar.
3. **Page tree**, under a `PAGES` section heading that carries a **+** button.
   The button only appears on hover: the bar is a list of pages at rest and a
   set of controls the moment you reach for it, and the tree is read far more
   often than it is added to.

   Every row carries a page icon; the active row is filled with
   `--surface-selected` and set in medium weight. A branch with children folds
   behind a chevron, a leaf shows a dot in that same slot. Both occupy it, so
   titles stay on one vertical line instead of stepping in and out depending on
   whether a sibling happens to have children. A forked page keeps its own
   marker, but amber and *after* the title — otherwise it would read as the leaf
   dot. Each level indents by 14px.

   Which branches are folded is kept in `localStorage`. Deliberately the
   *folded* ones rather than the open ones, otherwise a page created later would
   stay hidden until somebody expanded its parent. The branch leading to the
   page being read is always drawn open, so a fold can never hide the very page
   you are on.

   **Moving**, signed in, has the two gestures Confluence has:

   - **onto a row** files the page under it, subpages included;
   - **into the gap between two rows** puts it at that position of *their*
     level, so it stays a sibling instead of becoming a subpage. The gap is a
     9px band straddling the row edge, drawn as a line indented to the level it
     would file into — that indent is what distinguishes "sibling here" from
     "subpage of the row above". The last row of a level carries a second band
     below its subtree, which is the "at the end of this level" position.

   The bands lie *over* the row edges (absolutely positioned) rather than taking
   space of their own, so the tree does not shift under the cursor the moment a
   drag starts, and they only exist while a drag runs — otherwise they would
   swallow clicks on the row edges. A page's own subtree is no target, and
   neither is the parent it already has: those rows accept no drop instead of
   reporting an error afterwards.

   Two details that cost time if got wrong: the row itself has to be the drag
   source, so the link inside it declines with `draggable={false}` — a link is
   draggable by default, becomes the source itself, and a *link* drag carries
   the effect copy/link, so the drop asking for `move` is silently thrown away
   (it then works only when the grab happens to land in the gutter). And the
   drag state is cleared from a `window` listener, because a drag can end
   without the source seeing `dragend` — cancelled with Escape, dropped outside
   the window, or the row unmounting mid-drag when a relay event rebuilds the
   tree.

   Both gestures publish a **placement** (`31818`), not a revision
   ([02](02-data-model-events.md)): the page's text, its history and its byline
   stay untouched, and moving the same page again overwrites the placement
   instead of piling up. A move is not an edit, and going back to an old
   revision therefore cannot move a page either.

   The page itself carries **no** move action any more: a picker on the page
   was tried and dropped again — dragging in the tree says where a page ends up
   far better than a list of slugs can.

   **Without a pointer that can drag (CON-15).** Dragging stays the primary
   gesture, but it is not a reachable one: HTML5 drag & drop has no keyboard
   path at all, and on a touch screen it does not fire even once — there,
   moving a page was impossible rather than awkward. Every row therefore
   carries a **move button** (`src/ui/PageMoveMenu.tsx`), a real button in the
   tab order and under a finger, opening a menu with two panels:

   - the four steps every outline editor has — **up**, **down**, **in** under
     the sibling above, **out** to directly behind the parent. Each names the
     page it moves past ("Move under Handbook"), and a step with nowhere to go
     is drawn disabled rather than reporting an error after the click. Where
     each one lands is `src/domain/move-tree.ts`.
   - **Move to…**, the list of every page it may be filed under plus the top
     level, in tree order and filterable by name. This is what dragging has no
     equivalent of, deliberately: a drag can only end where the pointer can
     reach, a list can name a row that is scrolled away or folded shut. Left
     out are the page itself, its own subtree and the parent it already has —
     the same three a drop refuses.

   A step that picks a *parent* ("in", "Move to…") writes **no** order key and
   lets the new level sort by title, which is exactly what dropping onto that
   row does. The tree must not look different depending on whether a mouse or
   the keyboard moved the page. A key is written only where a position within a
   level is genuinely being chosen: up, down and out.

   The trigger is hidden until the row is hovered or something inside it is
   focused, like the "+" on the Pages heading — the tree is read far more often
   than it is rearranged. A coarse pointer has no hover to reveal it with, so
   `pointer-coarse` leaves it permanently visible there; without that line the
   touch half of this would have shipped invisible.
4. **Settings** — one row to `/settings/spaces`, the entry into the settings
   hub (below). Stays visible even while already inside `/settings/*`, where
   the bar shows the hub's own nav (Profile/Spaces) instead of zones 2 and 3.
5. **Footer** — the relay state spelled out: name, connection, AUTH, and a
   NIP-29 line only when NIP-29 is *missing*. A relay that speaks it is the
   expected case and the footer has four other things to say.

Behaviour: the bar **folds away entirely** rather than down to a 40px rail of
icons, and stays folded across reloads. The rail held exactly one thing that
could not be reached elsewhere — the relay status — and that now lives in the
global bar. A strip holding a single dot is not a narrow sidebar, it is a
margin. Below 768px the bar is an overlay instead, opened from the same slot in
the global bar, closing again after every navigation.

The right-hand rail ("on this page") is a **rail of its own** — full height,
scrolling separately, `--surface-1` like the rest of the chrome — rather than a
column inside the document. The trail of headings is about the page but is not
part of it, and pinned to the window it still says where you are two screens
down. It is derived from the headings of the displayed Markdown and appears from
1280px width once there are at least two of them; headings inside code blocks do
not count, because a `# comment` in a shell example is not a heading. Each entry
carries a short rule at its indent level: at three levels of nesting and 12px
type the indent alone is hard to read.

## The reading surface

A page is a document, not a dialogue box, and is sized like one: **17px** body
text at 1.75 line height in `--fg` (not the muted grey the surrounding UI uses),
a heading scale that steps down visibly, and a line length capped at 70
characters. The cap matters because the content column is wider than that —
without it a line runs to about 100 characters and the eye loses the start of
the next one. 16px was tried first and read as UI text sitting in a document;
one step up is the whole difference. Tables and code blocks are exempt: they may
exceed the measure and scroll instead of squeezing. Tables get rules between
rows only — vertical ones as well turn a table in a document into a spreadsheet.

The same renderer serves comments, but at a second density: a comment sits
inside somebody else's page and stays at the 14px of the surrounding UI rather
than competing with the page it hangs under.

**Comments** are bordered cards, and a reply is a card indented behind a rule
running down the thread it belongs to. The rule is what makes a three-deep
thread readable; at 16px of indent alone the second and third level are told
apart by counting pixels. Reply and delete appear only on the card the pointer
is over: a column of cards each carrying two buttons is a form, the same column
with the buttons held back is a conversation. The same hover rule governs the
per-revision actions in the history and the "remove" in the member list.

The composer stays collapsed behind a "Write a comment" trigger, so an unread
page does not open with an empty textarea at the bottom of it. **Opening it
scrolls it into view** — at the foot of a long page it unfolds below the
viewport and nothing moves on its own. Focusing the textarea would drag itself
in, but only itself: the Send buttons under it stay below the edge, and signed
out there is no textarea at all. So the whole block calls `scrollIntoView` with
`block: 'nearest'` (the least it can, so a composer already in view does not
jump) and the focus is told `preventScroll`, giving one movement instead of
two. The editor's `Formatting` fold is the same row in the same place and does
the same thing — [13](13-editing.md).

**The history** is a timeline — one rule down the left with a marker per
revision, the current one in the accent colour. A stack of separate cards said
nothing about the order things happened in, and order is the whole point of a
history.

## Page states

| State | What is shown |
|---|---|
| Reading | Rendered Markdown, table of contents on the right, byline, action bar |
| Editing | Editor and rendered page look the same — there is no preview to toggle. Title, text, Publish/Cancel in the breadcrumb bar → [13](13-editing.md) |
| Conflict | Banner "this page has N open versions" plus a "merge versions" button; the merge itself happens in the editor, not in a dialog |
| Signed out | Nothing to read. Access needs a signed-in npub *and* membership, so a signed-out visitor sees the notice from "When the relay shows nothing" below, with the sign-in button in it. The button signs in **where it stands** — you never leave the page |
| Sign-in failed | A strip under the top bar with the reason. If no `window.nostr` exists it also says which extensions are common and that the app stores no key. Only after an attempt, never unprompted |
| Publish failed | Error message in the editor with the **literal relay reason**, classified by cause (AUTH needed, permissions, other). The text stays in the editor, nothing is lost |

The last state is mandatory, not a nicety: with distributed storage, "saved"
must never be claimed before the relay has sent `OK true`.

**Solved differently than planned:** instead of a yellow "saved locally only"
strip, the editor simply stays open and shows the relay's reason. A draft that
lives only in the browser would be a second storage location with its own
questions (where? for how long? what on account switch?) — that would need the
local cache that has not been built yet.

## When the relay shows nothing

A private space does not turn a stranger away — it answers with **nothing**, the
relay-signed group metadata included ([04](04-permissions-nip29.md)). Three
quite different situations therefore arrive as one empty result, and each view
used to invent its own explanation for it: the overview built a space out of the
group id and reported it empty, a page URL said "not found" and offered to
create the page, search said "Nothing found in 0 pages", and the left bar said
"no pages yet".

`spaceAccess` (`src/domain/space-access.ts`) tells them apart. Missing metadata
is the signal, not an empty page list — metadata arrives unasked for any group
you may see, while pages and members would be empty in a genuinely empty space
too.

| State | Shown |
|---|---|
| loading | nothing yet. An answer before the subscriptions settle would flash "no access" at a member on every reload |
| hidden, signed out | "This space is private", with the sign-in button inside the notice |
| hidden, signed in | "This space is not showing you anything", plus the viewer's own npub to hand to an admin |
| member | the space itself |

`reader` — a space the relay hands out to somebody who is not a member — is a
state the code can represent but the product does not want: **Akasha is for
closed teams, and reading always requires being signed in and invited.** A space
that turns up readable to a non-member is a misconfigured one, and the
overview's warning callout names the two flags that cause it, `public` and
`open`. `reader` itself raises no warning: it also appears while the member
list has not settled, where one would blame an admin for nothing.

The wording lives once, in `SpaceHiddenNotice`, and reads the same on the
overview, on a page and in search: the reader's situation is identical in all
three, and three wordings would read as three different problems. The left bar
gets three words of its own instead — it is 264px wide and already carries the
tree.

**What it never says is which.** "You are not a member" and "this space does not
exist" are the same silence from the relay, and nothing on this side can
separate them — the relay withholds it on purpose, because answering would
already confirm the space is there. The notice names both possibilities rather
than guessing and being confidently wrong at somebody who mistyped a group id.

## Editor

The **title is edited at the size it will be read at** — a borderless field the
width of the column, with the derived slug under it in the place the byline will
occupy. A 32px box labelled "Title" above the editor made writing a page feel
like filling in a record; this way the top of the editor and the top of the page
are the same shape. Save and Cancel are pinned to the bottom of the viewport,
because on a long page they were two screens below the paragraph being written.

**There is no Write/Preview switch**, because there is nothing to switch
between: the text is drawn as it will be read while it is being typed. `# ` and
a space sizes the line as a heading, `- ` becomes a bullet, `@` opens a list of
the people in the space. The full set of what is recognised, and why it is a
decoration layer over Markdown rather than a WYSIWYG document model, is
[13](13-editing.md).

- **Implemented**: CodeMirror 6 with live formatting, `@` mentions, `:` emoji,
  the `/` insert menu (table, image/attachment, code block, quote, divider —
  [13](13-editing.md)), and a folded `Formatting` disclosure listing the
  shortcuts. The attachment upload lives in that menu, which is what let the
  Attach button go. The colour mode is swapped through a `Compartment` so that
  cursor and undo history survive the switch.
- **Deliberately not a toolbar.** A toolbar puts the technical vocabulary back
  on screen permanently, which is exactly what the live formatting removes. The
  `/` menu keeps that promise: it is there when typed and invisible otherwise.
- **Planned**: macro and layout entries as further `/` blocks. The menu itself
  and the attachment upload are built; only the wiki-style macro entries are
  still missing.
- **Dropped**: the change-note field and the parent-page picker. Filing a page
  elsewhere is its own action, not a field in the editor.

## How identity is displayed

**Decision (2026-09-11): the display name is primary; the npub is the
fallback, not a companion.** Wherever authorship is shown — history entries,
blame lines, the page byline, comments, the member list — the row carries the
name from `kind 0`, and the shortened npub only when a key has no profile at
all. Not both at once: repeating `npub1qz…7k4f` after every name turned a
readable list into noise without answering the question it was put there for.

The npub is still the truth, and it stays reachable rather than repeated:

- every author line carries its npub in the `title` tooltip;
- a revision's **Details** view prints the full npub next to the event id;
- `/settings/profile` shows the signed-in npub in full.

One deliberate exception shows the key beside the name: the
**mention-autocomplete dropdown** lists the name **with** the shortened npub,
because that is the moment somebody picks between two people.
[13](13-editing.md). A mention inside a sentence is the ordinary rule on a
smaller stage — `@Alice`, key in the tooltip — because `npub1qz…7k4f`
mid-sentence is unreadable and a mention is not a claim about who signed
anything.

And where a key has no `kind 0` at all, the shortened npub is shown
regardless — there is no name to fall back to, and an unattributed byline would
be worse than a key.

## Settings

`/settings/*` is a small hub, two sections reachable from the left bar itself:
whenever no space is open, the bar shows a `Profile` / `Spaces` nav instead of
a page tree, the same slot Overview/Search/New page occupy inside a space —
one navigation surface, not two.

- **Profile** (`/settings/profile`) — the npub-wide `kind 0`, below.
- **Spaces** (`/settings/spaces`) — every space the signed-in npub is a member
  of, one row each, opening the space on click. Where the npub is that space's
  admin, the row also carries a labelled "Admin" button into
  `/settings/spaces/:group`, reachable the same way from an "Admin" button on
  that space's own overview page: name and description (sent as a fresh
  `9002`) and member administration — add (`9000`) and remove (`9001`), moved
  here from the overview, which now only shows the member list read-only. The
  invite-only flags are not exposed on the metadata form — the save always
  re-asserts `private`/`closed`/`restricted` regardless of input, because that
  is a decision for the whole app ([04](04-permissions-nip29.md)), not a
  per-space toggle a settings page should be able to undo. "Create a space"
  (`9007`, [01](01-architecture.md)) lives at the bottom of the spaces list.

  This is also where `/` redirects to — the app has no separate space-picker
  page any more, since it would only be the same list without the admin
  affordance.

  Deliberately not on the space's own sidebar: settings are per-npub or
  per-space-you-administer, not per-space-you-are-currently-reading, so they
  sit with the other account-level pages rather than inside a space.

### Profile

`/settings/profile` edits one's own `kind 0`: the three fields NIP-01 names —
`name`, `about`, `picture`. Three things make this more than a form:

- **Kind 0 is replaceable.** A save replaces the whole profile, so serialising
  only the fields we know would delete what another client has set (`nip05`,
  `lud16`, `banner`). The editor reads the existing event, writes into it and
  names the preserved keys in the UI, so that "I only see three fields" does not
  read as "the rest is gone".
- **It cannot be published to the space relay.** A NIP-29 relay demands an `h`
  tag on every event and rejects `kind 0`. The target is `VITE_PROFILE_RELAYS`;
  with none configured, saving is disabled and the reason is stated.
- **Several relays mean "saved" is not one boolean.** Every relay is listed with
  the reason it gave, literally — the same rule as for publishing a page.

The page also carries what used to be the sign-in page: **Connection** (signer,
space relay, NIP-42 state, profile relays) — the things that matter when a save
fails — and **sign out** at the bottom, with what it does spelled out: it only
forgets which npub is signed in here. The key stays in the extension, published
events stay on the relay.

### Why there is no `/login`

Signing in is one dialog in the extension. A page for it meant leaving whatever
you were reading, and then a `?next=` mechanism to get back. Both are gone:
`SignInButton` calls `login()` wherever it sits, and `SessionNotice` shows the
one thing the page was genuinely needed for — the reason it did not work. A
click that visibly does nothing, for somebody without an extension, is the worst
of the possible states.

## Routing

```
/                          redirects to /settings/spaces
/s/:group                  space overview (metadata, members, page list)
/s/:group/new              create a page  (?parent=<slug> for a subpage)
/s/:group/search           search         (?q=…)
/s/:group/:slug            read a page
/s/:group/:slug/edit       edit           (?merge=1 to merge versions)
/s/:group/:slug/history    history with comparison
/s/:group/:slug/blame      line origin
/settings/profile          edit one's own kind 0
/settings/spaces           every space the signed-in npub is a member of, open one, create one
/settings/spaces/:group    that space's settings (admin rows only, linked from the list)
```

`:group` includes the relay host (URL-encoded) so that a link is
self-contained: `/s/relay.example.com'engineering/onboarding`.
