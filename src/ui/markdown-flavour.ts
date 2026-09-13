import type { Processor } from 'unified'
// pulls in remark-parse's declaration of `micromarkExtensions` on `Data`
import type {} from 'remark-parse'

/**
 * The places where the Markdown this app reads and writes differs from
 * CommonMark — and, where there is a parser to tell on both sides, it says so
 * to *both* of them, the editor's and the page's, so the two cannot drift apart
 * on it.
 *
 * ## No Setext headings
 *
 * CommonMark has two ways to write a heading. `# Title` — and `Title` with a
 * line of `-` or `=` under it, which is a Setext heading. The second one is a
 * trap in an editor that formats while you type:
 *
 * ```
 * Shopping        ← the moment the `-` below is typed, this becomes an H2
 * -
 * ```
 *
 * A `-` on the line under a paragraph is, far more often than not, the first
 * keystroke of `- milk`. And `---` under a paragraph is somebody drawing a
 * divider. Neither of them means "make the line above a heading", but that is
 * what CommonMark says — so the paragraph jumps to heading size on one
 * keystroke and back on the next, and a divider drawn under a line of text
 * silently turns that line into a heading instead.
 *
 * Drawing it differently cannot fix it: whatever the editor shows, the page
 * would still render the H2, and the two views drifting apart is the one thing
 * this editor exists to prevent. So the construct goes, in both. `- ` then
 * makes a list, `---` makes a divider — which is what was meant — and `# `,
 * the one the `Formatting` fold offers, still makes a heading.
 *
 * **The cost, stated plainly:** this is a deviation. The text stored is
 * untouched and still plain Markdown, but a document written elsewhere with a
 * Setext heading in it reads here as a paragraph followed by a divider, while
 * another Nostr client would show a heading. That is the trade: a construct
 * nobody types on purpose here, against a trap everybody falls into.
 *
 * **It is not the reason task lists once broke.** It was suspected of that and
 * taken out again; the causes turned out to be a no-break space in the task
 * marker, brackets being hidden as link markup, and hot updates never reaching
 * the running editor. `markdown-flavour.test.ts` pins GFM down against this.
 * docs/13-editing.md
 *
 * ## A newline is a line break
 *
 * CommonMark joins the lines of a paragraph into one sentence, with a space
 * where the newline was: `Hallo` and `Test` on two lines read `Hallo Test`.
 * The editor draws the source, so there the newline is a line — the same text
 * reads differently in the two views, which is the disagreement the empty lines
 * had one line down. In a wiki the writer presses Enter to start a new line and
 * means it.
 *
 * So a soft break becomes a `break` node, the node a hard break already uses:
 * the page draws a `<br>` and the views agree. This one only reaches the page
 * parser — the editor already draws every newline as a line, so there is
 * nothing to tell it. The stored text stays plain Markdown; a client that keeps
 * CommonMark's soft break reads the same two lines as one sentence. That is the
 * cost, and it is small next to a page that reads differently from the editor
 * it was written in. docs/13-editing.md
 */

/**
 * For `@codemirror/lang-markdown` — pass as `extensions` so the editor's parser
 * never produces a `SetextHeading` node.
 */
export const NO_SETEXT_HEADINGS = { remove: ['SetextHeading'] }

/** the disable list micromark reads — `null` means "in every context" */
const OFF = { disable: { null: ['setextUnderline'] } }

/**
 * The same for the rendered page: a remark plugin that turns the underline off
 * in micromark, the parser underneath `remark-parse`. It reaches the parser
 * through the processor's data rather than through the syntax tree — there is
 * no tree to change here, the construct is never parsed in the first place.
 */
export function remarkNoSetextHeadings(this: Processor) {
  const data = this.data()
  data.micromarkExtensions = [...(data.micromarkExtensions ?? []), OFF]
}

/** mdast only as far as this plugin touches it — a local shape, like the
 * rehype plugin's, so the transform does not drag a tree type in. */
type MdastNode = {
  type: string
  value?: string
  children?: MdastNode[]
}

/**
 * Splits every text node on its newlines, putting a `break` between the parts.
 * A soft break is the only thing a text node's `\n` can be: hard breaks are
 * already `break` nodes and inline code keeps its text in `value`, not in
 * children, so neither is reached. Recursive, so a newline inside a link, a
 * quote, a list item or emphasis is a line too.
 */
function splitSoftBreaks(node: MdastNode): void {
  if (!node.children) return
  const out: MdastNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && child.value?.includes('\n')) {
      child.value.split('\n').forEach((part, index) => {
        if (index > 0) out.push({ type: 'break' })
        if (part.length > 0) out.push({ type: 'text', value: part })
      })
      continue
    }
    splitSoftBreaks(child)
    out.push(child)
  }
  node.children = out
}

/**
 * For the rendered page. Unlike `remarkNoSetextHeadings` this is a transform,
 * not a parser extension: the newline is parsed fine, it is only read as a
 * space on the way out. See "A newline is a line break" above.
 */
export function remarkLineBreaks() {
  return (tree: MdastNode) => {
    splitSoftBreaks(tree)
  }
}
