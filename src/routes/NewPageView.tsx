import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSpaceRoute } from './space-route'
import { spaceAccess } from '../domain/space-access'
import { SpaceHiddenPage } from '../ui/SpaceHiddenNotice'
import { useSession } from '../session/session'
import { PageEditor } from '../ui/PageEditor'
import { PageFrame } from '../ui/layout/PageFrame'
import { spacePeople } from '../domain/group-state'

export function NewPageView() {
  const { group, space, base } = useSpaceRoute()
  const { session } = useSession()
  const [params] = useSearchParams()
  const navigate = useNavigate()

  if (!group || !base) {
    return (
      <PageFrame>
        <p className="text-sm text-danger">Invalid address.</p>
      </PageFrame>
    )
  }

  // Reachable by URL, so the guard belongs here too and not only on the button
  // that leads here: a create in a space the relay withholds is a write it is
  // going to reject.
  if (spaceAccess(session.status === 'signed-in' ? session.pubkey : null, space).state === 'hidden') {
    return <SpaceHiddenPage group={group} base={base} crumb="New page" />
  }

  const spaceName = space.metadata?.name ?? group.id
  const parent = params.get('parent')

  return (
    <PageFrame
      width="wide"
      stretch
      crumbs={[{ label: spaceName, to: base }, { label: 'New page' }]}
    >
      <PageEditor
        relayUrl={group.relayUrl}
        groupId={group.id}
        defaultParentSlug={parent}
        pages={space.pages}
        members={spacePeople(space)}
        onSaved={(slug) => navigate(`${base}/${slug}`)}
        // The way out of a slug collision: the page that already owns the
        // heading, rather than a dead end at "this name is taken".
        onOpenPage={(slug) => navigate(`${base}/${slug}`)}
        onCancel={() => navigate(base)}
      />
    </PageFrame>
  )
}
