import { Link } from 'react-router-dom'
import { useSpaceRoute } from './space-route'
import { Author } from '../ui/Author'
import { useSession } from '../session/session'
import { SpaceHiddenNotice } from '../ui/SpaceHiddenNotice'
import { spaceAccess } from '../domain/space-access'
import { archivedPages } from '../domain/pages'
import { useArchivePage } from '../ui/archive-page'
import { PageFrame, PageTitle } from '../ui/layout/PageFrame'
import { Button, Callout, Card } from '../ui/controls'
import { ArchiveIcon, PageIcon } from '../ui/icons'

/** The same spelling of a timestamp the history uses. */
function stamp(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString()
}

/**
 * Where the archived pages are.
 *
 * An archive nobody can open is not an archive — it is a hole the pages fall
 * into. Archiving takes a page out of the tree, the search and the overview,
 * which leaves its own URL as the only way back to it, and that is exactly the
 * thing somebody who archived a page by mistake no longer has. So this list
 * exists, one entry per archived page, newest first.
 *
 * It is deliberately *not* the page index a second time: no tree, no nesting,
 * no ordering by title. A page in here has no place in the tree by definition,
 * and what is worth knowing about it is when it left and who put it there.
 * docs/05-versioning-history.md
 */
export function ArchiveView() {
  const { group, space, base } = useSpaceRoute()
  const { session } = useSession()
  const archive = useArchivePage(group?.relayUrl ?? '', group?.id ?? '')

  if (!group || !base) {
    return (
      <PageFrame>
        <p className="text-sm text-danger">Invalid address.</p>
      </PageFrame>
    )
  }

  const spaceName = space.metadata?.name ?? group.id
  const crumbs = [{ label: spaceName, to: base }, { label: 'Archive' }]

  // A space the relay is withholding holds no pages here either, and "nothing
  // archived" would read as a fact about the space rather than about access.
  // docs/04-permissions-nip29.md
  if (spaceAccess(session.status === 'signed-in' ? session.pubkey : null, space).state === 'hidden') {
    return (
      <PageFrame crumbs={crumbs}>
        <PageTitle kicker="Archive">Nothing to see here</PageTitle>
        <SpaceHiddenNotice />
      </PageFrame>
    )
  }

  const pages = archivedPages(space.pages)

  return (
    <PageFrame width="wide" crumbs={crumbs}>
      <PageTitle
        kicker="Archive"
        below={
          pages.length === 0 ? null : (
            <p className="text-sm text-fg-subtle">
              {pages.length} archived page{pages.length === 1 ? '' : 's'}, newest first
            </p>
          )
        }
      >
        {spaceName}
      </PageTitle>

      {archive.error ? (
        <div className="mb-6">
          <Callout tone="danger" title="That did not work">
            {archive.error}
          </Callout>
        </div>
      ) : null}

      {pages.length === 0 ? (
        // An empty archive is the normal state, not a dead end — so it says
        // what would put something in here rather than apologising.
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line py-14 text-center">
          <ArchiveIcon className="size-7 text-fg-subtle" />
          <p className="max-w-[46ch] text-sm text-fg-muted">
            {space.loading
              ? 'loading pages…'
              : 'Nothing is archived in this space. Archiving a page — from the foot of its history — takes it out of the tree, the search and the overview, and puts it here.'}
          </p>
        </div>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {pages.map((page) => (
              <li
                key={page.slug}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5"
              >
                <PageIcon className="size-4 text-fg-subtle" />
                {/* The title still links to the page: archived is not deleted,
                    and reading it is how you decide whether to bring it back. */}
                <Link
                  to={`${base}/${page.slug}`}
                  className="min-w-0 flex-1 truncate text-sm text-fg hover:text-accent-fg"
                >
                  {page.title}
                </Link>
                <span className="shrink-0 text-xs text-fg-subtle" title={stamp(page.head.createdAt)}>
                  archived {stamp(page.head.createdAt)}
                </span>
                <span className="hidden w-44 shrink-0 justify-end text-xs sm:flex">
                  <Author pubkey={page.head.author} />
                </span>
                {session.status === 'signed-in' ? (
                  <Button
                    size="sm"
                    disabled={archive.busy}
                    onClick={() => void archive.setArchived(page, false)}
                  >
                    Bring back
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageFrame>
  )
}
