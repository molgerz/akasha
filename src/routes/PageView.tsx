import { useNavigate } from 'react-router-dom'
import { useSpaceRoute } from './space-route'
import { Markdown } from '../ui/Markdown'
import { Byline } from '../ui/Byline'
import { AuthorName } from '../ui/Author'
import { useSession } from '../session/session'
import { SignInButton } from '../ui/SignInButton'
import { Comments } from '../ui/Comments'
import { SpaceHiddenNotice } from '../ui/SpaceHiddenNotice'
import { spaceAccess } from '../domain/space-access'
import { useTocSource } from '../ui/layout/toc-context'
import { PageFrame, PageTitle } from '../ui/layout/PageFrame'
import type { Crumb } from '../ui/layout/PageFrame'
import { ButtonLink, Callout, IconButtonLink, Segmented } from '../ui/controls'
import { BlameIcon, BookIcon, HistoryIcon, PageIcon, PencilIcon, SubpageIcon } from '../ui/icons'
import type { Page } from '../domain/pages'

/**
 * The trail from the space down to this page. Walked upwards from the page and
 * reversed, with a guard against a cycle: `page-parent` comes off the relay
 * from an arbitrary key, and two pages naming each other as parent would
 * otherwise loop here forever.
 *
 * A hidden parent ends the trail, exactly as it ends a branch in `buildTree`:
 * the subpage is at the top level there, and a crumb leading into a page that
 * is out of the tree would contradict the sidebar the reader is looking at.
 * src/domain/pages.ts
 */
function ancestors(pages: Page[], page: Page): Page[] {
  const chain: Page[] = []
  const seen = new Set<string>([page.slug])
  let cursor = page.parentSlug
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const parent = pages.find((entry) => entry.slug === cursor)
    if (!parent || parent.hidden) break
    chain.unshift(parent)
    cursor = parent.parentSlug
  }
  return chain
}

export function PageView() {
  const { group, space, base, slug } = useSpaceRoute()
  const { session } = useSession()
  const navigate = useNavigate()

  // Hooks have to run before any early return, otherwise their order changes
  // between renders.
  const page = slug ? space.pages.find((entry) => entry.slug === slug) : undefined
  useTocSource(page?.head.content ?? '')

  if (!group || !base || !slug) {
    return (
      <PageFrame>
        <p className="text-sm text-danger">Invalid address.</p>
      </PageFrame>
    )
  }

  const spaceCrumb: Crumb = { label: space.metadata?.name ?? group.id, to: base }

  // A page URL in a space the relay is withholding: without this, "not found"
  // would blame the slug for what is really a question of access — and offer a
  // "create this page" button that the relay is going to reject.
  // docs/04-permissions-nip29.md
  if (spaceAccess(session.status === 'signed-in' ? session.pubkey : null, space).state === 'hidden') {
    return (
      <PageFrame crumbs={[spaceCrumb, { label: slug }]}>
        <PageTitle
          kicker={
            <span className="font-mono">
              {group.host}&#39;{group.id}
            </span>
          }
        >
          Nothing to see here
        </PageTitle>
        <SpaceHiddenNotice />
      </PageFrame>
    )
  }

  if (!page) {
    return (
      <PageFrame crumbs={[spaceCrumb, { label: slug }]}>
        <PageTitle kicker={space.loading ? 'loading…' : 'not found'}>{slug}</PageTitle>
        {space.loading ? null : (
          <div className="space-y-4">
            <p className="text-base text-fg-muted">
              There is no revision for this slug in this space yet.
            </p>
            <ButtonLink variant="primary" to={`${base}/new?slug=${encodeURIComponent(slug)}`}>
              Create this page
            </ButtonLink>
          </div>
        )}
      </PageFrame>
    )
  }

  const forked = page.leaves.length > 1
  const crumbs: Crumb[] = [
    spaceCrumb,
    ...ancestors(space.pages, page).map((parent) => ({
      label: parent.title,
      to: `${base}/${parent.slug}`,
      icon: <PageIcon className="size-3.5 text-fg-subtle" />,
    })),
    { label: page.title, icon: <PageIcon className="size-3.5 text-fg-subtle" /> },
  ]

  /**
   * The page's own actions, right-aligned in the frame's bar. Reading and
   * editing are two states of the same page and sit in one switch; the three
   * that open a *different* view are icons, because four words in a row read
   * as a sentence and stop being buttons.
   */
  const actions = (
    <>
      {session.status === 'signed-in' ? (
        <Segmented
          label="Reading or editing"
          value="read"
          options={[
            { value: 'read', label: 'Read', icon: <BookIcon className="size-3.5" /> },
            { value: 'edit', label: 'Edit', icon: <PencilIcon className="size-3.5" /> },
          ]}
          // There is no state to keep: "edit" is a different route, and coming
          // back from it puts the switch on "read" again by itself.
          onChange={(next) => {
            if (next === 'edit') navigate(`${base}/${page.slug}/edit`)
          }}
        />
      ) : (
        <SignInButton
          variant="quiet"
          title="Editing needs an npub this space knows as a member"
        >
          Sign in to edit
        </SignInButton>
      )}

      <IconButtonLink
        to={`${base}/${page.slug}/history`}
        label={`History — ${page.revisions.length} revision${page.revisions.length === 1 ? '' : 's'}`}
      >
        <HistoryIcon className="size-4.5" />
      </IconButtonLink>
      <IconButtonLink to={`${base}/${page.slug}/blame`} label="Line origin">
        <BlameIcon className="size-4.5" />
      </IconButtonLink>
      <IconButtonLink
        to={`${base}/new?parent=${encodeURIComponent(page.slug)}`}
        label="New subpage"
      >
        <SubpageIcon className="size-4.5" />
      </IconButtonLink>
    </>
  )

  return (
    <PageFrame crumbs={crumbs} actions={actions} stretch>
      {/* flex-1 here (PageFrame's content column is a flex column via
          `stretch`) so Comments lands flush with the bottom of a short
          page instead of floating right under the last paragraph — on a
          page long enough to scroll, flex-grow has nothing to add and
          Comments simply falls where the content ends. */}
      <div className="flex-1">
        <PageTitle below={<Byline revision={page.head} />}>{page.title}</PageTitle>

        {/* A page that is out of the tree still answers its own URL, so the
            one place somebody can learn it was removed is the page itself.
            Above the fork notice: "this page is gone from the space" outranks
            "it has two versions". */}
        {page.hidden ? (
          <div className="mb-6">
            <Callout
              tone="warning"
              title="This page was removed from the space"
              actions={
                <ButtonLink to={`${base}/${page.slug}/history`} size="sm">
                  History and restore
                </ButtonLink>
              }
            >
              It is out of the page tree, the search and the overview, so nobody will come
              across it — but nothing was deleted, and this link keeps working for everyone
              who has it.
            </Callout>
          </div>
        ) : null}

        {forked ? (
          <div className="mb-6">
            <Callout
              tone="warning"
              title={`This page has ${page.leaves.length} open versions`}
              actions={
                session.status === 'signed-in' ? (
                  <ButtonLink to={`${base}/${page.slug}/edit?merge=1`} size="sm">
                    Merge versions
                  </ButtonLink>
                ) : null
              }
            >
              Several people saved at the same time. The newest one is shown (
              <AuthorName pubkey={page.head.author} />); all versions are in the history.
            </Callout>
          </div>
        ) : null}

        <article>
          <Markdown>{page.head.content}</Markdown>
        </article>
      </div>

      <Comments
        relayUrl={group.relayUrl}
        groupId={group.id}
        slug={page.slug}
        comments={space.comments}
        isAdmin={
          session.status === 'signed-in' &&
          space.admins.some((admin) => admin.pubkey === session.pubkey)
        }
      />
    </PageFrame>
  )
}

