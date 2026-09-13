import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { KINDS } from '../nostr/kinds'
import { client } from '../nostr/client'
import { DEFAULT_RELAY_URL, PROFILE_RELAYS } from '../nostr/relay-status'
import { createNip07Signer, getNip07Provider, waitForNip07 } from '../nostr/signer'
import type { Signer } from '../nostr/signer'
import { parseProfile, toNpub } from '../nostr/profile'
import { cacheProfile } from '../nostr/profile-store'
import { clearAllSpaces } from '../nostr/space-store'
import { attachmentLoaderFor, setAttachmentLoader } from '../nostr/attachment-access'
import type { Profile } from '../nostr/profile'

const STORAGE_KEY = 'nc-pubkey'

export type ExtensionState = 'checking' | 'available' | 'missing'

export type Session =
  | { status: 'anonymous' }
  | { status: 'signing-in' }
  | { status: 'signed-in'; pubkey: string; npub: string; signer: Signer; profile: Profile | null }

type SessionContextValue = {
  session: Session
  extension: ExtensionState
  error: string | null
  login: () => Promise<void>
  logout: () => void
  /** dismiss the sign-in error shown by SessionNotice */
  clearError: () => void
  /**
   * Call before every write. If somebody switches accounts in the extension,
   * we must not keep signing in the name of the old identity.
   * docs/03-auth-nip07-nip42.md
   */
  ensureSamePubkey: () => Promise<{ ok: true } | { ok: false; reason: string }>
  /**
   * Take over a profile that was just published, without asking a relay again.
   * A read straight after the write races the relay's indexing, and the answer
   * we would get back is the one we already hold.
   */
  applyProfile: (profile: Profile) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

function readStoredPubkey(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw && /^[0-9a-f]{64}$/.test(raw) ? raw : null
  } catch {
    return null
  }
}

function storePubkey(pubkey: string | null): void {
  try {
    if (pubkey) localStorage.setItem(STORAGE_KEY, pubkey)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* the session then only lasts until the next reload */
  }
}

/**
 * The single way to change identity: sign in, sign out, and the account switch
 * in the extension all go through here. Whatever a space still holds belongs to
 * the npub that fetched it — a private group's pages must not stay on screen or
 * in the search under the identity that follows.
 *
 * The order is not interchangeable. `setSigner` closes the connection first, so
 * the resubscribe inside `clearAllSpaces` can only ever run against a socket
 * that is no longer authenticated as the previous npub. Clearing first would
 * subscribe while the old AUTH still stands and let the events we just dropped
 * come straight back.
 */
function switchIdentity(signer: Signer | null): void {
  client.setSigner(signer)
  clearAllSpaces()
}

/** What another tab's change to the stored pubkey means for this one. */
export type TabSync =
  | { action: 'ignore' }
  | { action: 'sign-out' }
  | { action: 'adopt'; pubkey: string }

/**
 * Signing out is meant to end the session on this machine, not in the one tab
 * it was clicked in — a second tab that keeps a space on screen (and, through
 * `ensureSamePubkey`, keeps writing to it) defeats the point of the button.
 *
 * Pure so the table can be read in one go, because a wrong branch here fails
 * quietly: the tab simply stays signed in and nobody finds out.
 */
export function tabSync(
  /** the changed key, `null` when the whole storage was cleared at once */
  key: string | null,
  /** what the storage says now */
  stored: string | null,
  /** the pubkey this tab is signed in with, `null` when it is not */
  current: string | null,
  hasProvider: boolean,
): TabSync {
  if (key !== null && key !== STORAGE_KEY) return { action: 'ignore' }
  if (stored === null) return current === null ? { action: 'ignore' } : { action: 'sign-out' }
  if (stored === current) return { action: 'ignore' }
  // Somebody else's session now owns this machine. Without an extension this
  // tab cannot act as them, and staying with the previous identity is the one
  // thing it must not do.
  return hasProvider ? { action: 'adopt', pubkey: stored } : { action: 'sign-out' }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: 'anonymous' })
  const [extension, setExtension] = useState<ExtensionState>('checking')
  const [error, setError] = useState<string | null>(null)

  const loadProfile = useCallback(async (pubkey: string) => {
    const relays = [DEFAULT_RELAY_URL, ...PROFILE_RELAYS]
    const event = await client.getOne(relays, { kinds: [KINDS.PROFILE], authors: [pubkey] })
    if (!event) return
    const profile = parseProfile(event)
    setSession((current) =>
      current.status === 'signed-in' && current.pubkey === pubkey
        ? { ...current, profile }
        : current,
    )
  }, [])

  // Detect the extension and resume an earlier session. getPublicKey is
  // deliberately NOT called here: it opens an extension dialog and therefore
  // belongs on a click, not on page load.
  useEffect(() => {
    let cancelled = false
    void waitForNip07().then((provider) => {
      if (cancelled) return
      setExtension(provider ? 'available' : 'missing')
      const stored = readStoredPubkey()
      if (provider && stored) {
        const signer = createNip07Signer(provider)
        switchIdentity(signer)
        setSession({
          status: 'signed-in',
          pubkey: stored,
          npub: toNpub(stored),
          signer,
          profile: null,
        })
        void loadProfile(stored)
      }
    })
    return () => {
      cancelled = true
    }
  }, [loadProfile])

  // Attachment reads are signed with the session's key (CON-26). This is the
  // one place that decides whether a protected blob can be fetched at all;
  // signing out takes the credential away with the session.
  const activeSigner = session.status === 'signed-in' ? session.signer : null
  useEffect(() => {
    setAttachmentLoader(activeSigner ? attachmentLoaderFor(activeSigner) : null)
    return () => setAttachmentLoader(null)
  }, [activeSigner])

  // Follow the other tabs. The storage event fires only in the tabs that did
  // not make the change, which is exactly the reach this needs. Best effort,
  // not a guarantee: it needs localStorage to work (a private window may
  // refuse it) and a tab whose scripts are actually running, so nothing may be
  // built on top of it as if it were a lock.
  const currentPubkey = session.status === 'signed-in' ? session.pubkey : null
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      const sync = tabSync(event.key, readStoredPubkey(), currentPubkey, getNip07Provider() !== null)
      if (sync.action === 'ignore') return
      if (sync.action === 'sign-out') {
        switchIdentity(null)
        setSession({ status: 'anonymous' })
        setError(null)
        return
      }
      // No getPublicKey here: it would open an extension dialog in a tab
      // nobody is looking at. The pubkey comes from the storage, the same way
      // resuming a session on page load reads it.
      const provider = getNip07Provider()
      if (!provider) return
      const signer = createNip07Signer(provider)
      switchIdentity(signer)
      setSession({
        status: 'signed-in',
        pubkey: sync.pubkey,
        npub: toNpub(sync.pubkey),
        signer,
        profile: null,
      })
      void loadProfile(sync.pubkey)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [currentPubkey, loadProfile])

  const login = useCallback(async () => {
    setError(null)
    setSession({ status: 'signing-in' })
    try {
      const provider = getNip07Provider() ?? (await waitForNip07(3000))
      if (!provider) {
        setExtension('missing')
        setSession({ status: 'anonymous' })
        setError('No NIP-07 extension found.')
        return
      }
      setExtension('available')
      const signer = createNip07Signer(provider)
      const pubkey = await signer.getPublicKey()
      if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new Error('the extension returned no valid pubkey')
      storePubkey(pubkey)
      switchIdentity(signer)
      setSession({ status: 'signed-in', pubkey, npub: toNpub(pubkey), signer, profile: null })
      void loadProfile(pubkey)
    } catch (err) {
      setSession({ status: 'anonymous' })
      setError(err instanceof Error ? err.message : 'sign-in was cancelled')
    }
  }, [loadProfile])

  const logout = useCallback(() => {
    storePubkey(null)
    switchIdentity(null)
    setSession({ status: 'anonymous' })
    setError(null)
  }, [])

  const ensureSamePubkey = useCallback(async (): Promise<
    { ok: true } | { ok: false; reason: string }
  > => {
    if (session.status !== 'signed-in') return { ok: false, reason: 'not signed in' }
    try {
      const current = await session.signer.getPublicKey()
      if (current !== session.pubkey) {
        // No silent continuation: switch the session to the new identity. The
        // signer object is the same one — it is the extension behind it that
        // now answers as somebody else, which is a full identity change.
        storePubkey(current)
        switchIdentity(session.signer)
        setSession({
          status: 'signed-in',
          pubkey: current,
          npub: toNpub(current),
          signer: session.signer,
          profile: null,
        })
        void loadProfile(current)
        const reason = 'A different account is now active in the extension.'
        // Also on the session banner, not only back to the caller. Switching
        // identity empties the spaces, so the view that asked — an open editor,
        // say — may be gone by the time it could show anything: its page is no
        // longer in the store. The one explanation for a write that did not
        // happen must not be unmounted along with it.
        setError(reason)
        return { ok: false, reason }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'signer unreachable' }
    }
  }, [session, loadProfile])

  const clearError = useCallback(() => setError(null), [])

  const applyProfile = useCallback(
    (profile: Profile) => {
      if (session.status !== 'signed-in') return
      // The byline cache lives outside React and never expires by itself.
      cacheProfile(session.pubkey, profile)
      setSession((current) =>
        current.status === 'signed-in' ? { ...current, profile } : current,
      )
    },
    [session],
  )

  const value = useMemo(
    () => ({
      session,
      extension,
      error,
      login,
      logout,
      clearError,
      ensureSamePubkey,
      applyProfile,
    }),
    [session, extension, error, login, logout, clearError, ensureSamePubkey, applyProfile],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession needs a SessionProvider')
  return ctx
}
