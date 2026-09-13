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
import type { Revision } from '../domain/revision'
import { PageFrame, PageTitle } from '../ui/layout/PageFrame'
import { Button, Callout, Card, IconButtonLink, SectionLabel } from '../ui/controls'
import { BlameIcon, BookIcon, PageIcon } from '../ui/icons'

/** One revision's timestamp, spelled the same way everywhere on this page. */
function stamp(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString()
}

export function HistoryView() {
  const { group, space, base, slug } = useSpaceRoute()
  const { session, ensureSamePubkey } = useSession()
  const navigate = useNavigate()
  const [selection, setSelection] = useState<{ from: string; to: string } | null>(null)
  const [details, setDetails] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const removeRevision = async (revision: Revision) => {
    if (session.status !== 'signed-in') return
    // The relay really enforces this deletion — so ask first.
    const ok = window.confirm(
      `Delete the revision from ${stamp(revision.createdAt)} on the relay? This cannot be undone.`,
    )
    if (!ok) return
    setError(null)
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
    }
  }
  const from = selection ? revisions.find((r) => r.id === selection.from) : revisions[1]
  const to = selection ? revisions.find((r) => r.id === selection.to) : revisions[0]

  const restore = async (revision: Revision) => {
    if (session.status !== 'signed-in') return
    setError(null)
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

      {error ? (
        <div className="mb-6">
          <Callout tone="danger" title="That did not work">
            {error}
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
                        onClick={() => void removeRevision(revision)}
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
    </PageFrame>
  )
}
