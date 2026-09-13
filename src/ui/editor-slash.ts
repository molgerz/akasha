import { closeCompletion, ifNotIn } from '@codemirror/autocomplete'
import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete'
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { SyncSource } from './editor-complete'

/**
 * The `/` insert menu — the editor's third dropdown, after `@` for people and
 * `:` for emoji (`src/ui/editor-complete.ts`).
 *
 * A wiki usually opens a menu of blocks at the start of a line. Here it inserts
 * the one piece of Markdown that is genuinely hard to type by hand — a pipe
 * table — and the blocks that frame a page, and it is the way back for the
 * Blossom upload: since the editor was stripped to title + Markdown
 * (docs/10-roadmap.md, phase 6) attaching a file had no affordance left.
 * docs/13-editing.md
 *
 * It reuses CodeMirror's autocompletion rather than growing a second popup, so
 * keyboard navigation and the `.cm-tooltip-autocomplete` theme in
 * `MarkdownEditor.tsx` come for free and all three dropdowns are one mechanism.
 */
export type SlashCommand = {
  /** what is typed and matched against the query: `/table`, `/image`, … */
  label: string
  displayLabel: string
  detail: string
  /** other words the query may match — `/img` finds the attachment entry */
  aliases?: string[]
  /** the block written into the document; empty for the attachment entry */
  insert: string
  /** where the cursor lands, as an offset into `insert` */
  cursor: number
  /** how much placeholder text at `cursor` is selected, so typing replaces it */
  select?: number
  /** runs instead of inserting text — the attachment opens the file picker */
  attach?: boolean
  /**
   * needs a blank line above it when the line before is not blank. Only `---`
   * does: under a paragraph it is a Setext heading to every client that does not
   * turn that off the way this app does. A table, a fence and a quote all take a
   * paragraph in their stride — checked against GFM's reference parser, which is
   * what the page renders with. src/ui/editor-slash.ts, docs/13-editing.md
   */
  blankBefore?: boolean
  /**
   * needs a blank line *below* it when something follows: a plain line directly
   * under a table row is another row to GFM's parser, so the writer's paragraph
   * would come back as a cell of the table — the table's widget would draw it as
   * one, and the paragraph would be gone. Only the table does this.
   */
  blankAfter?: boolean
}

/**
 * The 3×2 skeleton the table entry writes: a header, the separator and two
 * empty rows. Two, not one, because one row is a table you immediately have to
 * extend — the skeleton is there to be typed *into*. Exported so the table-help
 * work (the ticket's blocker) reuses the one shape instead of copying it.
 *
 * No blank line above it: the `/` stands at the start of its line, so the table
 * already has one of its own, and a table under a paragraph is a table to GFM's
 * own reference parser — which is what the page renders with and what every
 * other client follows. An unconditional leading newline only pushed the table
 * down and left blank lines behind it.
 */
export const TABLE_SKELETON = '| Column | Value |\n| --- | --- |\n|  |  |\n|  |  |'

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    label: 'table',
    displayLabel: 'Table',
    detail: '3×2 with a header row',
    insert: TABLE_SKELETON,
    cursor: TABLE_SKELETON.indexOf('Column'),
    select: 'Column'.length,
    blankAfter: true,
  },
  {
    label: 'image',
    displayLabel: 'Image / attachment',
    detail: 'Upload a file to Blossom',
    aliases: ['img', 'file', 'attachment', 'picture'],
    insert: '',
    cursor: 0,
    attach: true,
  },
  {
    label: 'code',
    displayLabel: 'Code block',
    detail: 'Fenced, with a language line',
    aliases: ['codeblock', 'fence'],
    insert: '```\n\n```\n',
    // the empty info string after the opening fence, ready for a language
    cursor: 3,
  },
  {
    label: 'quote',
    displayLabel: 'Quote',
    detail: 'A blockquote',
    aliases: ['blockquote'],
    insert: '> ',
    cursor: 2,
  },
  {
    label: 'divider',
    displayLabel: 'Divider',
    detail: 'A horizontal rule',
    aliases: ['rule', 'hr'],
    insert: '---\n',
    cursor: 3,
    // `text` over `---` is a Setext heading everywhere Setext is not turned
    // off, so this one does need the blank line to break the paragraph above.
    blankBefore: true,
  },
]

/**
 * What a picked entry does to the document.
 *
 * The completion is applied by a function, never by the default string form:
 * the default replaces the typed range with the entry's **label**, so a
 * forgotten function would leave the word `table` in the page and nothing else.
 * A function also has to dispatch its own transaction — CodeMirror's built-in
 * path (which annotates the change as a picked completion) is skipped.
 */
function applyCommand(
  view: EditorView,
  command: SlashCommand,
  from: number,
  to: number,
  onAttach?: () => void,
): void {
  if (command.attach) {
    // Remove the typed query and insert nothing: the upload lands at the
    // cursor later, when there really is a URL to write. Leaving the '/image'
    // behind would put a stray word in the page.
    view.dispatch({
      changes: { from, to, insert: '' },
      selection: EditorSelection.cursor(from),
      userEvent: 'input.complete',
    })
    closeCompletion(view)
    onAttach?.()
    return
  }

  // The command stands at the start of its line, so the block already has a
  // line of its own — see `blankBefore` for the one entry that needs more.
  const line = view.state.doc.lineAt(from)
  const above = line.number > 1 ? view.state.doc.line(line.number - 1).text : ''
  const lead = command.blankBefore && above.trim().length > 0 ? '\n' : ''

  // What stands after the block once it is written. See `blankAfter`: a table
  // takes the line under it, so whatever follows has to be separated from it by
  // a blank line — and how many newlines that takes depends on where the text
  // sits relative to the typed query.
  //
  // The blank line is not optional even when nothing follows the table. Without
  // it the table is the last line of the document, and then there is nothing
  // under the grid to click or write into at all: the writer sees the empty
  // space the editor leaves at the bottom of the page, puts a cursor in it and
  // cannot type. So the table always gets its blank line, and the line under
  // that one is where the next paragraph goes.
  const rest = view.state.doc.sliceString(to)
  let tail = ''
  if (command.blankAfter) {
    if (rest.length === 0) {
      // Nothing follows at all: the blank line and the line to write on.
      tail = '\n\n'
    } else if (rest.startsWith('\n')) {
      // The query stood at the end of its line: the first line of `rest` is
      // empty, and the text under it needs one more newline before it — as does
      // a document that stops right there, so that a line is left to write on.
      if (rest.length === 1 || rest.slice(1).split('\n')[0].trim().length > 0) tail = '\n'
    } else {
      // Text follows on the same line as the query. It needs a line of its own
      // *and* the blank line, or it becomes the table's last row.
      tail = '\n\n'
    }
  }

  const insert = lead + command.insert + tail

  view.dispatch({
    changes: { from, to, insert },
    selection: command.select
      ? EditorSelection.range(
          from + lead.length + command.cursor,
          from + lead.length + command.cursor + command.select,
        )
      : EditorSelection.cursor(from + lead.length + command.cursor),
    scrollIntoView: true,
    userEvent: 'input.complete',
  })
  closeCompletion(view)
}

/** A slash inside code or a URL is text, not a command. */
const BLOCK_NODES = ['InlineCode', 'FencedCode', 'CodeBlock', 'URL'] as const

/**
 * The `/` source. `onAttach` is injected rather than imported: the editor stays
 * presentational, and the signer and the Blossom server stay in `PageEditor`,
 * where the session already lives.
 *
 * The query is filtered here (like `mentionCompletion`) and the result is
 * returned with `filter: false`, so `/ta` narrows to the table and does not
 * leave CodeMirror to match it again.
 */
export function slashInsertCompletion(onAttach?: () => void): CompletionSource {
  const source: SyncSource = (context: CompletionContext): CompletionResult | null => {
    const before = context.matchBefore(/\/[a-z0-9_-]*$/i)
    if (!before) return null

    // `matchBefore` only looks at the tail of the current line, so the regex
    // above would also match the slash in `see /ta` or `https://`. The menu
    // belongs at the start of a line, so the match has to begin where the line
    // does. This is checked rather than written as `^\/…` in the regex on
    // purpose: `matchBefore` caps its window at 250 characters, so a `^`
    // anchor would silently stop working on long lines.
    if (before.from !== context.state.doc.lineAt(context.pos).from) return null

    const query = before.text.slice(1).toLowerCase()
    // Prefix matching, not substring: `/ta` has to mean Table, and a substring
    // test would also drag in the attachment entry (alias `attachment`).
    const commands = SLASH_COMMANDS.filter(
      (command) =>
        query.length === 0 ||
        command.label.startsWith(query) ||
        command.aliases?.some((alias) => alias.startsWith(query)),
    )
    if (commands.length === 0) return null

    const options: Completion[] = commands.map((command) => ({
      label: command.label,
      displayLabel: command.displayLabel,
      detail: command.detail,
      type: 'text',
      apply: (view, _completion, from, to) => applyCommand(view, command, from, to, onAttach),
    }))

    return { from: before.from, to: before.to, options, filter: false }
  }

  return ifNotIn(BLOCK_NODES, source)
}
