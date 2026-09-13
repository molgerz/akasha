import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import type { EditorState, Extension, Range, Text } from '@codemirror/state'
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common'
import { findMentions } from '../nostr/mentions'
import { ImageWidget } from './editor-image'
import { tableAtomicRanges, tableState } from './editor-table'
import { mentionChip, releaseMention } from './mention-chip'

/**
 * Live formatting for the Markdown editor: what you type is drawn the way it
 * will be read.
 *
 * The document stays plain Markdown — that is not negotiable, because a
 * revision, a diff, blame and the three-way merge all work on the text itself
 * (`src/domain/`). So this is not a rich-text editor with a Markdown
 * serialiser; it is the source, decorated. Typing `# ` turns the line into a
 * heading on the spot, and the `#` is only shown while the cursor is on that
 * line.
 *
 * **Reveal is per line, not per node.** The line you are editing shows its
 * markup, every other line shows the result. That is one rule a reader can
 * hold in their head, instead of "the markers of the construct my cursor
 * happens to be inside".
 *
 * **Two constructs are the exception, and each has a module of its own: a table
 * and an image.** Neither ever shows its Markdown. A table *is* the grid it is
 * edited in (src/ui/editor-table.ts): its columns only line up if every row is
 * laid out against all the others, and the pipes are a second copy of the column
 * count. An image is the picture that gets resized (src/ui/editor-image.ts) —
 * `![alt](url)` on screen would be exactly the "weird Markdown view" this editor
 * exists to avoid. Both are drawn the way `src/ui/Markdown.tsx` draws them on
 * the page, down to loading an image from wherever it points.
 *
 * The sizes below mirror the `PAGE` scale in `src/ui/Markdown.tsx` — when one
 * of the two changes, the other has to follow, or write and read mode drift
 * apart, which is the whole point of this file.
 * docs/13-editing.md
 */

/**
 * No mention chip is drawn inside these. Code, because a mention in a code
 * sample is a quoted key and not a person. `URL`, because a link target is
 * already being hidden as markup — two replacements over the same stretch of
 * text is one too many, and `[Alice](nostr:npub1…)` reads perfectly well as
 * the link it is.
 */
const NO_MENTION = new Set([
  'InlineCode',
  'CodeText',
  'FencedCode',
  'CodeBlock',
  'HTMLBlock',
  'URL',
])

const HEADING_CLASS: Record<string, string> = {
  ATXHeading1: 'cm-md-h1',
  ATXHeading2: 'cm-md-h2',
  ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4',
  ATXHeading5: 'cm-md-h5',
  ATXHeading6: 'cm-md-h6',
}

const hidden = Decoration.replace({})

const line = (cls: string) => Decoration.line({ class: cls })
const mark = (cls: string) => Decoration.mark({ class: cls })

const EM = mark('cm-md-em')
const STRONG = mark('cm-md-strong')
const STRIKE = mark('cm-md-strike')
const INLINE_CODE = mark('cm-md-inline-code')
const LINK_TEXT = mark('cm-md-link')
const CODE_INFO = mark('cm-md-code-info')
const LIST_NUMBER = mark('cm-md-number')

class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super()
  }
  eq(other: BulletWidget) {
    return other.depth === this.depth
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-md-bullet'
    // Nested levels get a different shape rather than the same dot indented,
    // so depth is visible without counting pixels.
    span.textContent = this.depth >= 3 ? '▪' : this.depth === 2 ? '◦' : '•'
    return span
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-md-rule'
    return span
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.className = 'cm-md-task'
    box.setAttribute('aria-label', this.checked ? 'done' : 'open')
    // The position is read from the DOM at click time, not captured here: the
    // widget outlives edits above it, and a remembered offset would tick the
    // wrong box.
    box.addEventListener('mousedown', (event) => {
      event.preventDefault()
      const pos = view.posAtDOM(box)
      const text = view.state.doc.sliceString(pos, pos + 3)
      if (!/^\[[ xX]\]$/.test(text)) return
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: text[1] === ' ' ? 'x' : ' ' },
      })
    })
    return box
  }
}

class MentionWidget extends WidgetType {
  constructor(readonly pubkey: string) {
    super()
  }
  eq(other: MentionWidget) {
    return other.pubkey === this.pubkey
  }
  toDOM() {
    return mentionChip(this.pubkey)
  }
  destroy(dom: HTMLElement) {
    releaseMention(dom)
  }
}

/**
 * The lines the selection touches. Those show their markup; everything else is
 * formatted. An unfocused editor reveals nothing — otherwise a page that has
 * only just been opened shows a stray `#` on its first line.
 */
function revealedLines(state: EditorState, hasFocus: boolean): { from: number; to: number }[] {
  if (!hasFocus) return []
  return state.selection.ranges.map((range) => {
    const first = state.doc.lineAt(range.from)
    const last = range.to <= first.to ? first : state.doc.lineAt(range.to)
    return { from: first.from, to: last.to }
  })
}

/**
 * Whether a `Link`/`Image` node is really one.
 *
 * Any pair of brackets parses as a `Link` — `[X]`, `[ ]`, `[see]` — because it
 * *might* be a reference to a definition further down. Almost always there is
 * no such definition, and then the page prints the brackets as the text they
 * are. So a bracket pair only counts as a link once it carries a target, and
 * only then are the brackets hidden as markup.
 *
 * This is what made a checkbox impossible to type: `[` and `]` disappeared the
 * moment they were closed, and `- [ ] milk` was drawn as a bullet followed by
 * nothing at all until the parser had a whole task to look at.
 */
function hasTarget(node: SyntaxNode | null | undefined): boolean {
  for (let child = node?.firstChild; child; child = child.nextSibling) {
    if (child.name === 'URL') return true
  }
  return false
}

/**
 * The target of a `![alt](url)` image, with the range it occupies.
 *
 * The range is what a resize rewrites: only the URL changes, so the alt text,
 * a title and the rest of the line are left exactly as the writer had them.
 */
function imageTarget(node: SyntaxNode, doc: Text): { from: number; to: number; text: string } | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'URL') {
      return { from: child.from, to: child.to, text: doc.sliceString(child.from, child.to) }
    }
  }
  return null
}

/** The alt text of an image — what is written between the brackets. */
function imageAlt(node: SyntaxNode, doc: Text): string {
  let alt = ''
  let pos = node.from
  for (let child = node.firstChild; child; child = child.nextSibling) {
    // The alt text is not a node of its own — it is what lies *between* the
    // markup nodes, so the gaps are the text and the markers are skipped.
    if (child.from > pos) alt += doc.sliceString(pos, child.from)
    if (child.name !== 'LinkMark' && child.name !== 'URL') {
      alt += doc.sliceString(child.from, child.to)
    }
    pos = child.to
  }
  return alt
}

function hasAncestor(node: SyntaxNode, name: string): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === name) return true
  }
  return false
}

/** How deeply a list item is nested, counted in enclosing lists. */
function listDepth(node: SyntaxNode): number {
  let depth = 0
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'BulletList' || parent.name === 'OrderedList') depth += 1
  }
  return depth
}

function build(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
  const state = view.state
  const decos: Range<Decoration>[] = []
  const atoms: Range<Decoration>[] = []
  const regions = revealedLines(state, view.hasFocus)
  /** true while the cursor is on this stretch — then it stays raw text */
  const raw = (from: number, to: number) =>
    regions.some((region) => from <= region.to && to >= region.from)

  const eachLine = (from: number, to: number, apply: (pos: number, index: number, last: number) => void) => {
    let pos = from
    let index = 0
    const total = state.doc.lineAt(to).number - state.doc.lineAt(from).number
    while (pos <= to) {
      const current = state.doc.lineAt(pos)
      apply(current.from, index, total)
      if (current.to >= to) break
      pos = current.to + 1
      index += 1
    }
  }

  /** the position after the spaces that separate a marker from its text */
  const afterSpaces = (to: number) => {
    let end = to
    while (end < state.doc.length && state.doc.sliceString(end, end + 1) === ' ') end += 1
    return end
  }

  /** hide a marker together with the spaces that separate it from the text */
  const hideWithSpaces = (from: number, to: number) => {
    decos.push(hidden.range(from, afterSpaces(to)))
  }

  const tree = syntaxTree(state)

  for (const { from: viewFrom, to: viewTo } of view.visibleRanges) {
    tree.iterate({
      from: viewFrom,
      to: viewTo,
      enter: (node: SyntaxNodeRef) => {
        const name = node.name

        const headingClass = HEADING_CLASS[name]
        if (headingClass) {
          eachLine(node.from, node.to, (pos) => decos.push(line(headingClass).range(pos)))
          return
        }

        switch (name) {
          case 'HeaderMark': {
            // Only `#` reaches this: the underline of a Setext heading would be
            // one too, but that construct is off. src/ui/markdown-flavour.ts
            if (raw(node.from, node.to)) {
              decos.push(mark('cm-md-marker').range(node.from, node.to))
            } else {
              hideWithSpaces(node.from, node.to)
            }
            return
          }

          case 'Blockquote': {
            eachLine(node.from, node.to, (pos) => decos.push(line('cm-md-quote').range(pos)))
            return
          }

          case 'QuoteMark': {
            if (raw(node.from, node.to)) {
              decos.push(mark('cm-md-marker').range(node.from, node.to))
            } else {
              hideWithSpaces(node.from, node.to)
            }
            return
          }

          case 'FencedCode':
          case 'CodeBlock': {
            eachLine(node.from, node.to, (pos, index, last) => {
              decos.push(line('cm-md-code-block').range(pos))
              if (index === 0) decos.push(line('cm-md-code-first').range(pos))
              if (index === last) decos.push(line('cm-md-code-last').range(pos))
            })
            return
          }

          case 'CodeMark': {
            // The fence of a code block and the backticks of inline code are
            // the same node; both are markup and go away off the active line.
            if (!raw(node.from, node.to)) decos.push(hidden.range(node.from, node.to))
            return
          }

          case 'CodeInfo': {
            decos.push(CODE_INFO.range(node.from, node.to))
            return
          }

          case 'InlineCode': {
            decos.push(INLINE_CODE.range(node.from, node.to))
            return
          }

          case 'Emphasis': {
            decos.push(EM.range(node.from, node.to))
            return
          }

          case 'StrongEmphasis': {
            decos.push(STRONG.range(node.from, node.to))
            return
          }

          case 'Strikethrough': {
            decos.push(STRIKE.range(node.from, node.to))
            return
          }

          case 'EmphasisMark':
          case 'StrikethroughMark': {
            if (!raw(node.from, node.to)) decos.push(hidden.range(node.from, node.to))
            return
          }

          case 'ListItem': {
            // Only the line the item starts on. The lines below it belong
            // either to a nested item — which decorates itself — or to the
            // item's own continuation, which is left alone.
            const indent = `cm-md-item cm-md-depth-${Math.min(listDepth(node.node), 6)}`
            decos.push(line(indent).range(state.doc.lineAt(node.from).from))
            return
          }

          case 'ListMark': {
            const ordered = node.node.parent?.parent?.name === 'OrderedList'
            // A task item already has a marker — its checkbox — and `- ` and
            // `[ ]` are one thing, so the `- ` goes even on the active line.
            // See the TaskMarker case for why the box does not fall back.
            if (node.node.nextSibling?.name === 'Task') {
              decos.push(hidden.range(node.from, afterSpaces(node.to)))
              return
            }
            if (raw(node.from, node.to)) {
              decos.push(mark('cm-md-marker').range(node.from, node.to))
              return
            }
            // The spaces that nest the item are markup as well: the depth is
            // drawn by the line's padding, so leaving them would indent twice
            // — and by two spaces where the page indents by a full step. Only
            // whitespace: in a quoted list the `>` comes first on the line and
            // is the QuoteMark's to hide, not ours.
            const start = state.doc.lineAt(node.from).from
            if (start < node.from && /^[ \t]+$/.test(state.doc.sliceString(start, node.from))) {
              decos.push(hidden.range(start, node.from))
            }

            const end = afterSpaces(node.to)
            if (ordered) {
              // A number carries information — it is never replaced, only
              // toned down. Hiding the space behind it lets the CSS give it
              // the width of the gutter, the way `list-decimal` does.
              decos.push(LIST_NUMBER.range(node.from, node.to))
              if (end > node.to) decos.push(hidden.range(node.to, end))
              return
            }
            decos.push(
              Decoration.replace({ widget: new BulletWidget(listDepth(node.node)) }).range(
                node.from,
                end,
              ),
            )
            return
          }

          case 'TaskMarker': {
            // Like a mention chip, and unlike every other marker, this does not
            // fall back to raw text on the active line. `[ ]` is not something
            // anybody edits by hand — a box is ticked by clicking it — and a
            // checklist is written *on* the line it is being added to, so a box
            // that only appears once the cursor has left reads as "it did not
            // work". It is atomic instead: one Backspace takes the whole
            // marker, and the item falls back to an ordinary bullet.
            const checked = state.doc.sliceString(node.from, node.to).toLowerCase() === '[x]'
            const deco = Decoration.replace({ widget: new TaskWidget(checked) })
            decos.push(deco.range(node.from, node.to))
            atoms.push(deco.range(node.from, node.to))
            return
          }

          case 'HorizontalRule': {
            if (raw(node.from, node.to)) {
              decos.push(line('cm-md-hr-raw').range(state.doc.lineAt(node.from).from))
              return
            }
            decos.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to))
            return
          }

          case 'Image': {
            // The picture, never the Markdown — that is what the editor is for.
            // The two `hasAncestor(node, 'Image')` guards on LinkMark and URL
            // below become unreachable with it, but they stay: a decoration
            // added inside a replaced range is a second answer to a question
            // that already has one. src/ui/editor-image.ts
            const target = imageTarget(node.node, state.doc)
            if (!target) return
            const deco = Decoration.replace({
              widget: new ImageWidget(target.text, imageAlt(node.node, state.doc), target.from, target.to),
            })
            decos.push(deco.range(node.from, node.to))
            // One thing, like a mention chip: one Backspace removes the whole
            // construct, and the caret steps over it.
            atoms.push(deco.range(node.from, node.to))
            return
          }

          case 'Link': {
            if (hasTarget(node.node)) decos.push(LINK_TEXT.range(node.from, node.to))
            return
          }

          case 'LinkMark': {
            // An image is left as written: drawn as its alt text alone it
            // would look like a paragraph that lost its picture.
            if (hasAncestor(node.node, 'Image')) return
            // Brackets around nothing are not markup, they are two characters
            // the page prints. See hasTarget.
            if (!hasTarget(node.node.parent)) return
            if (!raw(node.from, node.to)) decos.push(hidden.range(node.from, node.to))
            return
          }

          case 'URL': {
            if (hasAncestor(node.node, 'Image')) return
            const parent = node.node.parent
            // Only the target of a `[text](url)` link is hidden. A bare or
            // <angled> URL *is* the text — hiding it would delete the link.
            const labelled =
              parent?.name === 'Link' && state.doc.sliceString(parent.from, parent.from + 1) === '['
            if (labelled && !raw(node.from, node.to)) decos.push(hidden.range(node.from, node.to))
            return
          }

          default:
            return
        }
      },
    })

    // Mentions are not a Markdown construct, so the syntax tree knows nothing
    // about them — they are found in the text and only skipped inside code.
    const text = state.doc.sliceString(viewFrom, viewTo)
    for (const span of findMentions(text)) {
      const from = viewFrom + span.from
      const to = viewFrom + span.to
      const node = tree.resolveInner(from, 1)
      if (
        NO_MENTION.has(node.name) ||
        hasAncestor(node, 'FencedCode') ||
        hasAncestor(node, 'CodeBlock')
      ) {
        continue
      }
      // Unlike every other marker a chip does not fall back to raw text on the
      // active line: a 63-character npub in the middle of a sentence is not
      // something anyone edits by hand. It is atomic instead, so one Backspace
      // removes the whole mention.
      const deco = Decoration.replace({ widget: new MentionWidget(span.pubkey) })
      decos.push(deco.range(from, to))
      atoms.push(deco.range(from, to))
    }
  }

  return { decorations: Decoration.set(decos, true), atomic: Decoration.set(atoms, true) }
}

class LivePreview {
  decorations: DecorationSet
  atomic: DecorationSet

  constructor(view: EditorView) {
    const built = build(view)
    this.decorations = built.decorations
    this.atomic = built.atomic
  }

  update(update: ViewUpdate) {
    // focusChanged matters because an unfocused editor reveals no markup at
    // all; a changed tree because the parser finishes lazily.
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.focusChanged ||
      syntaxTree(update.startState) !== syntaxTree(update.state)
    ) {
      const built = build(update.view)
      this.decorations = built.decorations
      this.atomic = built.atomic
    }
  }
}

/**
 * The block a line holds when it holds nothing else: an image on a line of its
 * own, or a table — which starts and ends at line boundaries by construction.
 */
function edgeBlock(state: EditorState, from: number, to: number): 'image' | 'table' | null {
  let found: 'image' | 'table' | null = null
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Image' && node.name !== 'Table') return
      if (node.from > from || node.to < to) return
      if (state.doc.sliceString(from, node.from).trim()) return
      if (state.doc.sliceString(node.to, to).trim()) return
      found = node.name === 'Image' ? 'image' : 'table'
    },
  })
  return found
}

/**
 * What to insert when text is typed at the very start or the very end of a line
 * that holds nothing but a block — or `null` when the line is an ordinary one.
 *
 * Writing at a table's edge used to append to the table's own last row, where a
 * character after the closing pipe becomes another column of that row alone.
 * Writing at an image's edge used to put text beside the picture. Both are
 * block-level things: the text belongs on a new line outside them.
 *
 * Under a *table* it needs a blank line, not just a new one: a plain line
 * directly beneath a row is another row to GFM, so the text would come back as a
 * cell of the table instead of as a paragraph. A picture has nothing to join.
 */
export function edgeInsert(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): { from: number; to: number; insert: string } | null {
  if (from !== to || text.length === 0) return null
  const line = state.doc.lineAt(from)
  if (from !== line.from && from !== line.to) return null
  const block = edgeBlock(state, line.from, line.to)
  if (!block) return null
  if (from === line.from) return { from, to, insert: text + '\n' }
  return { from, to, insert: (block === 'table' ? '\n\n' : '\n') + text }
}

/**
 * The editor's own typing, with those two edges kept out of the block. A cell
 * input is a DOM field inside a widget, so nothing typed in one comes through
 * here — this is the text cursor's path only.
 */
const blockEdges: Extension = EditorView.inputHandler.of((view, from, to, text) => {
  const change = edgeInsert(view.state, from, to, text)
  if (!change) return false
  view.dispatch({
    changes: change,
    // The typed text is at the end of what is inserted, whichever side it went.
    selection: EditorSelection.cursor(from + change.insert.length),
    scrollIntoView: true,
    userEvent: 'input.type',
  })
  return true
})

/**
 * The editor's live formatting, as one extension: the line-by-line decorations,
 * the tables (a state field — a plugin may not replace line breaks), the fact
 * that a table is one thing the caret walks over, and the block edges above.
 */
export const liveMarkdown: Extension = [
  tableState,
  tableAtomicRanges,
  blockEdges,
  ViewPlugin.fromClass(LivePreview, {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  }),
]

/**
 * The editor is built once, in a `useEffect` that does not depend on this
 * module, and it keeps the extensions it was built with. A hot update here
 * therefore replaces the module while the running editor goes on using the old
 * decorations — the change looks like it simply did not work, and no amount of
 * editing makes it land. So a change here asks for a reload instead of
 * pretending it arrived. Dev only: `import.meta.hot` is undefined in a build.
 * src/ui/MarkdownEditor.tsx, the `[ariaLabel]` effect
 */
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot?.invalidate())
}
