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
