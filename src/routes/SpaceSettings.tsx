import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useSpaceRoute } from './space-route'
import { useSession } from '../session/session'
import { editMetadata } from '../nostr/moderation'
import { classifyRejection } from '../nostr/client'
import { APP_CONTENT_KINDS } from '../nostr/kinds'
import { SignInButton } from '../ui/SignInButton'
import { MemberAdmin } from '../ui/MemberAdmin'
import { PageTreeMaintenance } from '../ui/PageTreeMaintenance'
import { PageFrame, PageTitle } from '../ui/layout/PageFrame'
import { Button, Callout, INPUT, TEXTAREA } from '../ui/controls'

/**
 * The route element for /settings/spaces/:group. Keyed by the group address
 * so a navigation from one space's settings to another's is a fresh mount:
 * without the key React reuses the component, `initialized` stays true and
 * the fields keep the previous space's name while `group` already points at
 * the new one — a save would then overwrite the new space's metadata with the
 * old one's. Found in the 2026-09-11 review.
 */
export function SpaceSettingsRoute() {
  const params = useParams<{ group?: string }>()
  return <SpaceSettings key={params.group} />
}

/**
 * Everything that needs an admin: name and description (sent as a fresh
 * `9002` — the private/closed/restricted flags are not exposed, `editMetadata`
 * re-asserts them regardless of input, because invite-only is a decision for
 * the whole app, not a per-space setting, docs/04-permissions-nip29.md) and
 * member administration, moved here from the overview everyone lands on —
 * `MemberAdmin` there is list-only (`showControls={false}`).
 */
export function SpaceSettings() {
  const { group, space, base } = useSpaceRoute()
  const { session, ensureSamePubkey } = useSession()

  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Metadata loads asynchronously from the store; take it over once, so a
  // later live update (e.g. this very save) does not clobber unsaved typing.
  useEffect(() => {
    if (initialized || !space.metadata) return
    setName(space.metadata.name)
    setAbout(space.metadata.about ?? '')
    setInitialized(true)
  }, [initialized, space.metadata])

  if (!group || !base) {
    return (
      <PageFrame>
        <p className="text-sm text-danger">Invalid group address.</p>
      </PageFrame>
    )
  }

  const spaceName = space.metadata?.name ?? group.id
  const crumbs = [
    { label: 'Settings', to: '/settings/profile' },
    { label: 'Spaces', to: '/settings/spaces' },
    { label: spaceName },
  ]

  if (session.status !== 'signed-in') {
    return (
      <PageFrame crumbs={crumbs}>
        <PageTitle>{spaceName}</PageTitle>
        <SignInButton>Sign in with Nostr</SignInButton>
      </PageFrame>
    )
  }

  const isAdmin = space.admins.some((admin) => admin.pubkey === session.pubkey)
  if (!isAdmin) {
    return (
      <PageFrame crumbs={crumbs}>
        <PageTitle
          below={
            <p className="text-base text-fg-muted">
              {space.loading
                ? 'loading group state…'
                : 'Only an admin of this space may change its metadata.'}
            </p>
          }
        >
          {spaceName}
        </PageTitle>
      </PageFrame>
    )
  }

  const save = async () => {
    setError(null)
    setSaved(false)
    if (name.trim().length === 0) {
      setError('Give the space a name.')
      return
    }
    setSaving(true)
    try {
      const same = await ensureSamePubkey()
      if (!same.ok) {
        setError(same.reason)
        return
      }
      const result = await editMetadata(session.signer, {
        relayUrl: group.relayUrl,
        groupId: group.id,
        name: name.trim(),
        about: about.trim() || undefined,
        supportedKinds: APP_CONTENT_KINDS,
      })
      if (!result.ok) {
        const kind = classifyRejection(result.reason)
        setError(
          kind === 'permission'
            ? `The relay does not let you do that: ${result.reason}`
            : `Not saved: ${result.reason}`,
        )
        return
      }
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'signing was cancelled')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageFrame crumbs={crumbs}>
      <PageTitle
        below={
          <p className="max-w-[60ch] text-base text-fg-muted">
            Sent as a fresh <code className="rounded bg-code-bg px-1 py-0.5 font-mono text-sm">9002</code>.
            The invite-only flags (private, closed, restricted) are re-asserted on every save —
            this space cannot be made public from here.
          </p>
        }
      >
        {spaceName}
      </PageTitle>

      <div className="max-w-lg space-y-5">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-fg">Name</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setSaved(false)
            }}
            className={INPUT}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-fg">Description</span>
          <textarea
            value={about}
            onChange={(event) => {
              setAbout(event.target.value)
              setSaved(false)
            }}
            rows={3}
            className={`${TEXTAREA} resize-y`}
          />
        </label>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button variant="primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'publishing…' : 'Save'}
        </Button>
      </div>

      {error ? (
        <div className="mt-4 max-w-lg">
          <Callout tone="danger" title="Not saved">
            {error}
          </Callout>
        </div>
      ) : null}

      {saved ? (
        <div className="mt-4 max-w-lg">
          <Callout tone="success" title="Saved">
            The relay accepted the new metadata.
          </Callout>
        </div>
      ) : null}

      <div className="mt-10 max-w-lg border-t border-line pt-8">
        <PageTreeMaintenance
          relayUrl={group.relayUrl}
          groupId={group.id}
          pages={space.pages}
          orphanPlacements={space.orphanPlacements}
        />
      </div>

      <div className="mt-10 max-w-lg border-t border-line pt-8">
        <MemberAdmin
          relayUrl={group.relayUrl}
          groupId={group.id}
          members={space.members}
          admins={space.admins}
          loading={space.loading}
        />
      </div>
    </PageFrame>
  )
}
