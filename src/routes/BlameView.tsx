import { useSpaceRoute } from './space-route'
import { spaceAccess } from '../domain/space-access'
import { SpaceHiddenPage } from '../ui/SpaceHiddenNotice'
import { useSession } from '../session/session'
import { blame } from '../domain/blame'
import { toNpub } from '../nostr/profile'
import { AuthorName } from '../ui/Author'
import { PageFrame, PageTitle } from '../ui/layout/PageFrame'
import { Card, IconButtonLink } from '../ui/controls'
import { BookIcon, HistoryIcon, PageIcon } from '../ui/icons'

/**
 * Who wrote which line. The attribution is computed from the revision chain,
 * so every line carries its author's key. The column shows the name; the key
 * stays in the cell's tooltip for whoever opens this screen to check it.
 * docs/06-ui-information-architecture.md
 */
export function BlameView() {
  const { group, space, base, slug } = useSpaceRoute()
  const { session } = useSession()

  if (!group || !base || !slug) {
    return (
      <PageFrame>
        <p className="text-sm text-danger">Invalid address.</p>
      </PageFrame>
    )
  }

  if (spaceAccess(session.status === 'signed-in' ? session.pubkey : null, space).state === 'hidden') {
    return <SpaceHiddenPage group={group} base={base} crumb="Line origin" />
  }

  const spaceName = space.metadata?.name ?? group.id
  const page = space.pages.find((entry) => entry.slug === slug)
  if (!page) {
    return (
      <PageFrame crumbs={[{ label: spaceName, to: base }, { label: 'Line origin' }]}>
        <p className="text-base text-fg-muted">
          {space.loading ? 'loading…' : 'Page not found.'}
        </p>
      </PageFrame>
    )
  }

  const lines = blame(page.revisions, page.head)
  const colorOf = new Map<string, string>()
  const palette = ['text-fg-muted', 'text-accent-fg', 'text-success', 'text-warning']
  let next = 0

  return (
    <PageFrame
      width="wide"
      crumbs={[
        { label: spaceName, to: base },
        {
          label: page.title,
          to: `${base}/${page.slug}`,
          icon: <PageIcon className="size-3.5 text-fg-subtle" />,
        },
        { label: 'Line origin' },
      ]}
      actions={
        <>
          <IconButtonLink to={`${base}/${page.slug}`} label="Back to the page">
            <BookIcon className="size-4.5" />
          </IconButtonLink>
          <IconButtonLink to={`${base}/${page.slug}/history`} label="History">
            <HistoryIcon className="size-4.5" />
          </IconButtonLink>
        </>
      }
    >
      <PageTitle
        kicker="Line origin"
        below={
          <p className="text-sm text-fg-subtle">
            {lines.length} line{lines.length === 1 ? '' : 's'}, each attributed to the revision
            that last touched it
          </p>
        }
      >
        {page.title}
      </PageTitle>

      <Card className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <tbody>
            {lines.map((line, index) => {
              const npub = toNpub(line.revision.author)
              if (!colorOf.has(line.revision.author)) {
                colorOf.set(line.revision.author, palette[next % palette.length])
                next += 1
              }
              return (
                <tr key={index} className="align-top hover:bg-surface-hover">
                  <td
                    className={`w-32 px-3 py-1 whitespace-nowrap ${colorOf.get(line.revision.author)}`}
                    title={`${npub} · ${new Date(line.revision.createdAt * 1000).toLocaleString()}`}
                  >
                    <AuthorName pubkey={line.revision.author} />
                  </td>
                  <td className="w-10 border-r border-line px-2 py-1 text-right text-fg-subtle select-none">
                    {index + 1}
                  </td>
                  <td className="px-3 py-1 whitespace-pre-wrap text-fg">
                    {line.text.length === 0 ? ' ' : line.text}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </PageFrame>
  )
}
