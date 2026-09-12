/**
 * What can be typed, for whoever does not already know — the content of the
 * `Formatting` fold under the editor (`src/ui/PageEditor.tsx`).
 *
 * It is its own module so it can be tested. Every line here has to be something
 * that actually works when it is typed: the fold is read at the moment somebody
 * is asking "why did that not do anything", so an entry that is almost right —
 * `- []`, which gives a bullet followed by a literal `[]` — costs more than no
 * entry would. `formatting-help.test.ts` types each one into a real editor and
 * checks it draws what it claims. docs/13-editing.md
 */
export type FormattingRule = {
  /** what to type, exactly — trailing spaces included, they are part of it */
  syntax: string
  meaning: string
}

export const FORMATTING_RULES: FormattingRule[] = [
  { syntax: '# ', meaning: 'Heading — ## and ### go smaller' },
  { syntax: '- ', meaning: 'Bullet list' },
  { syntax: '1. ', meaning: 'Numbered list' },
  { syntax: '- [ ] ', meaning: 'Checkbox — the space inside the brackets is part of it' },
  { syntax: '**text**', meaning: 'Bold, ⌘B' },
  { syntax: '*text*', meaning: 'Italic, ⌘I' },
  { syntax: '~~text~~', meaning: 'Struck through, ⌘⇧X' },
  { syntax: '`code`', meaning: 'Code, ⌘E' },
  { syntax: '[text](url)', meaning: 'Link' },
  { syntax: '> ', meaning: 'Quote' },
  { syntax: '```', meaning: 'Code block' },
  // It really is that simple: a line of dashes under a paragraph used to be a
  // Setext heading for that paragraph instead. src/ui/markdown-flavour.ts
  { syntax: '---', meaning: 'Divider — on a line of its own' },
  { syntax: '@', meaning: 'Mention somebody' },
  // A lone colon opens nothing — it is punctuation far more often than it is
  // the start of an emoji. src/ui/editor-complete.ts
  { syntax: ':smile', meaning: 'Emoji — the list opens from the first letter' },
  // The one affordance in this list rather than a piece of Markdown, but the
  // fold is read precisely by somebody asking "how do I get a table?" —
  // src/ui/editor-slash.ts
  { syntax: '/', meaning: 'Insert menu — table, image/attachment, code block, quote or divider' },
]
