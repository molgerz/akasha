import { useState } from 'react'
import { addMember, removeMember } from '../nostr/moderation'
import { classifyRejection } from '../nostr/client'
import { parsePubkeyInput } from '../nostr/profile'
import { Author } from './Author'
import { useSession } from '../session/session'
import { Button, Card, INPUT, SectionLabel } from './controls'
import { UsersIcon } from './icons'
import type { Admin } from '../domain/group-state'

type Props = {
  relayUrl: string
  groupId: string
  members: string[]
  admins: Admin[]
  loading: boolean
  /**
   * Add/remove live on the space's admin settings page
   * (`/settings/spaces/:group`) now, not the overview everyone lands on —
   * `false` there renders the list only, regardless of admin status.
   */
  showControls?: boolean
}

/**
 * Member administration. Every action is a request to the relay — it decides
 * whether they go through and then produces the new member list itself. That is
 * why the list here is never "corrected" locally.
 */
export function MemberAdmin({
  relayUrl,
  groupId,
  members,
  admins,
  loading,
  showControls = true,
}: Props) {
  const { session, ensureSamePubkey } = useSession()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const isAdmin =
    showControls &&
    session.status === 'signed-in' &&
    admins.some((admin) => admin.pubkey === session.pubkey)

  const run = async (label: string, action: () => Promise<{ ok: boolean; reason?: string }>) => {
    if (session.status !== 'signed-in') return
    setMessage(null)
    setBusy(label)
    try {
      const same = await ensureSamePubkey()
      if (!same.ok) {
        setMessage({ ok: false, text: same.reason })
        return
      }
      const result = await action()
      if (result.ok) {
        setMessage({ ok: true, text: 'The relay accepted the change.' })
        setInput('')
        return
      }
      const reason = result.reason ?? 'unknown'
      setMessage({
        ok: false,
        text:
          classifyRejection(reason) === 'permission'
            ? `The relay does not let you do that: ${reason}`
            : `Rejected: ${reason}`,
      })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'signing was cancelled' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <UsersIcon className="size-4 text-fg-subtle" />
        <SectionLabel>Members · {members.length}</SectionLabel>
      </div>

      {/* One row per member. The name is primary (CON-33); the key stays in
          the row's tooltip, where a check can be made without repeating the
          npub next to every name. docs/06-ui-information-architecture.md */}
      <Card>
        <ul className="divide-y divide-line">
          {members.map((pubkey) => {
            const roles = admins.find((admin) => admin.pubkey === pubkey)?.roles ?? []
            const self = session.status === 'signed-in' && pubkey === session.pubkey
            return (
              <li
                key={pubkey}
                className="group/member flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-xs"
              >
                <Author pubkey={pubkey} avatar />
                {roles.length > 0 ? (
                  <span className="rounded-full bg-surface-0 px-2 py-0.5 font-medium text-fg-muted">
                    {roles.join(', ')}
                  </span>
                ) : null}
                {self ? <span className="text-fg-subtle">you</span> : null}
                {isAdmin && session.status === 'signed-in' && !self ? (
                  <span className="ml-auto opacity-0 transition-opacity group-hover/member:opacity-100 focus-within:opacity-100">
                    <Button
                      size="sm"
                      variant="subtle"
                      className="text-danger hover:bg-danger-bg"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(pubkey, () =>
                          removeMember(session.signer, { relayUrl, groupId, pubkey }),
                        )
                      }
                    >
                      {busy === pubkey ? '…' : 'Remove'}
                    </Button>
                  </span>
                ) : null}
              </li>
            )
          })}
          {members.length === 0 ? (
            <li className="px-3.5 py-2.5 text-xs text-fg-subtle">
              {loading ? 'loading…' : 'The relay reports no member list.'}
            </li>
          ) : null}
        </ul>
      </Card>

      {isAdmin && session.status === 'signed-in' ? (
        <div className="mt-3 space-y-2">
          <label htmlFor="member" className="block text-xs font-medium text-fg-muted">
            Add a member
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="member"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="npub1… or a hex key"
              className={`${INPUT} min-w-0 flex-1 font-mono text-xs`}
            />
            <Button
              variant="primary"
              disabled={busy !== null}
              onClick={() => {
                const pubkey = parsePubkeyInput(input)
                if (!pubkey) {
                  setMessage({ ok: false, text: 'That is neither a valid npub nor a hex key.' })
                  return
                }
                void run('add', () => addMember(session.signer, { relayUrl, groupId, pubkey }))
              }}
            >
              {busy === 'add' ? 'sending…' : 'Add'}
            </Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className={`mt-3 text-xs ${message.ok ? 'text-success' : 'text-danger'}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  )
}
