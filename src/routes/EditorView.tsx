import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSpaceRoute } from './space-route'
import { PageEditor } from '../ui/PageEditor'
import { findCommonAncestor } from '../domain/pages'
import { spacePeople } from '../domain/group-state'
import { mergeThreeWay } from '../domain/merge'
import { displayNameOrNpub } from '../nostr/profile-store'
import { PageFrame } from '../ui/layout/PageFrame'
import { PageIcon } from '../ui/icons'
import { SpaceHiddenPage } from '../ui/SpaceHiddenNotice'
import { spaceAccess } from '../domain/space-access'
import { useSession } from '../session/session'

export function EditorView() {
  const { group, space, base, slug } = useSpaceRoute()
  const { session } = useSession()
  const [params] = useSearchParams()
  const navigate = useNavigate()

  if (!group || !base || !slug) {
    return (
      <PageFrame>
        <p className="text-sm text-danger">Invalid address.</p>
      </PageFrame>
    )
  }

  const spaceName = space.metadata?.name ?? group.id

  if (spaceAccess(session.status === 'signed-in' ? session.pubkey : null, space).state === 'hidden') {
    return <SpaceHiddenPage group={group} base={base} crumb={slug} />
  }

  const page = space.pages.find((entry) => entry.slug === slug)
  if (!page) {
    return (
      <PageFrame crumbs={[{ label: spaceName, to: base }, { label: slug }]}>
        <p className="text-base text-fg-muted">
          {space.loading ? 'loading…' : 'This page does not exist yet.'}
        </p>
      </PageFrame>
    )
  }

  // Merge mode: combine the open versions of a forked page. The base is
  // their most recent common ancestor.
  const mergeRequested = params.get('merge') === '1'
  const mergeMode = mergeRequested && page.leaves.length > 1

  const frame = (children: React.ReactNode) => (
    <PageFrame
      width="wide"
      stretch
      crumbs={[
        { label: spaceName, to: base },
        {
          label: page.title,
          to: `${base}/${page.slug}`,
          icon: <PageIcon className="size-3.5 text-fg-subtle" />,
        },
        { label: mergeMode ? 'Merge' : 'Edit' },
      ]}
    >
      {children}
    </PageFrame>
  )

  // The editor freezes its initial content on mount, so wait here for the
  // load to finish. Two leaves alone are not enough: while the common base is
  // still in flight the merge would find no ancestor and report everything as
  // a conflict.
  if (mergeRequested && space.loading) {
    return frame(<p className="text-base text-fg-muted">loading versions…</p>)
  }
  if (mergeRequested && !mergeMode) {
    return frame(
      <p className="text-base text-fg-muted">
        This page has only one version left — there is nothing to merge.
      </p>,
    )
  }
  let mergeContent: string | undefined
  let mergeNotice: string | undefined
  let mergeParents: string[] | undefined

  if (mergeMode) {
    const [mine, theirs] = page.leaves
    const ancestor = findCommonAncestor(page.revisions, mine, theirs)
    const merged = mergeThreeWay(ancestor?.content ?? '', mine.content, theirs.content, {
      mine: `version by ${displayNameOrNpub(mine.author)}`,
      theirs: `version by ${displayNameOrNpub(theirs.author)}`,
    })
    mergeContent = merged.content
    mergeParents = page.leaves.map((leaf) => leaf.id)
    mergeNotice =
      merged.status === 'conflict'
        ? `${page.leaves.length} versions, ${merged.conflicts} overlapping spot(s). ` +
          'Please resolve them in the text, remove the markers and save — the result will ' +
          'be a merge revision with both predecessors.'
        : ancestor
          ? 'The versions merged without any overlap. Please review and save; the result ' +
            'will be a merge revision with both predecessors.'
          : 'No common ancestor found — the versions came into being independently. ' +
            'Please assemble the text by hand.'
  }

  return frame(
    <>
      <PageEditor
        // Rebuild when switching between editing and merging: the initial
        // content is only read on mount.
        key={mergeMode ? `merge-${page.leaves.map((leaf) => leaf.id).join('-')}` : 'edit'}
        relayUrl={group.relayUrl}
        groupId={group.id}
        page={page}
        pages={space.pages}
        members={spacePeople(space)}
        initialContent={mergeContent}
        initialNotice={mergeNotice}
        overrideParents={mergeParents}
        onSaved={(saved) => navigate(`${base}/${saved}`)}
        onCancel={() => navigate(`${base}/${page.slug}`)}
      />
    </>,
  )
}
