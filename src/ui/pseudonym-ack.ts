import { useCallback, useState } from 'react'
import { useSession } from '../session/session'

const STORAGE_KEY = 'nc-pseudonym-ack'

/**
 * The npubs that have been told what an npub is.
 *
 * Keyed per pubkey rather than per browser on purpose. The notice is about what
 * *this identity* is committing to, and a browser is not an identity: a second
 * person signing in on the same machine — or the same person starting a second,
 * deliberately unlinked pseudonym — has never been told anything, and a flag
 * saying "somebody here has read it" would silently skip them.
 *
 * Storage is best effort. A private window may refuse it, in which case the
 * notice appears once per session instead of once per npub. That is the right
 * direction to fail in: showing it twice costs a click, skipping it costs the
 * one warning the app gives before somebody writes under their real name.
 */
export function readAcknowledged(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function acknowledge(pubkey: string): Set<string> {
  const next = readAcknowledged().add(pubkey)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
  } catch {
    /* then it only applies to this session */
  }
  return next
}

export type PseudonymNoticeState = {
  /** whether the dialog is up — the shell reads this to go `inert` behind it */
  open: boolean
  npub: string | null
  /** the deliberate act: records this npub as told, for good */
  confirm: () => void
  /** the way out that spends nothing: gone for this session, back on the next load */
  defer: () => void
}

/**
 * Whether this npub still has to be told, and the two ways out.
 *
 * It lives beside the storage rather than in `PseudonymNotice.tsx` because two
 * places need it: the dialog draws it, and the shell has to know it is up in
 * order to make everything behind it `inert`.
 */
export function usePseudonymNotice(): PseudonymNoticeState {
  const { session } = useSession()
  const pubkey = session.status === 'signed-in' ? session.pubkey : null
  const npub = session.status === 'signed-in' ? session.npub : null

  const [acknowledged, setAcknowledged] = useState(readAcknowledged)
  const [deferred, setDeferred] = useState<string | null>(null)

  const open = pubkey !== null && !acknowledged.has(pubkey) && deferred !== pubkey

  const confirm = useCallback(() => {
    if (!pubkey) return
    setAcknowledged(acknowledge(pubkey))
  }, [pubkey])

  const defer = useCallback(() => setDeferred(pubkey), [pubkey])

  return { open, npub, confirm, defer }
}
