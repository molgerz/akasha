import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../session/session'
import { SignInButton } from '../ui/SignInButton'
import { DEFAULT_RELAY_URL, useRelay } from '../nostr/relay-status'
import { classifyRejection } from '../nostr/client'
import { parseProfile, parseProfileContent } from '../nostr/profile'
import {
  loadOwnProfileEvent,
  preservedFields,
  profileWriteRelays,
  publishProfile,
} from '../nostr/publish-profile'
import type { ProfileDraft, RelayOutcome } from '../nostr/publish-profile'
import { PageFrame, PageTitle } from '../ui/layout/PageFrame'
import {
  Button,
  Callout,
  Card,
  INPUT,
  SectionLabel,
  TEXTAREA,
} from '../ui/controls'

const EMPTY: ProfileDraft = { name: '', about: '', picture: '' }

type Saved = { relays: RelayOutcome[]; ok: boolean }

/**
 * Editing one's own kind 0. Only the three fields NIP-01 names — everything
 * else another client has set is preserved unchanged, because kind 0 is
 * replaceable and a save replaces the whole profile.
 * docs/06-ui-information-architecture.md
 */
export function ProfileSettings() {
  const { session, ensureSamePubkey, applyProfile, logout } = useSession()
  const navigate = useNavigate()
  const { snapshot, info } = useRelay(DEFAULT_RELAY_URL)
  const pubkey = session.status === 'signed-in' ? session.pubkey : null

  const [existing, setExisting] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [error, setError] = useState<string | null>(null)

  const writeRelays = useMemo(() => profileWriteRelays(), [])
  const kept = useMemo(() => preservedFields(existing), [existing])

  useEffect(() => {
    if (!pubkey) return
    let cancelled = false
    setLoading(true)
    void loadOwnProfileEvent(pubkey)
      .then((event) => {
        if (cancelled) return
        setExisting(event?.content ?? null)
        const profile = event ? parseProfile(event) : null
        setDraft({
          name: profile?.name ?? '',
          about: profile?.about ?? '',
          picture: profile?.picture ?? '',
        })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [pubkey])

  const field = useCallback(
    (key: keyof ProfileDraft) => (value: string) => {
      setDraft((current) => ({ ...current, [key]: value }))
      setSaved(null)
    },
    [],
  )

  async function save() {
    if (session.status !== 'signed-in') return
    setSaving(true)
    setError(null)
    setSaved(null)
    try {
      // Somebody may have switched accounts in the extension since sign-in.
      const same = await ensureSamePubkey()
      if (!same.ok) {
        setError(same.reason)
        return
      }
      const result = await publishProfile(session.signer, existing, draft)
      if (result.reason && result.relays.length === 0) {
        setError(result.reason)
        return
      }
      setSaved({ relays: result.relays, ok: result.ok })
      if (result.ok) {
        // Only now is the profile the published one — not a moment earlier.
        setExisting(result.content)
        // Read back from what was signed, so a display_name set by another
        // client keeps showing instead of falling back to the npub.
        applyProfile(parseProfileContent(result.content))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'the extension refused to sign')
    } finally {
      setSaving(false)
    }
  }

  if (session.status !== 'signed-in') {
    return (
      <PageFrame crumbs={[{ label: 'Settings' }, { label: 'Profile' }]}>
        <PageTitle
          below={
            <p className="text-base text-fg-muted">
              A profile belongs to an npub, so it can only be edited while signed in.
            </p>
          }
        >
          Profile
        </PageTitle>
        <SignInButton>Sign in with Nostr</SignInButton>
      </PageFrame>
    )
  }

  const noRelay = writeRelays.length === 0

  return (
    <PageFrame crumbs={[{ label: 'Settings' }, { label: 'Profile' }]}>
      <PageTitle
        below={
          <p className="max-w-[62ch] text-base text-fg-muted">
            Your <code className="rounded bg-code-bg px-1 py-0.5 font-mono text-sm">kind 0</code>{' '}
            event — the name and picture other people see in bylines here and in every other
            Nostr client.
          </p>
        }
      >
        Profile
      </PageTitle>

      {/* The npub first and set apart: it is the one thing on this page that
          cannot be edited, and everything below is a claim attached to it. */}
      <Card className="mb-8 p-4">
        <div className="text-xs text-fg-subtle">This is the identity. It cannot be changed.</div>
        <div className="mt-1 font-mono text-xs break-all text-fg-muted">{session.npub}</div>
      </Card>

      {noRelay ? (
        <div className="mb-8">
          <Callout tone="warning" title="No relay for profiles configured">
            A NIP-29 relay rejects{' '}
            <code className="font-mono text-xs">kind 0</code>: it demands an{' '}
            <code className="font-mono text-xs">h</code> tag on every event. The profile
            therefore needs a relay of its own — set{' '}
            <code className="font-mono text-xs">VITE_PROFILE_RELAYS</code> and reload. Locally{' '}
            <code className="font-mono text-xs">nak serve --port 10577</code> does the job.
          </Callout>
        </div>
      ) : null}

      {loading ? (
        <p className="mb-4 text-sm text-fg-subtle">Reading the current profile…</p>
      ) : null}

      <div className="space-y-5">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-fg">Name</span>
          <span className="block text-xs text-fg-subtle">
            Freely chosen and not unique — shown as your name everywhere; your npub is
            in the tooltip and in full above.
          </span>
          <input
            value={draft.name}
            onChange={(event) => field('name')(event.target.value)}
            placeholder="how you want to be called"
            className={INPUT}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-fg">About</span>
          <span className="block text-xs text-fg-subtle">A short bio. Plain text.</span>
          <textarea
            value={draft.about}
            onChange={(event) => field('about')(event.target.value)}
            rows={4}
            placeholder="a few sentences about you"
            className={`${TEXTAREA} resize-y`}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-fg">Picture</span>
          <span className="block text-xs text-fg-subtle">
            A URL. The image is loaded from wherever it lies — pick a host you trust.
          </span>
          <span className="flex items-center gap-3">
            <input
              value={draft.picture}
              onChange={(event) => field('picture')(event.target.value)}
              placeholder="https://…"
              className={`${INPUT} min-w-0 flex-1 font-mono text-xs`}
            />
            <PicturePreview url={draft.picture} />
          </span>
        </label>
      </div>

      {kept.length > 0 ? (
        <p className="mt-4 text-xs text-fg-subtle">
          Kept unchanged, because this editor only writes the three NIP-01 fields:{' '}
          <span className="font-mono">{kept.join(', ')}</span>
        </p>
      ) : null}

      <div className="mt-5 flex items-center gap-3">
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={saving || loading || noRelay}
        >
          {saving ? 'publishing…' : 'Save profile'}
        </Button>
        <span className="text-xs text-fg-subtle">
          {noRelay ? 'nowhere to publish to' : `publishes to ${writeRelays.join(', ')}`}
        </span>
      </div>

      {error ? (
        <div className="mt-4">
          <Callout tone="danger" title="Not published">
            {error}
          </Callout>
        </div>
      ) : null}

      {saved ? (
        <div className="mt-4">
          <PublishReport saved={saved} />
        </div>
      ) : null}

      <section className="mt-10 border-t border-line pt-6">
        <SectionLabel className="mb-2">Connection</SectionLabel>
        <p className="max-w-[62ch] text-sm text-fg-muted">
          What this session is actually talking to. Relevant when a save fails: without a relay
          nothing can be published, and without AUTH a relay may answer with nothing at all.
        </p>
        <Card className="mt-3 p-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-fg-subtle">Signer</dt>
            <dd className="text-fg-muted">{session.signer.kind}</dd>
            <dt className="text-fg-subtle">Space relay</dt>
            <dd className="text-fg-muted">
              {info?.name ?? snapshot.url} — {snapshot.connection}
            </dd>
            <dt className="text-fg-subtle">NIP-42</dt>
            <dd className="text-fg-muted">
              {snapshot.auth}
              {snapshot.authMessage ? ` (${snapshot.authMessage})` : ''}
            </dd>
            <dt className="text-fg-subtle">Profile relays</dt>
            <dd className="font-mono text-fg-muted">
              {writeRelays.length > 0 ? writeRelays.join(', ') : 'none configured'}
            </dd>
          </dl>
        </Card>
      </section>

      {/* Last on the page and nowhere near the account chip in the top bar —
          the outermost corner of the layout should not put a destructive
          action next to a navigation target.
          docs/06-ui-information-architecture.md */}
      <section className="mt-10 border-t border-line pt-6">
        <SectionLabel className="mb-2">Sign out</SectionLabel>
        <p className="max-w-[62ch] text-sm text-fg-muted">
          Only forgets which npub is signed in here. Nothing is deleted: the key stays in your
          extension, and everything you have published stays on the relay.
        </p>
        <div className="mt-3">
          <Button
            variant="danger"
            onClick={() => {
              logout()
              navigate('/', { replace: true })
            }}
          >
            Sign out
          </Button>
        </div>
      </section>
    </PageFrame>
  )
}

function PicturePreview({ url }: { url: string }) {
  const trimmed = url.trim()
  const [broken, setBroken] = useState(false)

  useEffect(() => setBroken(false), [trimmed])

  if (!trimmed) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed border-line text-xs text-fg-subtle">
        —
      </span>
    )
  }
  if (broken) {
    return (
      <span
        title="the image could not be loaded"
        className="flex size-10 shrink-0 items-center justify-center rounded-full border border-danger text-xs text-danger"
      >
        !
      </span>
    )
  }
  return (
    <img
      src={trimmed}
      alt=""
      onError={() => setBroken(true)}
      className="size-10 shrink-0 rounded-full border border-line object-cover"
    />
  )
}

/**
 * With several relays "saved" is not one boolean. Every relay is listed with
 * the reason it gave, literally — a profile that only landed on one of two
 * relays is a state the user has to be able to see.
 */
function PublishReport({ saved }: { saved: Saved }) {
  return (
    <div className={`space-y-2 rounded-lg p-3.5 ${saved.ok ? 'bg-success-bg' : 'bg-danger-bg'}`}>
      <div className={`text-sm font-semibold ${saved.ok ? 'text-success' : 'text-danger'}`}>
        {saved.ok ? 'Profile published' : 'No relay stored the profile'}
      </div>
      <ul className="space-y-1">
        {saved.relays.map(({ url, result }) => (
          <li key={url} className="flex flex-wrap items-baseline gap-2 text-xs">
            <span className="font-mono text-fg-muted">{url}</span>
            {result.ok ? (
              <span className="text-fg-muted">{result.message}</span>
            ) : (
              <>
                <span className="text-fg-muted">{result.reason}</span>
                <span className="text-fg-subtle">({classifyRejection(result.reason)})</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
