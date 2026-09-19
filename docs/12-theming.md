# 12 — Theming: light and dark

**Requirement:** switchable between light and dark mode.

## Decision

Three states, not two: **system / light / dark**. "System" is the default and
follows `prefers-color-scheme`; a manual choice overrides it and is kept in
`localStorage`. The switch sits in the top bar next to the account chip.

Implementation: a `data-theme="light|dark"` attribute on the `<html>` element,
set by JavaScript. Tailwind's `dark` variant is bound to that attribute (not to
the media query), otherwise the mode cannot be forced manually. Additionally
`color-scheme`, so that scrollbars, selection colour and form controls are
rendered appropriately by the browser.

**Solved slightly differently than written above:** not `color-scheme: light dark`
on `:root`, but `light` there and `dark` under `[data-theme='dark']`. The
two-value form hands the choice back to `prefers-color-scheme` — which is
exactly the manual override this design went to the trouble of building. A
checkbox in a page would then stay light on a dark page whenever the system was
set to light.

## Token layers

Components **never** use raw colours, only semantic tokens. Exactly one file
defines both palettes, `src/index.css`:

| Token | Meaning |
|---|---|
| `--surface-0/1/2` | Sunken (segmented tracks, pills), chrome (global bar, left bar, right rail), the document canvas |
| `--surface-hover`, `--surface-selected` | A row under the pointer, a row that is the current one |
| `--fg`, `--fg-muted`, `--fg-subtle` | Body text, secondary text, hints |
| `--line`, `--line-strong` | Dividers, hover borders |
| `--accent`, `--accent-bg`, `--accent-fg`, `--accent-contrast` | A solid primary button, a tinted info block, a link, text *on* a solid accent fill |
| `--danger`, `--warning`, `--success` (+ `-bg`) | Conflict banner, publish errors, "saved" |
| `--diff-add-bg`, `--diff-del-bg` | Diff view: added and removed lines |
| `--diff-word-add-bg`, `--diff-word-del-bg` | Word-level highlighting inside a changed line (instead of a single `--diff-word-bg`: added and removed need different colours) |
| `--code-bg`, `--code-line` | Code blocks in Markdown |

Rule: if a component needs a colour that does not exist as a token, add the
token — do not write the colour inline. That is the only way the second mode
stays maintainable at all.

### The palette is a neutral grey scale

Cool, light greys rather than the blue-tinted Atlassian ones this started with,
and — the part that actually changed how the app reads — **state is neutral and
only action is accent**. A selected sidebar row, a pressed segment, a hovered
list row all take `--surface-hover` / `--surface-selected`. The accent is left
meaning one thing.

Before this the accent was doing two jobs, "this is where you are" and "this
does something", and the page tree was a column of blue pills that all looked
clickable in the same way as the Save button. Two tokens fixed a problem that
had looked like a layout problem.

### Two accent tokens, not one

`--accent` is a solid fill and `--accent-contrast` is the text on it. The second
one is **not** simply white: in dark mode the accent is a light blue (`#4dabf7`)
and white on it falls under 3:1, so there it is the near-black surface colour
instead. A single "on-accent = white" would have been legible in one mode only.

In dark mode, no pure black as a surface (too harsh a contrast, halation around
text) and no pure white as text. Contrast at least 4.5:1 for body text
everywhere.

## The four places this usually breaks

1. **Code blocks in Markdown** — syntax highlighting needs two themes. Shiki
   emits both palettes in a single pass: every token carries `--shiki-light` and
   `--shiki-dark`, and two CSS rules keyed on `data-theme` decide which is read.
   Switching the mode therefore repaints without highlighting again, and no
   stylesheet is swapped at runtime. *(Done — see below.)*
2. **The editor** — CodeMirror 6 brings its own theme. The switch has to happen
   through a `Compartment` with `reconfigure`, not by rebuilding the editor,
   otherwise cursor and undo history are lost when switching.
3. **The diff view** — the red/green from light mode is either unreadable or
   shouting in dark mode. Separate, desaturated tokens for both modes, and mark
   additions and removals with `+`/`−` as well, not by colour alone
   (red-green colour blindness).
5. **Task-list checkboxes in Markdown** — the sanitiser's default schema drops
   `checked` from a checkbox, so a ticked box would render as unticked and the
   list would quietly lie about its state. The schema is extended by that one
   attribute. The control itself stays native rather than being restyled:
   `color-scheme` already makes the browser draw it correctly in both modes,
   and a hand-built box would mean maintaining two more sets of colours.
4. **Foreign content** — avatars and embedded images from `kind 0` or from pages
   arrive with arbitrary backgrounds. Make no transparency assumptions; in dark
   mode images get a neutral border rather than a filter.

## Highlighting code blocks

Shiki, as suggested above, with two decisions that are not obvious:

- **Tokens, not HTML.** Shiki can return a finished HTML string, but the content
  of a code block comes from an arbitrary npub, and this app renders no foreign
  HTML anywhere ([09](09-security-privacy.md)). `codeToTokens` returns text plus
  colours, which become React elements — no `dangerouslySetInnerHTML` in the
  reading path.
- **The JavaScript regex engine, not the Oniguruma WASM one.** 16 kB gzipped
  against 230 kB, for a chunk almost every reader of a technical wiki will pull.
  The engine translates Oniguruma patterns into JavaScript regexes and can fail
  on a grammar it cannot express; all languages the app registers were checked
  against it. A grammar that fails falls back to plain text rather than breaking
  the page.

Grammars and the highlighter itself are dynamic imports, so nothing of Shiki
sits in the main bundle — somebody who never opens a page with a code block
never downloads it.

## Two things every mode gets for free

- **One focus ring, defined once.** `:focus-visible` in a base layer, a 2px
  accent outline with 1px offset, for everything focusable. Per-component rings
  drift, and half of them get forgotten. `:focus-visible` and not `:focus`, so
  a click does not leave a ring on a button that was only pressed.
- **Slim scrollbars on the chrome** (`scroll-slim`). The left bar and the right
  rail scroll behind the content, and a default scrollbar draws a grey trough
  over the chrome wider than the tree's own indent — loud, for a bar you are
  meant to read past.

## No flash on load

A tiny blocking script reads `localStorage` and sets `data-theme` **before** the
bundle loads. Without that step, every reload briefly flashes light mode.

It used to be inline in `index.html`. It now lives in
`public/theme-bootstrap.js` and is loaded with
`<script src="/theme-bootstrap.js"></script>` — **classic and
render-blocking**, deliberately not `type="module"` and not `defer`, both of
which are deferred and would bring back exactly the flash this script exists to
prevent. Vite copies `public/` verbatim, so there is no build entry for it.

The reason for the move is the Content-Security-Policy
([09](09-security-privacy.md)): under `script-src 'self'` an inline block is
blocked, and the alternatives are worse. A hash has to be recomputed every time
the script is touched, and silently blocks the script when someone forgets; a
nonce has to be minted per response, which a static host cannot do at all. The
cost is one extra request before first paint. It is a few hundred bytes from
the same origin, requested from `<head>` before the bundle, so on a local
preview build it lands well ahead of the paint it has to beat — but that is
the shape of the trade, not a budget: no figure here is a contract, and the
margin on a cold cache over a slow link is the case to re-measure if the flash
ever comes back.

## Timing

**Decision:** tokens and the switch land in **phase 0**, not later. Retrofitting
dark mode means touching every component a second time; working with tokens from
the start costs almost nothing.

Verification: **open.** Playwright screenshots of the four core views (reading a
page, editor, history, diff) in both modes are planned as a regression test. For
now testing is done by hand in the browser.
