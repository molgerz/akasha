import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { Fragment, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { ThemedToken } from 'shiki'
import { normalizeSlug } from '../nostr/kinds'
import { mentionPubkey } from '../nostr/mentions'
import { useProfile } from '../nostr/profile-store'
import { shortNpub, toNpub } from '../nostr/profile'
import { remarkMentions } from './markdown-mentions'
import { rehypeBlankLines } from './markdown-blank-lines'
import { remarkNoSetextHeadings } from './markdown-flavour'
import { imageWidth } from './image-width'

/**
 * Sanitising is mandatory, not optional: content comes from arbitrary keys.
 * The default schema is the GitHub one — no raw HTML, no scripts. One addition:
 * it drops `checked` from a checkbox, so every ticked task box would render as
 * unticked and the list would quietly lie about its own state.
 */
const SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    input: [...(defaultSchema.attributes?.input ?? []), 'checked'],
  },
  /**
   * `nostr:` joins the allowed URL schemes. A mention is a link to a key, and
   * the default list would strip the href — which is the only thing that says
   * *who* is being mentioned. Nothing is loaded from such a URL, so it opens
   * no request the page did not already make.
   */
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'nostr'],
  },
}

/**
 * react-markdown blanks every href whose scheme is not on its own short list,
 * and `nostr:` is not on it — the mention would arrive here with an empty
 * target and be drawn as a plain link showing all 63 characters of the npub.
 * Only a target that decodes to a key is let through; everything else keeps
 * react-markdown's own check.
 */
function keepMentionUrls(url: string): string {
  return mentionPubkey(url) ? url : defaultUrlTransform(url)
}

/**
 * Two densities, one renderer. A page is a reading surface and gets the size
 * and line length of a document; a comment sits inside somebody else's page and
 * has to stay subordinate to it, so it keeps the 14px of the surrounding UI.
 */
export type Density = 'page' | 'compact'

type Scale = {
  /** limits the line length — the content column is much wider than is readable */
  measure: string
  block: string
  h1: string
  h2: string
  h3: string
  h4: string
  h5: string
  list: string
  code: string
  quote: string
  /**
   * One empty line, as a length — an empty line the writer left in the source
   * is kept and has to be exactly as tall here as it is in the editor. The two
   * numbers are the `text-…` and the `leading-…` of `block` above.
   * src/ui/markdown-blank-lines.ts
   */
  blank: string
}

const PAGE: Scale = {
  measure: 'max-w-[70ch]',
  block: 'my-[0.9em] text-[17px] leading-[1.75] text-fg',
  h1: 'mt-10 mb-3 text-[26px] font-semibold tracking-[-0.02em] text-fg',
  h2: 'mt-9 mb-2.5 text-[21px] font-semibold tracking-[-0.015em] text-fg',
  h3: 'mt-7 mb-2 text-[18px] font-semibold text-fg',
  h4: 'mt-6 mb-1.5 text-[17px] font-semibold text-fg',
  h5: 'mt-5 mb-1 text-sm font-semibold uppercase tracking-wide text-fg-muted',
  list: 'my-[0.9em] space-y-1.5 pl-6 text-[17px] leading-[1.75] text-fg',
  code: 'text-sm',
  quote:
    'my-5 border-l-[3px] border-line-strong pl-4 text-[17px] leading-[1.75] text-fg-muted',
  blank: 'calc(17px * 1.75)',
}

const COMPACT: Scale = {
  measure: '',
  block: 'my-2 text-sm leading-relaxed text-fg',
  h1: 'mt-3 mb-1 text-base font-semibold text-fg',
  h2: 'mt-3 mb-1 text-sm font-semibold text-fg',
  h3: 'mt-2 mb-1 text-sm font-medium text-fg',
  h4: 'mt-2 mb-1 text-sm font-medium text-fg',
  h5: 'mt-2 mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted',
  list: 'my-2 space-y-1 pl-5 text-sm leading-relaxed text-fg',
  code: 'text-xs',
  quote: 'my-2 border-l-2 border-line-strong pl-3 text-sm text-fg-subtle',
  blank: 'calc(14px * 1.625)',
}

/**
 * An image, loaded directly.
 *
 * It used to be different: an image from a foreign host was only fetched once
 * the reader clicked it, because loading it tells that host who is reading
 * which page, and when. That is still true, and it is still the cost — the gate
 * was dropped because a page whose pictures are not there until every one of
 * them is clicked is not the page, and this is a wiki: the content *is* the
 * point. The trade is written down in docs/09-security-privacy.md.
 */
function MarkdownImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  if (!src) return null
  // The width a resize chose lives in the URL's fragment. Drawing it here is
  // the other half of that contract: what is made smaller in the editor is
  // smaller on the page. `max-w-full` still caps it on a narrow screen.
  // src/ui/image-width.ts
  const width = imageWidth(src)
  return (
    <img
      src={src}
      alt={alt ?? ''}
      title={title}
      loading="lazy"
      style={width === null ? undefined : { width: width + 'px' }}
      className="my-6 max-w-full rounded-lg border border-line"
    />
  )
}

/**
 * A code block, coloured once the grammar has arrived. It renders plain first
 * and swaps in the tokens afterwards — a block that appears instantly and gains
 * colour a moment later reads better than one that is not there yet. An unknown
 * language simply stays plain.
 */
function CodeBlock({
  code,
  language,
  className,
}: {
  code: string
  language: string
  className: string
}) {
  const [lines, setLines] = useState<ThemedToken[][] | null>(null)

  useEffect(() => {
    let cancelled = false
    setLines(null)
    // The highlighter is imported here rather than at the top of the file so
    // that Shiki's engine is a chunk of its own: a reader who never opens a
    // page with a code block never downloads it.
    void import('./code-highlight')
      .then(({ highlight }) => highlight(code, language))
      .then((result) => {
        if (!cancelled) setLines(result)
      })
      .catch(() => {
        /* stays plain */
      })
    return () => {
      cancelled = true
    }
  }, [code, language])

  if (!lines) return <code className={className}>{code}</code>

  return (
    <code className={className}>
      {lines.map((tokens, line) => (
        <Fragment key={line}>
          {tokens.map((token, index) => (
            <span key={index} className="shiki-token" style={token.htmlStyle as CSSProperties}>
              {token.content}
            </span>
          ))}
          {/* The newline stays real text — the surrounding `pre` preserves it,
              so no per-line block element is needed and empty lines keep their
              height. */}
          {line < lines.length - 1 ? '\n' : null}
        </Fragment>
      ))}
    </code>
  )
}

/**
 * Anchor id from the heading text — the same derivation as in
 * `extractHeadings`, so the table of contents links line up.
 */
function headingId(children: ReactNode): string | undefined {
  const text = String(children ?? '').replace(/[*_`]/g, '')
  const id = normalizeSlug(text)
  return id.length > 0 ? id : undefined
}

/**
 * Merges our classes with any the source brought along. Order matters: spreading
 * the incoming props over a `className` would silently drop our styling
 * wherever remark adds a class of its own — `contains-task-list` on a list,
 * `language-js` on a code block.
 */
function cx(...parts: (string | undefined | null | false)[]): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * A mention: the name, with the key behind it.
 *
 * The stored text is the npub — a name is freely chosen and can change, so it
 * is only ever the label. That the UI shows a display name without the npub
 * beside it is deliberate here and nowhere else: a mention sits inside a
 * sentence, where `npub1abcd…wxyz` would be unreadable. The key stays one
 * hover away, and the chip's shape says it stands for a person.
 * docs/06-ui-information-architecture.md, docs/13-editing.md
 */
function Mention({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey)
  const npub = toNpub(pubkey)
  const name = profile?.displayName ?? profile?.name

  return (
    <span
      title={npub}
      className="rounded bg-accent-bg px-1 py-0.5 text-[0.95em] whitespace-nowrap text-accent-fg"
    >
      @{name ?? shortNpub(npub)}
    </span>
  )
}

/**
 * A list marker is a marker, not text: it is toned down so the words stay the
 * loudest thing on the line. `.cm-md-bullet` in `src/ui/MarkdownEditor.tsx`
 * says the same in the editor.
 */
const MARKER = 'marker:text-fg-subtle'

/** A list nested in a list carries the indent, not a block margin of its own. */
const NESTED_LIST = '[&_ul]:my-0 [&_ol]:my-0'

/** Renders Markdown written by arbitrary npubs. */
export function Markdown({
  children,
  density = 'page',
}: {
  children: string
  density?: Density
}) {
  const s = density === 'page' ? PAGE : COMPACT
  const text = `${s.block} ${s.measure}`.trim()
  const heading = (level: string) => `${level} ${s.measure}`.trim()

  return (
    // The first block must not push the whole text down by its own top margin.
    <div className="[&>*:first-child]:mt-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMentions, remarkNoSetextHeadings]}
        // The order is the point: everything the author wrote is sanitised
        // first, and only then is our own spacing put in.
        rehypePlugins={[
          [rehypeSanitize, SCHEMA],
          [rehypeBlankLines, { blank: s.blank }],
        ]}
        urlTransform={keepMentionUrls}
        components={{
          h1: ({ node: _node, children, className, ...props }) => (
            <h1 id={headingId(children)} className={cx(heading(s.h1), className)} {...props}>
              {children}
            </h1>
          ),
          h2: ({ node: _node, children, className, ...props }) => (
            <h2 id={headingId(children)} className={cx(heading(s.h2), className)} {...props}>
              {children}
            </h2>
          ),
          h3: ({ node: _node, children, className, ...props }) => (
            <h3 id={headingId(children)} className={cx(heading(s.h3), className)} {...props}>
              {children}
            </h3>
          ),
          h4: ({ node: _node, children, className, ...props }) => (
            <h4 id={headingId(children)} className={cx(heading(s.h4), className)} {...props}>
              {children}
            </h4>
          ),
          h5: ({ node: _node, children, className, ...props }) => (
            <h5 id={headingId(children)} className={cx(heading(s.h5), className)} {...props}>
              {children}
            </h5>
          ),
          h6: ({ node: _node, children, className, ...props }) => (
            <h6 id={headingId(children)} className={cx(heading(s.h5), className)} {...props}>
              {children}
            </h6>
          ),
          p: ({ node: _node, className, ...props }) => <p className={cx(text, className)} {...props} />,
          strong: ({ node: _node, className, ...props }) => (
            <strong className={cx('font-semibold text-fg', className)} {...props} />
          ),
          del: ({ node: _node, className, ...props }) => (
            <del className={cx('text-fg-subtle', className)} {...props} />
          ),
          hr: () => <hr className={`my-10 border-0 border-t border-line ${s.measure}`} />,
          // Bullet shape by level, the way the editor draws it — a nested
          // list that repeats the same dot only says "indented", not "below".
          // A nested list also drops the block margin: inside a tight list it
          // would open a gap the source does not ask for.
          ul: ({ node: _node, className, ...props }) => (
            <ul
              className={cx(
                'list-disc [&_ul]:list-[circle] [&_ul_ul]:list-[square]',
                NESTED_LIST,
                MARKER,
                s.list,
                s.measure,
                className,
              )}
              {...props}
            />
          ),
          ol: ({ node: _node, className, ...props }) => (
            <ol
              className={cx('list-decimal', NESTED_LIST, MARKER, s.list, s.measure, className)}
              {...props}
            />
          ),
          li: ({ node: _node, children, className, ...props }) => {
            // A GFM task item carries its own checkbox, so the bullet would be
            // a second marker. Pulling it left puts the box where the bullet
            // would have been, so both kinds of item line up.
            const task = typeof className === 'string' && className.includes('task-list-item')
            return (
              <li className={cx(task && '-ml-6 list-none', className)} {...props}>
                {children}
              </li>
            )
          },
          input: ({ node: _node, ...props }) => (
            <input {...props} readOnly className="mr-2 size-3.5 translate-y-px accent-accent" />
          ),
          a: ({ node: _node, className, href, children, ...props }) => {
            // A `nostr:` target is a person, not a place: it is drawn as a
            // mention chip. Both the ones the editor wrote and any typed by
            // hand end up here.
            const pubkey = typeof href === 'string' ? mentionPubkey(href) : null
            if (pubkey) return <Mention pubkey={pubkey} />
            return (
              <a
                href={href}
                className={cx('text-accent-fg underline underline-offset-2', className)}
                rel="noreferrer noopener"
                {...props}
              >
                {children}
              </a>
            )
          },
          code: ({ node: _node, className, children, ...props }) => {
            const style = cx('rounded bg-code-bg px-1 py-0.5 font-mono', s.code, className)
            // `language-…` on a fenced block is what tells us which grammar to
            // load. Without it — and for inline code — nothing is highlighted.
            const language = /(?:^|\s)language-([\w+#.-]+)/.exec(className ?? '')?.[1]
            if (!language) {
              return (
                <code className={style} {...props}>
                  {children}
                </code>
              )
            }
            return (
              <CodeBlock
                code={String(children).replace(/\n$/, '')}
                language={language}
                className={style}
              />
            )
          },
          // A code block already has the background of the `pre`; without this
          // the inner `code` would paint a second one on top of it.
          pre: ({ node: _node, className, ...props }) => (
            <pre
              className={cx(
                'my-6 overflow-x-auto rounded-lg border border-code-line bg-code-bg p-4 font-mono leading-relaxed',
                s.code,
                '[&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit',
                className,
              )}
              {...props}
            />
          ),
          blockquote: ({ node: _node, className, ...props }) => (
            <blockquote className={cx(s.quote, s.measure, className)} {...props} />
          ),
          img: ({ src, alt, title }) => (
            <MarkdownImage src={typeof src === 'string' ? src : undefined} alt={alt} title={title} />
          ),
          // A wide table may exceed the measure — but then it scrolls on its
          // own instead of stretching the page. `page-table` is what gives an
          // empty cell the line box it otherwise has not — src/index.css.
          table: ({ node: _node, className, ...props }) => (
            <div className="my-6 overflow-x-auto rounded-lg border border-line">
              <table
                className={cx('page-table w-full border-collapse text-sm', className)}
                {...props}
              />
            </div>
          ),
          // A rule under every row and between every column — the same grid the
          // editor draws. The last column has none, so the card's own border is
          // not doubled. src/ui/MarkdownEditor.tsx
          th: ({ node: _node, className, ...props }) => (
            <th
              className={cx(
                'border-b border-r border-line bg-surface-1 px-3 py-2 text-left font-semibold text-fg last:border-r-0',
                className,
              )}
              {...props}
            />
          ),
          td: ({ node: _node, className, ...props }) => (
            <td
              className={cx(
                'border-b border-r border-line px-3 py-2 text-fg-muted last:border-r-0',
                className,
              )}
              {...props}
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
