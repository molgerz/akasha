import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addMember, createGroupAndWait, editMetadata } from '../nostr/moderation'
import { BLOSSOM_SERVICE_PUBKEY } from '../nostr/blossom'
import { classifyRejection } from '../nostr/client'
import { APP_CONTENT_KINDS, normalizeSlug } from '../nostr/kinds'
import { DEFAULT_RELAY_URL } from '../nostr/relay-status'
import { useSession } from '../session/session'
import { SignInButton } from './SignInButton'
import { Button, Callout, Card, INPUT, SectionLabel, TEXTAREA } from './controls'
import { PlusIcon } from './icons'

const LOCAL_HOST = DEFAULT_RELAY_URL.replace(/^wss?:\/\//, '')

/**
 * Creates a space: `9007` (create-group), then `9002` with a name and the
 * invite-only flags — a group without that second step would sit there as
 * `private`+`closed` but not `restricted`, letting non-members publish into
 * it. docs/04-permissions-nip29.md
 */
export function CreateSpaceForm() {
  const { session, ensureSamePubkey } = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set once the relay accepted the 9007, so the space exists even if a later
  // step failed — the user always gets a way into it.
  const [createdAddress, setCreatedAddress] = useState<string | null>(null)

  if (!open) {
    return (
      <Button variant="subtle" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4" />
        Create a space
      </Button>
    )
  }

  if (session.status !== 'signed-in') {
    return (
      <Card className="p-4">
        <p className="text-sm text-fg-muted">
          <SignInButton variant="inline">Sign in</SignInButton> to create a space.
        </p>
      </Card>
    )
  }

  const groupId = normalizeSlug(name)
  const address = `${LOCAL_HOST}'${groupId}`

  const create = async () => {
    setError(null)
    setCreatedAddress(null)
    if (name.trim().length === 0) {
      setError('Give the space a name.')
      return
    }
    if (groupId.length === 0) {
      setError('No id can be derived from this name — please use letters or digits.')
      return
    }

    setBusy(true)
    try {
      const same = await ensureSamePubkey()
      if (!same.ok) {
        setError(same.reason)
        return
      }

      const base = { relayUrl: DEFAULT_RELAY_URL, groupId }
      const created = await createGroupAndWait(session.signer, base)
      if (!created.ok) {
        const kind = classifyRejection(created.reason)
        setError(
          kind === 'auth'
            ? `The relay requires authentication (NIP-42): ${created.reason}`
            : `Not created: ${created.reason}`,
        )
        return
      }

      // The relay accepted the 9007, so the space exists even when its 39000 was
      // not queryable in time. Try to set the metadata anyway; if that fails too,
      // keep the space reachable (createdAddress) instead of dead-ending on a
      // "not created" that is not true.
      const metadata = await editMetadata(session.signer, {
        ...base,
        name: name.trim(),
        about: about.trim() || undefined,
        supportedKinds: APP_CONTENT_KINDS,
      })
      if (!metadata.ok) {
        setCreatedAddress(address)
        setError(
          `The space was created, but its metadata was not: ${metadata.reason}. ` +
            (created.settled
              ? 'It may be missing its name and invite-only flags.'
              : 'The relay was still indexing the new space when we tried to name it.'),
        )
        return
      }

      // The Blossom server reads a private group's member list to answer "may
      // this reader have the attachment?", so its service identity has to be a
      // member of every space that stores files. Best effort: if it fails, an
      // admin can still add the pubkey later, and only attachment reads are
      // affected. CON-26
      if (BLOSSOM_SERVICE_PUBKEY) {
        await addMember(session.signer, { ...base, pubkey: BLOSSOM_SERVICE_PUBKEY })
      }

      navigate(`/s/${encodeURIComponent(address)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'signing was cancelled')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <SectionLabel>Create a space</SectionLabel>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void create()
        }}
      >
        <div>
          <label htmlFor="space-name" className="mb-1 block text-xs font-medium text-fg-muted">
            Name
          </label>
          <input
            id="space-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Engineering"
            className={INPUT}
            autoFocus
          />
          {name.trim().length > 0 ? (
            <p className="mt-1 truncate font-mono text-xs text-fg-subtle">{address}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="space-about" className="mb-1 block text-xs font-medium text-fg-muted">
            Description (optional)
          </label>
          <textarea
            id="space-about"
            value={about}
            onChange={(event) => setAbout(event.target.value)}
            rows={2}
            className={TEXTAREA}
          />
        </div>

        <p className="text-xs text-fg-subtle">
          Invite-only: only npubs an admin adds can read or write here. You become the first
          admin.
        </p>

        {error ? <Callout tone="danger">{error}</Callout> : null}

        <div className="flex gap-2">
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? 'creating…' : 'Create space'}
          </Button>
          {createdAddress ? (
            <Button
              variant="default"
              disabled={busy}
              onClick={() => navigate(`/s/${encodeURIComponent(createdAddress)}`)}
            >
              Open the space
            </Button>
          ) : null}
          <Button
            variant="subtle"
            disabled={busy}
            onClick={() => {
              setOpen(false)
              setError(null)
              setCreatedAddress(null)
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
