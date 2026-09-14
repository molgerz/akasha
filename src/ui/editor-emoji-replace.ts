import { closeCompletion } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection } from '@codemirror/state'
import type { EditorState, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { EMOJI } from './emoji'

/**
 * `:smile:` typed out in full, turned into 😄 by the closing colon.
 *
 * Until now only the `:` dropdown converted a shortcode (`src/ui/editor-complete.ts`);
 * somebody who knows the name and types it through — or pastes a line from a
 * chat log and retypes the last colon — kept the shortcode in the text, and
 * the page then showed `:smile:` where every other client shows the emoji.
 *
 * docs/13 listed this as open with the reason to be careful spelled out: it
 * "risks firing inside things like `a:b:c`". Three guards answer that, and
 * they are the whole substance of this file:
 *
 * 1. **The opening colon must sit on a word boundary** — start of line, or
 *    after whitespace or an opening bracket. That is the same rule the `:`
 *    dropdown already uses, and it is what keeps `a:b:c`, `12:30:45` and
 *    `https://host:8080/x:y:` as they were: in each of them the colon that
 *    would open a shortcode has a word character in front of it.
 * 2. **The name must be a shortcode we actually know.** An unknown `:foo:`
 *    stays text. A curated list is a small vocabulary, which here is a feature:
 *    the narrower it is, the less prose it can reach into.
 * 3. **Never inside code.** A shortcode in a code sample is a string literal,
 *    a Ruby symbol or a YAML key, and replacing it would corrupt a code block
 *    rather than decorate it.
 */

/** Written once, looked up on every keystroke. */
const BY_NAME = new Map(EMOJI.map((emoji) => [emoji.name, emoji.char]))

/**
 * A shortcode in a code sample is text somebody meant literally. The same set
 * as `editor-slash.ts`, minus `URL`: a colon inside a link target never has a
 * boundary in front of it anyway, so the guard above already covers it.
 *
 * The limit worth knowing: an inline code span the writer is still typing has
 * no closing backtick yet, so the parser does not see a span at all and the
 * replacement does fire inside it. Closed code — which is all code that has
 * been written, pasted or reopened — is what this catches.
 */
const CODE_NODES = new Set(['InlineCode', 'CodeText', 'FencedCode', 'CodeBlock', 'HTMLBlock'])

function inCode(state: EditorState, pos: number): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent
  ) {
    if (CODE_NODES.has(node.name)) return true
  }
  return false
}

/**
 * The replacement a closing `:` typed at `from` should make, or `null` for the
 * overwhelmingly common case where the colon is just a colon.
 *
 * Split out from the extension so the guards can be read — and tested — as
 * plain text in, decision out.
 */
export function emojiReplacement(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): { from: number; to: number; insert: string } | null {
  // Only the plain typed colon. A pasted block and a replaced selection are
  // both somebody moving text around, not writing a shortcode.
  if (text !== ':' || from !== to) return null

  const line = state.doc.lineAt(from)
  // A shortcode is at most a couple of dozen characters. Looking back further
  // would only cost time on a long line, and the boundary below is checked
  // against the document rather than against the start of this window, so the
  // cap cannot invent a boundary that is not there.
  const before = state.sliceDoc(Math.max(line.from, from - 64), from)
  const match = /:([a-z0-9_+-]+)$/i.exec(before)
  if (!match) return null

  const open = from - match[0].length
  if (open > line.from && !/[\s([{]/.test(state.sliceDoc(open - 1, open))) return null

  const char = BY_NAME.get(match[1]!.toLowerCase())
  if (char === undefined) return null
  if (inCode(state, open)) return null

  return { from: open, to: from, insert: char }
}

/**
 * The rule, wired to the text cursor. Registered as an `inputHandler` rather
 * than as a transaction filter so the typed colon never reaches the document
 * at all: the shortcode becomes the emoji in one change, which is also one
 * step for undo — Ctrl+Z brings the whole `:smile:` back, not a colon.
 */
export const emojiOnTyping: Extension = EditorView.inputHandler.of((view, from, to, text) => {
  const change = emojiReplacement(view.state, from, to, text)
  if (!change) return false

  view.dispatch({
    changes: change,
    selection: EditorSelection.cursor(change.from + change.insert.length),
    scrollIntoView: true,
    userEvent: 'input.type',
  })
  // The `:` dropdown is open on the shortcode that just stopped existing.
  closeCompletion(view)
  return true
})
