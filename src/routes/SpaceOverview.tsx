import { Link } from 'react-router-dom'
import { useSpaceRoute } from './space-route'
import { Author } from '../ui/Author'
import { WriteCheck } from '../ui/WriteCheck'
import { MemberAdmin } from '../ui/MemberAdmin'
import { useSession } from '../session/session'
import { SpaceHiddenNotice } from '../ui/SpaceHiddenNotice'
import { spaceAccess } from '../domain/space-access'
import { KINDS } from '../nostr/kinds'
import { PageFrame, PageTitle } from '../ui/layout/PageFrame'
import { ButtonLink, Callout, Card, InitialsDisc, SectionLabel } from '../ui/controls'
import { PageIcon, PlusIcon, SettingsIcon } from '../ui/icons'
import type { ReactNode } from 'react'

/**
 * A fact about the space, stated in one word: readable by anyone, open to
 * anyone, your own standing in it. Grey pills, not coloured ones — these are
 * properties, and a row of coloured badges reads as a row of warnings.
 */
function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        tone === 'accent' ? 'bg-accent-bg text-accent-fg' : 'bg-surface-0 text-fg-muted'
      }`}
    >
      {children}
    </span>
  )
}

export function SpaceOverview() {
  const { group, space, base } = useSpaceRoute()
  const { session } = useSession()

  if (!group || !base) {
    return (
      <PageFrame>
        <p className="text-sm text-danger">Invalid group address.</p>
      </PageFrame>
    )
  }

  const meta = space.metadata
  const name = meta?.name ?? group.id
  const access = spaceAccess(session.status === 'signed-in' ? session.pubkey : null, space)
  const isMember = session.status === 'signed-in' && space.members.includes(session.pubkey)
  // A hidden page is out of the navigation, and this list is navigation. It
  // stays in `space.pages` on purpose — the page's own URL and its history
  // still have to reach it. src/domain/pages.ts
  const listed = space.pages.filter((page) => !page.hidden)
  const isAdmin =
    session.status === 'signed-in' &&
    space.admins.some((admin) => admin.pubkey === session.pubkey)
  // Akasha is for closed teams, so `public` and `open` are not options a space
  // may pick — they are a misconfiguration that leaks the team's pages, and the
  // relay is the only thing enforcing it. Worth saying loudly on the one page
  // that shows the group's settings.
  const tooOpen = [
    meta?.isPublic ? 'readable without membership' : null,
    meta?.isOpen ? 'joinable without an invitation' : null,
  ].filter((flag): flag is string => flag !== null)
  // Every kind the app writes as content. A group that does not declare one of
  // them will have those events rejected — silently, as far as the relay's
  // metadata is concerned, so it is worth saying before somebody tries.
  const missingKinds =
    meta !== null && meta.supportedKinds.length > 0
      ? [KINDS.PAGE_REVISION, KINDS.PAGE_PLACEMENT].filter(
          (kind) => !meta.supportedKinds.includes(kind),
        )
      : []

  // The relay answered with nothing at all. Showing the normal overview here
  // would invent a space out of the group id and then report it as empty —
  // which reads as "there is nothing in here" when it means "you cannot see
  // in". docs/04-permissions-nip29.md
  if (access.state === 'hidden') {
    return (
      <PageFrame crumbs={[{ label: group.id }]}>
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

  return (
    <PageFrame
      width="wide"
      crumbs={[{ label: name }]}
      actions={
        <>
          {isAdmin ? (
            <ButtonLink
              variant="subtle"
              to={`/settings/spaces/${encodeURIComponent(`${group.host}'${group.id}`)}`}
            >
              <SettingsIcon className="size-4" />
              Admin
            </ButtonLink>
          ) : null}
          <ButtonLink variant="primary" to={`${base}/new`}>
            <PlusIcon className="size-4" />
            New page
          </ButtonLink>
        </>
      }
    >
      {/* The space's own header: the disc from the sidebar again, at the size a
          title deserves, so the bar and the page are visibly the same place. */}
      <div className="mb-8 flex items-start gap-4">
        <InitialsDisc name={name} className="mt-1 size-12 text-base" />
        <div className="min-w-0 flex-1">
          <PageTitle
            kicker={
              <span className="font-mono">
                {group.host}&#39;{group.id}
              </span>
            }
            below={
              <div className="flex flex-wrap items-center gap-1.5">
                {meta ? (
                  <>
                    {/* Stated as facts, not judged here — the callout below
                        does the judging, and a row of red pills next to the
                        space name would shout before it explains. */}
                    <Pill>{meta.isPublic ? 'readable by anyone' : 'members only'}</Pill>
                    <Pill>{meta.isOpen ? 'anyone may join' : 'joining by invitation'}</Pill>
                    {isAdmin ? (
                      <Pill tone="accent">you are an admin</Pill>
                    ) : isMember ? (
                      <Pill tone="accent">you are a member</Pill>
                    ) : null}
                  </>
                ) : (
                  <span className="text-sm text-fg-subtle">
                    {space.loading ? 'loading group state…' : 'no group metadata found'}
                  </span>
                )}
              </div>
            }
          >
            {name}
          </PageTitle>
          {meta?.about ? <p className="-mt-3 text-base text-fg-muted">{meta.about}</p> : null}
        </div>
      </div>

      {tooOpen.length > 0 ? (
        <div className="mb-8">
          <Callout tone="warning" title="This space is more open than it should be">
            Akasha is for closed teams: reading needs a signed-in npub <em>and</em> membership.
            According to the relay this space is {tooOpen.join(' and ')}. An admin can close it
            by sending a <span className="font-mono">9002</span> carrying{' '}
            <span className="font-mono">private</span>, <span className="font-mono">closed</span>{' '}
            and <span className="font-mono">restricted</span> — the flags only change when their
            tag is present, so all three have to be in it.
          </Callout>
        </div>
      ) : null}

      {missingKinds.length > 0 ? (
        <div className="mb-8">
          <Callout
            tone="warning"
            title={`According to the relay this space does not accept kind ${missingKinds.join(' and ')}`}
          >
            The group metadata lists {meta?.supportedKinds.join(', ')}.{' '}
            {missingKinds.includes(KINDS.PAGE_REVISION)
              ? 'Saving pages'
              : 'Moving pages in the sidebar'}{' '}
            will most likely be rejected by the relay.
          </Callout>
        </div>
      ) : null}

      {/* The page list as rows, not cards: title on the left, its numbers
          right-aligned on the same baseline. A list of twenty pages is
          scanned down one column — cards would put every title at a
          different x. */}
      <section className="mb-10">
        <SectionLabel className="mb-3">Pages · {listed.length}</SectionLabel>
        {listed.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {space.loading ? 'loading pages…' : 'No pages in this space yet.'}
          </p>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {listed.map((page) => (
                <li key={page.slug}>
                  <Link
                    to={`${base}/${page.slug}`}
                    className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-surface-hover"
                  >
                    <PageIcon className="size-4 text-fg-subtle" />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{page.title}</span>
                    {page.leaves.length > 1 ? (
                      <span className="shrink-0 rounded-full bg-warning-bg px-2 py-0.5 text-[11px] font-medium text-warning">
                        forked
                      </span>
                    ) : null}
                    <span className="hidden shrink-0 text-xs text-fg-subtle sm:block">
                      {page.revisions.length} rev{page.revisions.length === 1 ? '' : 's'}
                    </span>
                    <span className="hidden w-44 shrink-0 justify-end text-xs sm:flex">
                      <Author pubkey={page.head.author} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <div className="space-y-10">
        <MemberAdmin
          relayUrl={group.relayUrl}
          groupId={group.id}
          members={space.members}
          admins={space.admins}
          loading={space.loading}
          showControls={false}
        />

        <section>
          <SectionLabel className="mb-3">Check write access</SectionLabel>
          <Card className="space-y-3 p-4">
            <p className="text-sm text-fg-muted">
              Signs an ephemeral event (kind 20817) carrying this space&#39;s h tag and
              publishes it. Exercises signer, NIP-42 AUTH and the relay&#39;s answer without
              storing anything.
            </p>
            <WriteCheck relayUrl={group.relayUrl} groupId={group.id} />
          </Card>
        </section>
      </div>
    </PageFrame>
  )
}
