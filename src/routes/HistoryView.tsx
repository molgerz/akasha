import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpaceRoute } from './space-route'
import { spaceAccess } from '../domain/space-access'
import { SpaceHiddenPage } from '../ui/SpaceHiddenNotice'
import { toNpub } from '../nostr/profile'
import { DiffView } from '../ui/DiffView'
import { Author, AuthorName } from '../ui/Author'
import { useSession } from '../session/session'
import { publishRevision } from '../nostr/publish-page'
import { classifyRejection } from '../nostr/client'
import { deleteGroupEvent } from '../nostr/moderation'
import { forgetEvent } from '../nostr/space-store'
import { archiveConfirmation, useArchivePage } from '../ui/archive-page'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { childSlugs } from '../domain/pages'
import type { Revision } from '../domain/revision'
import { PageFrame, PageTitle } from '../ui/layout/PageFrame'
import { Button, Callout, Card, IconButtonLink, SectionLabel } from '../ui/controls'
import { BlameIcon, BookIcon, PageIcon } from '../ui/icons'

/** One revision's timestamp, spelled the same way everywhere on this page. */
function stamp(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString()
}

/**
 * The act waiting for a confirmation. Both of this page's destructive actions
 * go through one piece of state rather than a boolean each: only one dialog can
 * be open, and a pair of booleans is a way to end up with two.
 *
 * Bringing an archived page back is deliberately not in here — it takes nothing
 * away, and a dialog in front of it would ask people to confirm the undo.
 */
type Pending = { kind: 'archive' } | { kind: 'delete'; revision: Revision }

export function HistoryView() {
  const { group, space, base, slug } = useSpaceRoute()
  const { session, ensureSamePubkey } = useSession()
  const navigate = useNavigate()
  const [selection, setSelection] = useState<{ from: string; to: string } | null>(null)
  const [details, setDetails] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The notice carries its own title: this view has two flows that succeed in
  // very different ways, and a fixed title would put an archiving under a
  // headline announcing a deletion — the one reading this page must not draw.
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null)
  const archive = useArchivePage(group?.relayUrl ?? '', group?.id ?? '')
  const [pending, setPending] = useState<Pending | null>(null)

  if (!group || !base || !slug) {
    return (
      <PageFrame>
        <p className="text-sm text-danger">Invalid address.</p>
      </PageFrame>
    )
  }

  if (spaceAccess(session.status === 'signed-in' ? session.pubkey : null, space).state === 'hidden') {
    return <SpaceHiddenPage group={group} base={base} crumb="History" />
  }

  const spaceName = space.metadata?.name ?? group.id
  const page = space.pages.find((entry) => entry.slug === slug)
  if (!page) {
    return (
      <PageFrame crumbs={[{ label: spaceName, to: base }, { label: 'History' }]}>
        <p className="text-base text-fg-muted">
          {space.loading ? 'loading…' : 'No revisions for this slug.'}
        </p>
      </PageFrame>
    )
  }

  const isAdmin =
    session.status === 'signed-in' &&
    space.admins.some((admin) => admin.pubkey === session.pubkey)
  const revisions = page.revisions

  /**
   * Wipes what the previous action left on screen. The archive hook keeps its
   * own error state, so clearing the local one is not enough — otherwise a
   * failed archiving stays in the callout while the next action reports its
   * own result.
   */
  const clearFeedback = () => {
    setError(null)
    setNotice(null)
    archive.setError(null)
  }

  // Two sources, one callout: the actions on this page report through local
  // state, archiving reports through its hook. Only one of them can be set at
  // a time, because every action clears both before it starts.
  const shownError = error ?? archive.error

  // The confirmation stays open until the relay has answered — closing it on
  // the click would leave a slow relay looking like nothing happened, and the
  // dialog is the only thing on screen disabled while the request is out.
  const removeRevision = async (revision: Revision) => {
    if (session.status !== 'signed-in') return
    clearFeedback()
    setBusy(true)
    try {
      const same = await ensureSamePubkey()
      if (!same.ok) {
        setError(same.reason)
        return
      }
      const result = await deleteGroupEvent(session.signer, {
        relayUrl: group.relayUrl,
        groupId: group.id,
        eventId: revision.id,
      })
      if (result.ok) {
        forgetEvent(group.relayUrl, group.id, revision.id)
        return
      }
      setError(`Not deleted: ${result.reason}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'signing was cancelled')
    } finally {
      setBusy(false)
      setPending(null)
    }
  }
  const from = selection ? revisions.find((r) => r.id === selection.from) : revisions[1]
  const to = selection ? revisions.find((r) => r.id === selection.to) : revisions[0]

  const restore = async (revision: Revision) => {
    if (session.status !== 'signed-in') return
    clearFeedback()
    setBusy(true)
    try {
      const same = await ensureSamePubkey()
      if (!same.ok) {
        setError(same.reason)
        return
      }
      const result = await publishRevision(session.signer, {
        relayUrl: group.relayUrl,
        groupId: group.id,
        slug: page.slug,
        title: revision.title,
        // Where the page hangs is not part of the text being restored, so the
        // restored revision carries the placement the page has *now* — going
        // back to an old version must not move the page. For a page with a
        // placement event these tags are only the fallback anyway.
        // src/domain/placement.ts
        parentSlug: page.parentSlug,
        order: page.order,
        summary: `restored the version from ${stamp(revision.createdAt)}`,
        content: revision.content,
        // A restore attaches to the current head — the history stays complete
        // and nothing is deleted.
        parentRevs: [page.head.id],
        restoreOf: revision.id,
      })
      if (result.ok) {
        navigate(`${base}/${page.slug}`)
        return
      }
      const kind = classifyRejection(result.reason)
      setError(
        kind === 'permission'
          ? `The relay does not allow you to write here: ${result.reason}`
          : `Not saved: ${result.reason}`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'signing was cancelled')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Archiving the page, and bringing it back. A page-level action, so it sits
   * in the view that is already about this page's lifecycle rather than among
   * the navigation icons on the page itself. src/ui/archive-page.ts
   */
  const toggleArchived = async () => {
    if (session.status !== 'signed-in') return
    clearFeedback()
    // The failure is *not* read back off `archive` here: this closure holds the
    // hook's object from the render it was created in, and `setArchived`
    // reports its error by setting state, which produces a new object rather
    // than mutating that one. Reading `archive.error` after the await would
    // therefore show the previous attempt's message, never the current one. The
    // callout renders `archive.error` directly instead — the same way the
    // sidebar renders `useMovePage`'s. src/ui/archive-page.ts
    const ok = await archive.setArchived(page, !page.archived)
    // Only now, for the same reason `removeRevision` waits: the confirmation
    // is what shows that the request is still out.
    setPending(null)
    if (ok && !page.archived) {
      setNotice({
        title: 'The page is archived — and can come back',
        body:
          'The page is out of the tree, the search and the overview. Its history is ' +
          'unchanged and this link still works — bring it back from here whenever you want.',
      })
    }
  }

  // Built on every render rather than inside the dialog, because the subpage
  // count has to be the one at the moment the dialog is read — a page whose
  // children moved while it was open would otherwise promise the old number.
  const confirmation = archiveConfirmation(page, childSlugs(space.pages, page.slug).length)

  const option = (revision: Revision) => (
    <>
      {stamp(revision.createdAt)} · <AuthorName pubkey={revision.author} />
    </>
  )

  return (
    <PageFrame
      width="wide"
      crumbs={[
        { label: spaceName, to: base },
        { label: page.title, to: `${base}/${page.slug}`, icon: <PageIcon className="size-3.5 text-fg-subtle" /> },
        { label: 'History' },
      ]}
      actions={
        <>
          <IconButtonLink to={`${base}/${page.slug}`} label="Back to the page">
            <BookIcon className="size-4.5" />
          </IconButtonLink>
          <IconButtonLink to={`${base}/${page.slug}/blame`} label="Line origin">
            <BlameIcon className="size-4.5" />
          </IconButtonLink>
        </>
      }
    >
      <PageTitle
        kicker="History"
        below={
          <p className="text-sm text-fg-subtle">
            {revisions.length} revision{revisions.length === 1 ? '' : 's'}, newest first
          </p>
        }
      >
        {page.title}
      </PageTitle>

      {shownError ? (
        <div className="mb-6">
          <Callout tone="danger" title="That did not work">
            {shownError}
          </Callout>
        </div>
      ) : null}

      {notice ? (
        <div className="mb-6">
          <Callout tone="warning" title={notice.title}>
            {notice.body}
          </Callout>
        </div>
      ) : null}

      {page.archived ? (
        <div className="mb-6">
          <Callout
            tone="warning"
            title="This page is archived"
            actions={
              session.status === 'signed-in' ? (
                <Button
                  size="sm"
                  disabled={busy || archive.busy}
                  onClick={() => void toggleArchived()}
                >
                  Bring the page back
                </Button>
              ) : null
            }
          >
            It is out of the tree and the search. Nothing was deleted — the history below is
            complete.
          </Callout>
        </div>
      ) : null}

      {revisions.length > 1 ? (
        <section className="mb-10">
          <SectionLabel className="mb-3">Compare</SectionLabel>
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1.5">
                <span className="block text-xs font-medium text-fg-muted">from</span>
                <select
                  value={from?.id ?? ''}
                  onChange={(event) =>
                    setSelection({ from: event.target.value, to: to?.id ?? revisions[0].id })
                  }
                  className="h-8 max-w-64 rounded-md border border-line bg-surface-2 px-2 text-sm text-fg"
                >
                  {revisions.map((revision) => (
                    <option key={revision.id} value={revision.id}>
                      {option(revision)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="block text-xs font-medium text-fg-muted">to</span>
                <select
                  value={to?.id ?? ''}
                  onChange={(event) =>
                    setSelection({ from: from?.id ?? revisions[1].id, to: event.target.value })
                  }
                  className="h-8 max-w-64 rounded-md border border-line bg-surface-2 px-2 text-sm text-fg"
                >
                  {revisions.map((revision) => (
                    <option key={revision.id} value={revision.id}>
                      {option(revision)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {from && to ? <DiffView before={from.content} after={to.content} /> : null}
          </Card>
        </section>
      ) : null}

      {/* The revisions as a timeline: one rule down the left, a marker per
          entry on it. A stack of separate cards said nothing about the order
          they happened in, and order is the whole point of a history. */}
      <section>
        <SectionLabel className="mb-3">Revisions</SectionLabel>
        <ol className="space-y-3 border-l border-line pl-5">
          {revisions.map((revision) => {
            const isHead = revision.id === page.head.id
            const npub = toNpub(revision.author)
            const open = details === revision.id
            return (
              <li key={revision.id} className="group/rev relative">
                <span
                  aria-hidden="true"
                  className={`absolute top-4 -left-[25px] size-2.5 rounded-full ring-3 ring-surface-2 ${
                    isHead ? 'bg-accent' : 'bg-line-strong'
                  }`}
                />
                <Card className="p-3.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Author pubkey={revision.author} />
                    <span className="text-fg-subtle">{stamp(revision.createdAt)}</span>
                    {isHead ? (
                      <span className="rounded-full bg-accent-bg px-2 py-0.5 font-medium text-accent-fg">
                        current
                      </span>
                    ) : null}
                    {revision.parentRevs.length > 1 ? (
                      <span className="rounded-full bg-surface-0 px-2 py-0.5 text-fg-muted">
                        merge
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-1.5 text-sm text-fg-muted">
                    {revision.summary ?? <span className="text-fg-subtle italic">no note</span>}
                  </div>

                  {/* Held back until the row is reached: on a page with thirty
                      revisions the buttons outnumbered the notes. */}
                  <div className="mt-2 flex flex-wrap gap-1 opacity-0 transition-opacity group-hover/rev:opacity-100 focus-within:opacity-100">
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() => setDetails(open ? null : revision.id)}
                    >
                      {open ? 'Hide details' : 'Details'}
                    </Button>
                    {!isHead && session.status === 'signed-in' ? (
                      <Button
                        size="sm"
                        variant="subtle"
                        disabled={busy}
                        onClick={() => void restore(revision)}
                      >
                        Restore
                      </Button>
                    ) : null}
                    {!isHead ? (
                      <Button
                        size="sm"
                        variant="subtle"
                        onClick={() => setSelection({ from: revision.id, to: page.head.id })}
                      >
                        Compare with current
                      </Button>
                    ) : null}
                    {isAdmin ? (
                      <Button
                        size="sm"
                        variant="subtle"
                        className="text-danger hover:bg-danger-bg"
                        disabled={busy}
                        onClick={() => setPending({ kind: 'delete', revision })}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>

                  {open ? (
                    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-line pt-3 font-mono text-xs break-all text-fg-subtle">
                      <dt>Event-ID</dt>
                      <dd>{revision.id}</dd>
                      <dt>Author</dt>
                      <dd>{npub}</dd>
                      <dt>Predecessors</dt>
                      <dd>{revision.parentRevs.join(', ') || 'none (first revision)'}</dd>
                      <dt>Signature</dt>
                      <dd>verified on receipt</dd>
                    </dl>
                  ) : null}
                </Card>
              </li>
            )
          })}
        </ol>
      </section>

      {/* At the foot, not in the actions bar. Archiving a page is a page-level
          action and belongs in the view about this page's lifecycle — but it
          is also the weightiest thing here, and it has no business sitting
          next to the navigation icons somebody reaches for to get back to
          reading. */}
      {session.status === 'signed-in' && !page.archived ? (
        <section className="mt-12 border-t border-line pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="danger"
              size="sm"
              disabled={busy || archive.busy}
              onClick={() => setPending({ kind: 'archive' })}
            >
              Archive this page
            </Button>
            {/* One line. The consequences are spelled out in full in the
                confirmation a click away, and saying them twice here turned
                the button into a paragraph with a button in front of it.
                src/ui/ConfirmDialog.tsx */}
            <p className="text-xs text-fg-subtle">
              Takes it out of the navigation. Nothing is deleted.
            </p>
          </div>
        </section>
      ) : null}

      {/* Both confirmations live here rather than next to the buttons that open
          them: a `<dialog>` is in the top layer wherever it sits in the markup,
          and keeping them together makes it obvious that only one can be open.
          src/ui/ConfirmDialog.tsx */}
      <ConfirmDialog
        open={pending?.kind === 'archive'}
        title={confirmation.title}
        confirmLabel="Archive the page"
        busy={archive.busy}
        onConfirm={() => void toggleArchived()}
        onCancel={() => setPending(null)}
      >
        <p>{confirmation.body}</p>
        {confirmation.subpages ? <p>{confirmation.subpages}</p> : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === 'delete'}
        title="Delete this revision on the relay?"
        confirmLabel="Delete the revision"
        busy={busy}
        onConfirm={() => {
          if (pending?.kind === 'delete') void removeRevision(pending.revision)
        }}
        onCancel={() => setPending(null)}
      >
        <p>
          The revision from{' '}
          {pending?.kind === 'delete' ? stamp(pending.revision.createdAt) : ''} is removed by the
          relay, which really enforces this. It cannot be undone.
        </p>
        <p>
          Newer revisions built on it keep their text — what goes is this one step of the
          chain.
        </p>
      </ConfirmDialog>
    </PageFrame>
  )
}
