# 13 — Writing: one mode, not two

**Decision:** the editor has no Write/Preview switch, because there is nothing
to switch between. The text is drawn the way it will be read while it is being
typed. Typing `# ` and a space sizes the line as a heading on the spot; `- `
turns into a bullet; `**bold**` goes bold; a pipe table is the grid it is edited
in and `![alt](url)` is the picture it points at. The Markdown markers are only
visible on the line the cursor is on.

**Why:** this is the thing a rich-text wiki gets right that a Markdown box does
not.
Somebody who does not know Markdown never has to hold two representations in
their head — "what I typed" and "what it will look like" — and never has to
click something to find out which is which. And somebody who does know Markdown
loses nothing: it is still Markdown all the way down.

**Non-goal:** a rich-text editor with a Markdown serialiser (TipTap,
ProseMirror). The document has to *be* Markdown, not be convertible to it —
[05](05-versioning-history.md) builds the revision chain, the line diff, blame
and the three-way merge directly on the stored text. A WYSIWYG tree that is
serialised on save would reformat lines nobody touched, and every such
reformatting turns into a diff hunk and a merge conflict. So the editor is the
source, decorated: `src/ui/markdown-live.ts` is a CodeMirror decoration layer,
not a document model.

## The one rule: the active line shows its markup

The line the cursor is on is source; every other line is the result.

```
# Release notes        ← cursor elsewhere: large, no hash
Everything about …
```
```
# Release notes        ← cursor on this line: the # is back, in grey
Everything about …
```

**Why per line and not per construct:** revealing "the markers of whatever my
cursor is inside" is what Obsidian does, and it means the markers of a bold word
appear and disappear as the cursor crosses it. One rule about lines is a rule a
reader works out in the first minute without being told.

Three deliberate exceptions:

- **A mention chip never falls back to raw text.** A 63-character npub in the
  middle of a sentence is not something anyone edits by hand, so it stays a
  chip and is *atomic* instead: one Backspace removes the whole mention. See
  below.
- **A task box never falls back either.** `[ ]` is not edited by hand — a box is
  ticked by clicking it — and a checklist is written *on* the line it is being
  added to. A box that only appeared once the cursor had left would mean that
  while you type `- [ ] milk` you watch plain text, and the list only turns into
  a list when you leave it: it reads as "it did not work". `- ` and `[ ]` are
  one marker here, so the dash goes with the box; Backspace takes the whole
  marker and leaves an ordinary bullet behind.
- **A table and an image never fall back either.** A table *is* the grid it is
  edited in — its columns only line up if every row is laid out against all the
  others, and the pipes are a second copy of the column count — and an image is
  the picture whose size is dragged. A wall of pipes or `![alt](url)` on screen
  is exactly the "weird Markdown view" this editor exists to avoid. Both are one
  thing the caret steps over, and both are edited where they are drawn.

The indentation of a nested list item is markup too, so the active line shows
it again — the item shifts by the two spaces it is written with, the way a
heading shifts by its `#`.

## What is recognised

Everything below is standard Markdown, so the same text renders in any Nostr
client that knows Markdown. There is exactly one deliberate deviation, and it
subtracts rather than adds: Setext headings are not recognised. It is written
down, with its cost, in `src/ui/markdown-flavour.ts`.

### Headings

| Type | Result |
|---|---|
| `# ` | H1 |
| `## ` | H2 |
| `### ` | H3 |
| `#### ` | H4 |
| `##### ` | H5 |
| `###### ` | H6 |

H5 and H6 are drawn small, bold and uppercase rather than smaller than body
text, which is what the reading view does too — see `PAGE` in
`src/ui/Markdown.tsx`.

**Setext headings are off.** CommonMark's second way of writing a heading —
`Title` with a line of `-` or `=` under it — is not recognised, in the editor or
on the page. A `-` under a paragraph is the first keystroke of `- milk` far more
often than it is a heading, and `---` under a paragraph is somebody drawing a
divider; neither means "make the line above a heading". Drawing it differently
cannot help, because the page would still render the H2. The reasoning and the
cost are in `src/ui/markdown-flavour.ts`, the single place that says so to both
parsers, and `markdown-flavour.test.tsx` pins the rest of GFM down against it —
that file exists because this change was once blamed, wrongly, for task lists
breaking. `# ` is unaffected.

### Lists

| Type | Result |
|---|---|
| `- ` or `* ` | Bullet list. The marker is drawn as `•`, one nesting level in as `◦`, deeper as `▪` |
| `1. ` | Numbered list. The number is **never** replaced, only toned down — a number carries information |
| `- [ ] ` (the space inside the brackets is part of it) | Task list with a real checkbox. Clicking it writes `[x]` into the text. It is the item's only marker — no bullet in front of it, the same as on the page |

**The indent is a step, not the spaces in the source.** A level is 1.5rem —
the `pl-6` a list gets in `src/ui/Markdown.tsx` — and the marker sits in the
gutter that step opens up, so a wrapped line lines up under the text. The two
spaces that nest an item in the source are markup like any other marker and go
away with it; drawn as they are written, a level would be four pixels instead
of a step and a list would be indented differently here than on the page. The
same goes for the marker itself: it is replaced together with the space behind
it, so the gap to the text is the width of the gutter and not a character.

**The invisible slip.** GFM asks for U+0020 between the brackets and nothing
else, so `- [<no-break space>] milk` is not a task at all — it is an ordinary
bullet followed by two brackets. On a German Mac layout `[` is Option-5 and `]`
is Option-6, so holding Option a moment too long over the space between them
produces exactly that character. Nothing on screen says so, because the
character is invisible; `- [x]` keeps working the whole time, which makes it
look as though ticked boxes were the only kind the editor has. Pasting the same
line from somewhere else works, because that space is a real one.

`normaliseTaskMarker` in `src/ui/MarkdownEditor.tsx` puts a plain space back, as
the marker is typed — in the box and in the gap behind it. There is no reading
of `- [<nbsp>]` in which the writer meant anything but a checkbox. Only
whitespace is touched: `- [y]` is left alone, because that really is brackets.

`Enter` continues a list and a quote, and on an empty item it removes the marker
instead of nesting another one — one press, whether the item is a bullet, a
number or a task.

That last part is `continueList` in `src/ui/MarkdownEditor.tsx`, bound above the
Enter the Markdown language brings. The language uses the same command but with
its default `nonTightLists`, and on the empty item of a list that still has only
one entry that default does not remove the marker: it inserts a blank line and
writes the marker again, because a blank line inside a list is what makes the
list *loose* in CommonMark, and the command keeps that option open. The marker
then only goes on the press after that — and only in the one-entry case, so the
key behaves differently depending on how much has been typed already, which is
not something anybody can learn. Ending the list wins over keeping it loose: a
list is written tight, and the empty line, if it is really wanted, is one
keystroke away afterwards.

The same rule cuts the other way when a list is already *loose* — has a blank
line in it. There the command puts a blank line in front of every new item to
keep it loose, so the cursor lands two lines down with an empty one above it.
That is not configurable, so `continueList` takes the blank line out again. One
rule underneath both halves: **an empty line is something the writer types,
never something a key leaves behind.** And since the first half is what made
lists loose by accident to begin with, the two are the same fix.

A quote still takes two presses: an empty quoted line is a paragraph break
inside the quote, which is a thing people want, so it is only the second one in
a row that ends the quote. `Tab` and `Shift-Tab` indent and outdent, **but
only inside a list**: everywhere else `Tab` has to keep moving focus out of the
editor, or the page cannot be operated from the keyboard at all.

### Text

| Type | Result | Key |
|---|---|---|
| `**text**` or `__text__` | **bold** | ⌘B / Ctrl-B |
| `*text*` or `_text_` | *italic* | ⌘I / Ctrl-I |
| `~~text~~` | struck through | ⌘⇧X |
| `` `code` `` | inline code | ⌘E |
| `[text](url)` | a link. Off the active line only the label is shown — the target is markup like any other marker | — |

The keys toggle: pressing ⌘B on already-bold text removes the markers rather
than nesting a second pair. With nothing selected the cursor lands between the
markers, ready for the word.

### Blocks

| Type | Result |
|---|---|
| `> ` | Quote — a rule down the left, the text in the muted colour |
| ` ``` ` | Code block. The fence goes away off the active line, the **language stays visible** — that is information, not markup |
| `---` or `___` | Divider, drawn as a rule across the measure |

A divider needs no blank line above it here. In CommonMark `---` directly under
a line of text is not a divider at all but a Setext H2 for the line above — the
trap this app closes by not recognising Setext headings. See
`src/ui/markdown-flavour.ts`. The `/divider` entry writes the blank line anyway
when the line above is text, because the stored text goes to clients that do
recognise Setext; the other entries need none — GFM's own reference parser, which
the page renders with, takes a table directly under a paragraph as a table.

Code inside a fence is coloured, but by a small style bound to the theme tokens
(`codeHighlight` in `src/ui/MarkdownEditor.tsx`), not by CodeMirror's default
highlight style. That default also colours headings and bold text, which would
be a second answer to a question the decorations have already answered.

### Tables and images

| Type | Result |
|---|---|
| `| a | b |` with a `---` line under it | The grid itself — a header band, a rule under every row *and* between every column, the alignment the delimiter row asks for with `---`, `:---`, `---:` or `:---:` — every cell edited in place, with a handle on the row's left edge and on the column's top edge |
| `![alt](url)` | The picture, from wherever it points. Clicking it selects it and shows a handle; dragging the handle sets its width |

**A table never becomes text again.** A cell is clicked and typed into, Tab and
Shift-Tab walk the cells — and Tab in the last one hangs another row on the
bottom with the caret in its first cell, which is where the writing continues;
Enter goes down a row, and Escape puts the cell back.
Clicking one brings out the two handles Confluence has: a chevron on the table's
left edge, level with that cell's row, and one on the top edge above that cell's
column. The left one opens the row's operations — insert above, insert below,
delete — and the top one the column's — insert left, insert right, delete, align.
That is Confluence's vocabulary exactly, and it is what the handles are for: one
click already says *which* row or column is meant, so the menu never has to ask.
The header row offers no "row above" and cannot be deleted, because GFM has no
row above it. A right-click on a cell still opens the whole set at once, in the
same order, for anyone who reaches for it. An insert then hands the caret to the
cell it made — the leftmost of the new row, the topmost of the new column — so
the next keystroke lands where the row or column just appeared instead of back
at the top left of the table. **Typing at the table's own edge** — the very
first or last position of its line — opens a line *outside* it: a character
after the closing pipe would otherwise become another column of that one row,
which is not a column, it is a typo. The block edges in
`src/ui/markdown-live.ts` are that rule.

**The blank line under a table belongs to the table, and is taken out of the
way.** A plain line directly beneath a row is another row to GFM, so a paragraph
under a table only exists if a blank line separates the two: the document really
has that line. But it is the table's syntax, not the writer's text, and it is a
line the writer can see and cannot write in — the character has to be pushed to
the line below it, or the table would swallow it as a row, so the text appears
somewhere other than where the caret was. So `/table` always writes that line
together with a line to write on: a page whose last block is a table used to end
there, with nothing under the grid at all, and a click in the empty space below
the card could not be typed at. The blank separator is then drawn with no height
and the caret steps over it (`EditorView.atomicRanges`), which leaves the air
under the grid to the line after it — a click anywhere below the table lands on
the line the writer writes on, and the character appears where it was clicked.
A page that stops at the grid, saved before the skeleton grew that line, opens
the two lines on the click itself. Backspace at the start of the paragraph does
nothing: deleting the separator would bring the paragraph up against the last
row, where GFM reads it as one more row, and the words would come back as a cell
of the table. **Enter at the table's edge goes to the line the character would
go to.** Pressed there it used to insert the newline and leave the caret in the
blank separator — a line with no height, so the cursor read as the bottom-left
corner of the card, and only a typed character (or a second Enter) reached the
paragraph line. The key now does what the character does: it moves the caret
onto that line, or opens a line above the words already standing under the
table. `src/ui/editor-table.ts`, `src/ui/markdown-live.ts`,
`src/ui/MarkdownEditor.tsx`

Under all of it the document stays a plain Markdown table. A cell is written
back when the caret *leaves* it, not on every keystroke: one edit is one undo
step, and nothing is reformatted that nobody touched. The structural operations
do rewrite the table — a column cannot be inserted any other way — and then the
pipes come out canonical (`| a | b |`, one space on each side, alignment
preserved from the delimiter row).

**A table operation never works from a stale grid.** Everything the menu does is
done at the ranges the widget was built from, and a widget can outlive its
document: a menu opened, the parser moving something, the grid redrawn while the
menu is still open. Replacing those ranges then takes text with it that was never
part of the table. So each operation first checks that the table is still exactly
the text it was built from, and does nothing when it is not — the menu was opened
against a document that no longer exists. `src/ui/editor-table.ts`

**A cell with nothing in it is still a cell.** The parser draws a cell only when
there is something in it: `|  |  |` is nothing but pipes. So the grid is read off
the *pipes* rather than off the cell nodes — otherwise a row of empty cells would
lose its columns (a header of two and a row of one under it), and the skeleton
`/table` writes would arrive with no cell to type into at all. Writing into one
replaces the whole space between its pipes, so the line comes out `| x |` and not
`|x  |`, the shape a structural edit writes as well. `src/ui/editor-table.ts`

**A block is a block, and nothing more.** CodeMirror brackets every replaced
widget with a zero-width buffer so the caret has a DOM position beside it. Around
a *block* widget that buffer becomes a line box of its own: one whole empty line
above the table or the picture and one below, on top of the card's own margin —
the reason a fresh table looked as though a blank line had been written before
it. The buffer is hidden on the lines that hold a table or a picture: the widget
is atomic, the caret steps over it. Measured in the running editor: the gap went
from 54px to 24px on each side. `src/ui/MarkdownEditor.tsx`

**And that air belongs to a line, never to the block itself.** A margin on the
widget is a strip *inside* the block's own line: a click there moves the caret to
the block's edge — not where the writer clicked — while nothing can be typed into
it, which reads as a blank line that cannot be used. CodeMirror's height map does
not even see it: `getBoundingClientRect` leaves a margin out, so the reserved
height and the pixels disagree. So a table and a picture have no margin at all.
Under a picture the gap is the padding of the line after it; under a table the
line after it is the table's own blank line, which takes no height, and the
padding is on the next line — the one the writer uses. Above them there is none:
the line before a block cannot own it without nesting `:has()`, which CSS does not
allow, and the paragraph's own line height leaves enough air. Measured in the
running editor: with a table at the end of the page the grid's line is exactly as
tall as the card, and the gap under it belongs to a line that takes a click and a
keystroke at the point clicked — no dead strip.

**Every row is at least one line tall.** A cell with nothing in it has no line
box, so a new row would come out a whole line shorter than the header above it —
and would only grow the moment somebody typed into it. Both sides give it one
line from the start: the editor puts a `min-height` on the text inside a cell,
the page a zero-width space after it, because `min-height` does not apply to a
table cell at all. `src/index.css`, `src/ui/MarkdownEditor.tsx`

**A cell is not a fragment of a rich-text document.** While the caret is in one
it shows its own text, the way the active line shows its markup; every other
cell shows the rendering, and `**bold**` and a mention chip are back as soon as
the caret has left. The editing surface is a transparent `<input>` lying exactly
over the cell's text: a click gives it the caret, and `:focus-within` swaps the
two, so there is no class to toggle from JS. It needs no `contenteditable`, and
the editor ignores every event inside a widget (`eventBelongsToEditor`), so
none of it reaches CodeMirror's own input handling.

Writing a cell redraws the whole table, and that redraw leaves the caret alone
on purpose: the focus is in a cell input and Tab already has the next cell in
hand. A widget that reached for the caret on every redraw would pull it back to
the first cell the moment a cell was written — and a click into another cell,
which blurs one and writes it, would land back at the top left as well. It only
reaches for the caret when the caret comes *into* the table from the document,
when the operation names the cell it just made, or when a blur says where the
focus is going: the event carries the element that is receiving it, which is how
the clicked cell survives the redraw. Every such lookup names its table by where
it stands in the document — `data-cell` counts from the top of each table, and a
page can hold more than one, so without that Tab walks the wrong grid. The same
goes for *taking* the caret: an edit in one table redraws every table on the
page, so a table only reaches for the caret while no cell input holds the focus.
That is a mark on the editor's own DOM, not a reading of
`document.activeElement` — by the time a later table is drawn, the input that had
the focus may already have been removed, and a removed element reads as "the
document has it", which is the wrong answer.

**An image keeps its Markdown to itself.** `![alt](url)` never appears on
screen: the picture is the picture, under the caret too, and it is atomic — the
caret steps over it and one Backspace removes it whole. What a click offers is
the size: the picture is selected and a handle appears; dragging it scales the
picture, and letting go writes the width into the URL's fragment,
`#width=480`. **The page draws that width too** (`MarkdownImage` in
`src/ui/Markdown.tsx`) — a picture made smaller in the editor is smaller where
it is read, which is the whole point of resizing it. No server ever receives a
fragment, no other client draws one, and the image itself is untouched.
**Cost, stated plainly:** another client shows the picture at its natural size,
and `#width=480` is visible in the source, the history and the diff.
`src/ui/image-width.ts`

**A picture is a block.** Nothing is written beside it: the picture is drawn as a
block of its own, and typing at the edge of the line it stands on opens a line
outside it, the same way a table's edge does — the text then sits above or below
the picture instead of running around it. `src/ui/MarkdownEditor.tsx`,
`src/ui/markdown-live.ts`

**A picture with no size of its own is measured, not guessed.** An SVG written
`width="100%"` has no width to shrink-wrap against: inside the editor's box,
which is exactly as wide as the picture in it, it laid out to nothing — the
picture was a two-pixel sliver under the caret while the page, where it sits in
a full-width block, drew it at the whole measure. So the editor measures such a
picture once at that measure and pins the width to it; the URL stays untouched,
because nothing was *chosen* here. `src/ui/editor-image.ts`

Both are drawn by a `StateField` for the table and by the line plugin for the
image. The table cannot come from a plugin at all: replacing it spans line
breaks, and "decorations that replace line breaks may not be specified via
plugins" — the same reason CodeMirror's own folding is a state field. Its
columns are a CSS grid with the same count and the same fractions on every row,
which is what lines them up; a `table` element's own layout does not survive
being put inside a line of text.

### Mentions — `@`

Typing `@` at the start of a word opens a list of the people in the space
(admins and members from `39001`/`39002`, via `spacePeople` in
`src/domain/group-state.ts`).

**Decision:** what is written into the text is the key, not the name — a NIP-27
`nostr:npub1…` URI. What is *shown*, in the editor and in the rendered page, is
the name.

**Why:** a display name is freely chosen, not unique and can change. `@alice`
in a stored page would point at whoever calls themselves alice on the day it is
read. The key cannot drift.

A mention shows the name with the key one hover away (`title`), the same way
every author line does ([06](06-ui-information-architecture.md)): a mention sits
inside a sentence, and `npub1qz…7k4f` mid-sentence is unreadable. The chip's
shape says it stands for a person, and — unlike a byline — a mention is not a
claim about who signed anything.

The dropdown lists the name **with** the shortened npub beside it, because that
is the moment somebody picks between two people. Until a profile has arrived
from `VITE_PROFILE_RELAYS` an entry can only be searched for by its npub;
picking it still works and the chip fills in the name when the profile lands.

Every mentioned key is also written as a `p` tag on the revision and on
comments, as NIP-27 asks — otherwise the mention is findable by whoever reads
the page but not by the person mentioned. See [02](02-data-model-events.md).

### Emoji — `:`

`:` plus at least one letter opens a dropdown that leads with the character
itself, because that is what is being chosen. Picking one inserts **the
character**, not the shortcode: the page then needs no emoji support to render
it and it survives every foreign client.

The list is a curated few hundred entries in `src/ui/emoji.ts`, not an emoji
database — the point is that `:smi` finds 😄 without a keyboard shortcut, and
for that a hand-ordered list beats 3800 entries that have to be downloaded
first. Ranking is exact name, then prefix, then substring, then keyword, so
`:ear` offers `earth_africa` before `bear`.

A lone `:` opens nothing. `:` is punctuation far more often than it is the start
of an emoji, and the boundary guard also keeps the dropdown out of `https://`
and out of `12:30`.

### Insert menu — `/`

`/` at the start of a line opens a menu of blocks: **Table**, **Image /
attachment**, **Code block**, **Quote** and **Divider**. It is the editor's
third dropdown, built on the same autocompletion as `@` and `:` — one popup
theme and one keyboard model, not a menu of its own.

It exists for the one piece of Markdown that is genuinely hard to type by hand:
the **pipe table**. The entry writes a 3×2 skeleton — a header and two body rows,
because one row is a table to extend before it can be typed into — and puts the
cursor in the first header cell, so the next keystrokes are cell contents; the
rendered page then treats it like any other GFM table (`src/ui/editor-slash.ts`
exports the skeleton as `TABLE_SKELETON`). If something already stands on the
line below — or right behind the slash query — one blank line goes in between:
the table would otherwise take that line as a row of its own and swallow a
paragraph that was not part of it. When nothing follows, the blank line and the
line to write on are written anyway, so a fresh table is never the last thing in
the document (see the blank line under a table, above). **The block lands on the line the
slash stands on**, because the slash is the first character of its line: every
entry writes its block where the command was typed and no blank line in front of
it. Only the divider asks for one, and only when the line above is text. The
other entries leave the cursor where the writing continues — the code entry lands
on the fence's language line, the divider after the rule.

`/` only opens where the slash is the **first character of its line**. `@`
stays out of e-mails and `:` out of `https://` for the same reason: a dropdown
that fires in the middle of a sentence is worse than none. It also stays out of
inline code, a fenced block and a URL, and typing after the slash narrows the
list — `/ta` is Table, `/img` the attachment entry, because each entry carries
aliases.

**The attachment entry is the Blossom upload's way back in.** Picking it opens
the file picker and removes the typed `/image`; the file is uploaded with the
same kind `24242` authorisation as before and the resulting `![alt](url)` (a
link for anything that is not an image) is inserted at the cursor. Dragging a
file onto the editor runs the same upload. Without `VITE_BLOSSOM_SERVER` the
entry cannot open a picker that could only fail, so it shows the reason where
the upload note sits — the same promise as before, kept by the menu instead of
by a disabled button.

The upload files the blob under the space (an `h` tag) and reading it back needs
a `t=get` token from a member, so an attachment in a private space is not public
(CON-26). In the editor that means a blob on our own Blossom server is fetched
with that token and drawn from an object URL; a picture on a foreign host is
drawn directly, as before. src/nostr/attachment-access.ts

## Why the write and read views must not drift

The sizes in `editorTheme` (`src/ui/MarkdownEditor.tsx`) mirror `PAGE` in
`src/ui/Markdown.tsx` — 17px body at 1.75, the same heading scale, the same
70-character measure. They are two implementations of one scale, because one is
CSS-in-JS for CodeMirror and the other Tailwind classes for React.

**Consequence:** changing one means changing the other. If they drift, writing
and reading stop looking alike, and that is the only thing this whole file is
for. Both places carry a comment saying so.

The editor also grows with its text instead of scrolling inside a 60vh box: a
page is a document, and a document does not have a window in it.

### A trap while developing

The CodeMirror instance is built once, in an effect that does not depend on
`markdown-live.ts`, and it keeps the extensions it was built with. A hot update
to the decorations therefore replaces the module while the editor on screen goes
on using the old ones — the change looks like it simply did not work, and no
amount of further editing makes it land. Worse, the rendered page *does* update,
because that is an ordinary React render: the two views appear to disagree, and
the disagreement is a ghost.

Both files therefore ask Vite for a reload instead of accepting a hot update:

```ts
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot?.invalidate())
}
```

### Empty lines

Markdown collapses them: `a`, three empty lines, `b` parses to exactly the same
document as `a`, one empty line, `b`. The editor, though, draws the source — so
there the three lines *are* three lines, and a page that renders one of them
looks nothing like what was written.

So the gap is read back off the positions the parser recorded and put in as
height, by `rehypeBlankLines` in `src/ui/markdown-blank-lines.ts`. The rule:

- **every** empty line the writer typed is a line, including the single empty
  line that separates two paragraphs, and is kept at exactly the height it has
  in the editor. The writer typed a line and the page shows a line;
- **before the first block** there is nothing to separate, so every empty line
  counts as well;
- **after the last block** they are dropped. Trailing empty lines are where the
  cursor was left, not something anybody typed.

The paragraph margin does not do this job. It used to stand in for the first
empty line, but it collapses to less than a line, so a single empty line came
out shorter than the editor's. `.md-content > *` in `src/index.css` takes the
vertical margins off the top-level blocks instead, and the spacers are the
whole of the vertical rhythm between them. Top level only: a paragraph inside
a quote or a loose list is not a paragraph break and keeps its own spacing.

A line that holds only invisible characters — U+00A0 from Option-Space, the
other non-ASCII spaces, the zero-width ones — is the same trap as
`- [<nbsp>]` in a task marker. CommonMark does not count it as blank, so it
continues the paragraph, the line break collapses to a space, and two separate
paragraphs arrive as one that reads `a b` while the editor draws an empty line.
`normaliseInvisibleLines`, in the same file, turns such a line into an empty
line before the parser sees the source. An invisible character inside a
sentence is real text and is left alone.

The plugin runs *after* `rehype-sanitize`, on purpose: the spacer carries a
`style`, which is exactly the sort of attribute the schema strips. Running
afterwards keeps the check on the author's content strict while ours, which is
not the author's, gets through.

### Line breaks

A single newline inside a paragraph is a soft break to CommonMark: the lines are
joined and a space stands where the newline was, so `Hallo` and `Test` on two
lines read `Hallo Test`. The editor draws the source, so there the newline is a
line, and the same text reads differently in the two views — the empty-line
disagreement one line down. In a wiki the writer presses Enter and means it.

`remarkLineBreaks` in `src/ui/markdown-flavour.ts` turns a soft break into a
`break` node, the node a hard break already uses, so the page draws a `<br>`.
It only touches the page parser: the editor already draws every newline as a
line, so there is nothing to tell it. The stored text stays plain Markdown — a
client that keeps CommonMark's soft break reads the same text as one sentence.
That is the cost, and it is the same trade as the empty lines: the page matches
the editor it was written in. A newline inside a fenced code block is untouched;
a fence carries its content as code, not as paragraph text.

## Formatting help, folded away

There is a `Formatting` disclosure under the editor listing every shortcut
above. It is folded, and it is not a toolbar.

Every line in it has to be something that actually works when it is typed. It
is read at the moment somebody is asking "why did that not do anything", so an
entry that is almost right — `- []`, which gives a bullet followed by a literal
`[]` — costs more than no entry would. When a marker changes here, that list is
part of the change.

It is deliberately **the same row as "Write a comment"** under a page, in the
same place: a rule, the same gap below it, the same muted 14px line with an
icon in front, and flush with the bottom of the column rather than floating
right under the text. That last part is `PageFrame`'s `stretch` prop — the
frame becomes a flex column and the editor takes what is left, exactly the way
the reading view grows its content so the comment composer lands at the foot of
a short page.

The room this opens under the last line is not dead: clicking it puts the
cursor at the end of the document, the way clicking under the last paragraph of
a document does.

**Opening the fold scrolls it into view.** On a short page it needs no help —
the editor gives the room back, because `flex-1` lets it shrink down to its
text. On a long one it cannot, so the content would appear below the viewport
and nothing would move. The block therefore calls `scrollIntoView` with
`block: 'nearest'`, which scrolls the least it can: the long-page case comes up
into view, the short-page case stays put instead of jumping.

The comment composer on a published page has the same problem and the same
answer — see [06](06-ui-information-architecture.md). Both are the one fold at
the foot of the column, so both had better behave the same way.

Both rows play the same part — the one quiet thing at the foot of the column
that opens when asked — so they should not be two different shapes. The arrow is
the page tree's `ChevronRight`/`ChevronDown`, so that a fold looks like a fold
everywhere in the app.

**Why not a toolbar:** a toolbar puts the technical vocabulary back on screen
permanently, which is exactly what the live formatting removes. The help is
there for the second question — "how do I get a quote?" — not the first one.

## Open

- **Tables.** `/table` writes the skeleton, the editor draws the grid and
  edits it there — rows and columns in and out from the handles on its edge —
  and [`Markdown.tsx`](../src/ui/Markdown.tsx) renders GFM tables, wide ones
  scrolling. What is still missing is what a spreadsheet has and a page does not
  need yet: moving a row or a column by dragging, selecting a range of cells and
  pasting a block out of a spreadsheet.
- **Macros and layouts.** The insert menu (`/table`, `/image`, `/code`,
  `/quote`, `/divider`) holds the blocks the plain editor needs; the wiki-style
  macro and layout entries are still not built.
- **Auto-replacing a typed-out `:smile:`.** Only the dropdown converts a
  shortcode today. Doing it on the text as well risks firing inside things like
  `a:b:c`, so it waits for a reason.
- **Real-time collaboration.** Unchanged from [05](05-versioning-history.md):
  two people editing at once are resolved by the optimistic lock and the
  three-way merge, not by a CRDT.
