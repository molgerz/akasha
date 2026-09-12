import { Fragment, useEffect, useRef, useState } from 'react'
import { classifyRejection } from '../nostr/client'
import { normalizeSlug } from '../nostr/kinds'
import { publishRevision } from '../nostr/publish-page'
import { publishPlacement } from '../nostr/publish-placement'
import { useSession } from '../session/session'
import { MarkdownEditor } from './MarkdownEditor'
import type { EditorHandle } from './MarkdownEditor'
import {
  NO_BLOSSOM_SERVER,
  attachmentMarkdown,
  attachmentsEnabled,
  uploadAttachment,
} from '../nostr/blossom'
import { hasConflictMarkers, mergeThreeWay } from '../domain/merge'
import { shortNpub, toNpub } from '../nostr/profile'
import { SignInButton } from './SignInButton'
import { Button, Callout } from './controls'
import { HeaderActions } from './layout/PageFrame'
import { ChevronDownIcon, ChevronRightIcon } from './icons'
import { FORMATTING_RULES } from './formatting-help'
import type { Page } from '../domain/pages'
import type { Revision } from '../domain/revision'

type Props = {
  relayUrl: string
  groupId: string
  /** an existing page = editing; without it = a new page */
  page?: Page
  /** parent page for a new subpage */
  defaultParentSlug?: string | null
  /** existing pages of the space, for slug collisions */
  pages: Page[]
  /** members of the space — the people the `@` dropdown offers */
  members?: string[]
  /** pre-filled content, e.g. the result of a merge */
  initialContent?: string
  /** note above the editor, e.g. "merged two versions" */
  initialNotice?: string
  /** override the predecessor revisions (merging several leaves) */
  overrideParents?: string[]
  onSaved: (slug: string) => void
  onCancel: () => void
}

/**
 * What can be typed, for whoever does not already know.
 *
 * Folded away, because the editor's whole point is that you do not need it:
 * the formatting appears as you type. It is here for the second question —
 * "how do I get a quote?" — and not as a toolbar, which would put the
 * technical vocabulary back on screen permanently.
 *
 * It is the same row as "Write a comment" under a page — rule, the same gap
 * below it, the same muted 14px line with an icon in front — because it plays
 * the same part: the one quiet thing at the foot of the column that opens when
 * asked. The arrow is the sidebar's, so a fold is a fold everywhere in the app.
 * docs/06-ui-information-architecture.md, docs/13-editing.md
 */
function FormattingHelp() {
  const [open, setOpen] = useState(false)
  const block = useRef<HTMLDivElement | null>(null)

  // Opening the fold has to reveal what it opened, and at the foot of a long
  // page it does not on its own: the content lands below the viewport and
  // nothing scrolls, because the editor above can only give room back while
  // the text is shorter than the column. So the block brings itself into view.
  //
  // `nearest` rather than `end`: it scrolls the least it can, so a fold that
  // was already fully visible — the short-page case, where the editor does
  // shrink — stays put instead of jumping. `scroll-mb-10` below matches the
  // frame's bottom padding, so the last row does not end up flush with the
  // edge.
  useEffect(() => {
    if (open) block.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [open])

  return (
    // mt-2 tops the column's gap-5 up to the 28px the comment block puts above
    // its own rule, so both rows sit at the same height.
    <div
      ref={block}
      className="mt-2 max-w-[70ch] shrink-0 scroll-mb-10 border-t border-line pt-7"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="formatting-help"
        className="flex items-center gap-2 text-sm text-fg-muted hover:text-fg"
      >
        {open ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
        Formatting
      </button>
      {open ? (
        <dl
          id="formatting-help"
          className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs sm:grid-cols-[auto_1fr_auto_1fr]"
        >
          {FORMATTING_RULES.map(({ syntax, meaning }) => (
            <Fragment key={syntax}>
              <dt className="rounded bg-code-bg px-1.5 py-0.5 font-mono whitespace-nowrap text-fg">
                {syntax}
              </dt>
              <dd className="text-fg-muted">{meaning}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

export function PageEditor({
  relayUrl,
  groupId,
  page,
  defaultParentSlug = null,
  pages,
  members,
  initialContent,
  initialNotice,
  overrideParents,
  onSaved,
  onCancel,
}: Props) {
  const { session, ensureSamePubkey } = useSession()
  const [title, setTitle] = useState(page?.title ?? '')
  const [content, setContent] = useState(initialContent ?? page?.head.content ?? '')
  // The version this editor was opened on. If the head of the chain moves in
  // the meantime, we merge instead of overwriting.
  const [baseRevision, setBaseRevision] = useState<Revision | null>(page?.head ?? null)
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null)
  // The parent is fixed for the life of this editor session — filing a page
  // elsewhere is a separate action, not a field in here.
  const [parentSlug] = useState(page?.parentSlug ?? defaultParentSlug ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editorHandle = useRef<EditorHandle | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadNote, setUploadNote] = useState<string | null>(null)

  if (session.status !== 'signed-in') {
    return (
      <div className="space-y-4 rounded-lg border border-dashed border-line-strong p-6">
        <p className="max-w-[56ch] text-sm text-fg-muted">
          Editing requires signing in, reading does not. The revision is signed with your key,
          so it cannot be done anonymously.
        </p>
        <SignInButton>Sign in with Nostr</SignInButton>
      </div>
    )
  }

  const slug = page?.slug ?? normalizeSlug(title)
  const existing = page ?? (slug.length > 0 ? pages.find((entry) => entry.slug === slug) : undefined)
  const collision = !page && existing !== undefined

  /**
   * Upload an attachment and insert it at the cursor. Images as ![…](url),
   * everything else as a link — the file then lives on the Blossom server and
   * the Nostr event only carries the URL.
   */
  const upload = async (files: File[]) => {
    if (session.status !== 'signed-in' || files.length === 0) return
    setUploadNote(null)
    setUploading(true)
    try {
      for (const file of files) {
        const result = await uploadAttachment(session.signer, file)
        if (!result.ok) {
          setUploadNote(`${file.name}: ${result.reason}`)
          return
        }
        const snippet = attachmentMarkdown(result, file.name)
        if (editorHandle.current) editorHandle.current.insert(`\n${snippet}\n`)
        else setContent((current) => `${current}\n${snippet}\n`)
        setUploadNote(`${file.name} uploaded (${Math.round(result.size / 1024)} kB)`)
      }
    } catch (err) {
      setUploadNote(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  /**
   * The `/` menu's attachment entry. It is the upload's only affordance since
   * the toolbar was stripped, so without a Blossom server the reason is shown
   * where the note sits rather than opening a picker that can only fail.
   */
  const openAttach = () => {
    if (!attachmentsEnabled()) {
      setUploadNote(NO_BLOSSOM_SERVER)
      return
    }
    fileInput.current?.click()
  }

  const save = async () => {
    setError(null)
    if (title.trim().length === 0) {
      setError('Give the page a title.')
      return
    }
    if (slug.length === 0) {
      setError('No slug can be derived from this title — please use letters or digits.')
      return
    }
    if (hasConflictMarkers(content)) {
      setError('There are still conflict markers in the text. Please resolve them and remove the markers.')
      return
    }

    // Optimistic lock: if somebody else saved since this editor was opened, we
    // merge and only publish after a human has reviewed the result.
    // docs/05-versioning-history.md
    const live = existing
    if (baseRevision && live && live.head.id !== baseRevision.id && !overrideParents) {
      const theirs = live.head
      const merged = mergeThreeWay(baseRevision.content, content, theirs.content, {
        mine: 'your version',
        theirs: `version by ${shortNpub(toNpub(theirs.author))}`,
      })
      setBaseRevision(theirs)
      setContent(merged.content)
      setNotice(
        merged.status === 'conflict'
          ? `${shortNpub(toNpub(theirs.author))} changed this page in the meantime. ` +
              `${merged.conflicts} spot(s) overlap — please resolve them in the text, ` +
              'remove the markers and save again.'
          : merged.status === 'identical'
            ? `${shortNpub(toNpub(theirs.author))} saved in the meantime, with the same ` +
                'result. Nothing to do.'
            : `${shortNpub(toNpub(theirs.author))} changed this page in the meantime. ` +
                'Both changes were merged — please review and save again.',
      )
      return
    }

    setBusy(true)
    try {
      // Before the write, not after the relay complains: whoever is active in
      // the extension now is who this revision would be signed by, and if that
      // is somebody else, the space on screen is not theirs to save into.
      const same = await ensureSamePubkey()
      if (!same.ok) {
        setError(same.reason)
        return
      }
      const result = await publishRevision(session.signer, {
        relayUrl,
        groupId,
        slug,
        title: title.trim(),
        // On a slug collision keep the existing page's parent instead of
        // silently lifting it to the top level.
        parentSlug: parentSlug.trim() || existing?.parentSlug || null,
        // Carry the sidebar position over. Without this every save would drop
        // the page back into alphabetical order. src/domain/order.ts
        order: existing?.order ?? null,
        summary: null,
        content,
        // New page: no predecessors. Merge: all leaves. Otherwise the current
        // head of the chain.
        parentRevs: overrideParents ?? (existing ? [existing.head.id] : []),
      })
      if (result.ok) {
        // Where a page hangs lives in its placement event once it has one, so
        // the tag alone would not move it. An existing page therefore gets a
        // placement when this field changed. src/domain/placement.ts
        const desiredParent = parentSlug.trim() || null
        if (page && desiredParent !== page.parentSlug) {
          const placed = await publishPlacement(session.signer, {
            relayUrl,
            groupId,
            slug,
            parentSlug: desiredParent,
            order: page.order,
          })
          if (!placed.ok) {
            setError(
              `Saved, but the page was not moved: ${placed.reason}. It is still ` +
                `filed under ${page.parentSlug ?? 'the top level'}.`,
            )
            return
          }
        }
        onSaved(slug)
        return
      }
      const kind = classifyRejection(result.reason)
      setError(
        kind === 'auth'
          ? `The relay requires authentication (NIP-42): ${result.reason}`
          : kind === 'permission'
            ? `The relay does not allow you to write in this space: ${result.reason}`
            : `Not saved: ${result.reason}`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'signing was cancelled')
    } finally {
      setBusy(false)
    }
  }

  return (
    // A flex column filling the frame (which is one too, via `stretch`): the
    // editor takes what is left, so the Formatting row lands at the bottom of
    // the page, exactly where "Write a comment" sits when reading.
    <div className="flex flex-1 flex-col gap-5">
      {notice ? <Callout tone="warning">{notice}</Callout> : null}

      {/* The title is the page's own heading, so it is edited at the size it
          will be read at — a borderless field the width of the column, not a
          32px box labelled "Title". */}
      <div className="shrink-0">
        <label htmlFor="title" className="sr-only">
          Title
        </label>
        <input
          id="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Untitled page"
          className="w-full bg-transparent text-[30px] leading-tight font-semibold tracking-[-0.02em] text-fg placeholder:text-fg-subtle/60 focus:outline-none"
        />
        {collision ? (
          <p className="mt-1 text-xs text-warning">
            “{existing?.title}” already uses this slug. Saving appends another revision to that
            page instead of creating a second one.
          </p>
        ) : null}
      </div>

      <MarkdownEditor
        value={content}
        onChange={setContent}
        ariaLabel="Content in Markdown"
        members={members}
        handleRef={editorHandle}
        onAttach={openAttach}
        onDropFiles={(files) => void upload(files)}
      />

      {/* The file picker the `/` menu's attachment entry opens. Kept out of
          the flow — the affordance is the menu, not a button. */}
      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          void upload(files)
        }}
      />
      {uploading ? <p className="text-xs text-fg-subtle">uploading…</p> : null}
      {uploadNote ? <p className="text-xs text-fg-subtle">{uploadNote}</p> : null}

      {/* The relay's own words, never a paraphrase: with distributed storage
          "saved" must not be claimed before an OK came back, and when it did
          not, the reason is the only thing that helps. Directly under the text
          it refers to, not below the fold-away help at the foot of the page.
          docs/06-ui-information-architecture.md */}
      {error ? (
        <Callout tone="danger" title="Not saved">
          {error}
        </Callout>
      ) : null}

      <FormattingHelp />

      {/* Rendered into the breadcrumb bar above, not down here — see
          docs/10-roadmap.md, Phase 6. */}
      <HeaderActions>
        <Button variant="primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'publishing…' : 'Publish'}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </HeaderActions>
    </div>
  )
}
