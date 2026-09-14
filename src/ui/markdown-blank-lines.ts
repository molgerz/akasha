/**
 * rehype plugin: draws the empty lines a writer left between two blocks.
 *
 * Markdown collapses them — `a`, three empty lines, `b` is the same document as
 * `a`, one empty line, `b`, and CommonMark has no way to say otherwise. But the
 * editor draws the source, so there the three lines are three lines, and a page
 * that swallows them does not look like what was written. So the gap is read
 * back off the positions the parser recorded and put in as height.
 *
 * The rule is one line: **every empty line the writer typed is a line, and is
 * drawn as one.** That includes the single empty line that separates two
 * paragraphs — the writer typed a line and the page shows a line, the same as
 * the editor. It used to be dropped in favour of the paragraph margin; that
 * margin was doing double duty and, worse, collapsed to half a line, so a
 * single empty line came out visibly shorter than the one in the editor. The
 * top-level blocks now carry no vertical margin of their own — see
 * `.md-content > *` in src/index.css — and the spacers are the whole of the
 * vertical rhythm between them.
 *
 * Before the first block there is nothing to separate, so every empty line
 * counts. After the last one they are dropped: trailing empty lines are where
 * the cursor was left, not something anybody typed on purpose.
 *
 * It runs *after* the sanitiser, on purpose. The spacer carries a `style` and
 * that is exactly the kind of attribute the schema strips — running afterwards
 * keeps the check on the content strict while this, which is ours and not the
 * author's, gets through. docs/13-editing.md
 *
 * Only the top level. A blockquote or a list item is a block of its own with
 * its own spacing, and an empty line inside one is not a paragraph break.
 */
type HastNode = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
  position?: { start: { line: number }; end: { line: number } }
}

function spacer(lines: number, blank: string): HastNode {
  return {
    type: 'element',
    tagName: 'div',
    // Empty and announced as nothing: it is space, not content.
    properties: { 'aria-hidden': 'true', style: `height:calc(${lines} * ${blank})` },
    children: [],
  }
}

export function rehypeBlankLines({ blank }: { blank: string }) {
  return (tree: HastNode) => {
    const out: HastNode[] = []
    /** the last line of the block before this one; 0 = the start of the text */
    let end = 0

    for (const child of tree.children ?? []) {
      // The `\n` between two blocks — it carries no position and says nothing
      // about the gap, which is read off the blocks themselves.
      if (child.type !== 'element' || !child.position) {
        out.push(child)
        continue
      }

      const empty = child.position.start.line - end - 1
      if (empty > 0) out.push(spacer(empty, blank))

      out.push(child)
      end = child.position.end.line
    }

    tree.children = out
  }
}

/**
 * Characters that take no visible width: the spaces a keyboard produces
 * (U+00A0 from Option-Space, the fixed-width ones) plus the zero-width ones.
 * `\s` in JavaScript is already Unicode-aware and covers U+00A0, U+202F,
 * U+3000, U+FEFF and the rest; the zero-width set is added by hand because it
 * is not whitespace to `\s`.
 */
const INVISIBLE_LINE = /^[\s\u200b-\u200d\u2060]+$/u

/**
 * Turns a line that is only invisible characters into an empty line.
 *
 * CommonMark does not count U+00A0 or the other non-ASCII spaces as blank: a
 * line holding one continues the paragraph, the line break collapses to a
 * space, and two visually separate paragraphs arrive as one that reads
 * `a b`. The editor draws an empty line there, so the two views disagree
 * about the same source — and nothing on screen says why, because the
 * character that caused it is invisible.
 *
 * A line that is only these characters is therefore made empty before the
 * parser sees it, the way `normaliseTaskMarker` fixes `- [<nbsp>]` in the
 * editor. Only a line that holds nothing else is touched: an NBSP inside a
 * sentence is real text and stays. An ASCII space or tab line is already blank
 * to CommonMark; it is normalised too, which changes nothing.
 */
export function normaliseInvisibleLines(source: string): string {
  return source
    .split('\n')
    .map((line) => (INVISIBLE_LINE.test(line) ? '' : line))
    .join('\n')
}
