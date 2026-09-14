import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { client } from './client'
import { KINDS } from './kinds'
import {
  GROUP_STATE_KINDS,
  parseAdmins,
  parseGroupMetadata,
  parseMembers,
} from '../domain/group-state'
import type { Admin, GroupMetadata } from '../domain/group-state'
import { parseRevision } from '../domain/revision'
import type { Revision } from '../domain/revision'
import { newerPlacement, parsePlacement } from '../domain/placement'
import type { Placement } from '../domain/placement'
import { buildPages, buildTree } from '../domain/pages'
import type { Page, PageNode } from '../domain/pages'
import { parseComment } from '../domain/comment'
import type { Comment } from '../domain/comment'
import { parseDeletion } from '../domain/deletion'
import type { Deletion } from '../domain/deletion'
import type { Event } from 'nostr-tools'

export type SpaceSnapshot = {
  loading: boolean
  metadata: GroupMetadata | null
  admins: Admin[]
  members: string[]
  pages: Page[]
  tree: PageNode[]
  comments: Comment[]
  /** revisions their author asked the relay to delete, newest first */
  removedRevisions: Revision[]
}

const EMPTY: SpaceSnapshot = {
  loading: true,
  metadata: null,
  admins: [],
  members: [],
  pages: [],
  tree: [],
  comments: [],
  removedRevisions: [],
}

/**
 * Holds the state of one space: the group state produced by the relay and all
 * revision events. Pages and the page tree are derived from those — there is no
 * separate index event that could go stale.
 * docs/02-data-model-events.md
 */
class SpaceStore {
  private snapshot: SpaceSnapshot = EMPTY
  private listeners = new Set<() => void>()
  private revisions = new Map<string, Revision>()
  /** the winning placement per slug — src/domain/placement.ts */
  private placements = new Map<string, Placement>()
  private comments = new Map<string, Comment>()
  private deletions = new Map<string, Deletion>()
  private metadataEvent: Event | null = null
  private stop: (() => void)[] = []
  private epoch = -1
  /** the AUTH state the current subscriptions were opened under */
  private auth = ''
  private eoseSeen = 0
  private groupEventAt = new Map<number, number>()

  constructor(
    private relayUrl: string,
    private groupId: string,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        // wait briefly: React mounts twice in StrictMode
        window.setTimeout(() => {
          if (this.listeners.size === 0) this.close()
        }, 500)
      }
    }
  }

  getSnapshot(): SpaceSnapshot {
    return this.snapshot
  }

  /**
   * Forget an event the relay deleted. The relay does not announce deletions,
   * so whoever triggered it has to tell us.
   */
  forget(eventId: string): void {
    const hadRevision = this.revisions.delete(eventId)
    const hadComment = this.comments.delete(eventId)
    if (hadRevision) this.rebuildPages()
    if (hadComment) this.emit({ comments: [...this.comments.values()] })
  }

  /**
   * Drop everything this space holds. Called on every identity change, not
   * only on sign-out: a private group's pages must not keep showing (or stay
   * searchable) under the identity that follows, just because they are still
   * sitting in these Maps.
   *
   * Resubscribing is part of it. A signer change already restarts the store via
   * `checkConnection`, but that runs before this and would leave the cleared
   * store with no subscription at all.
   */
  reset(): void {
    this.dropCollected()
    if (this.listeners.size > 0) this.start()
  }

  /**
   * Forget what the current subscriptions delivered.
   *
   * Nothing else ever takes an event back out: `applyRevision` and its
   * siblings only add, and an empty answer is indistinguishable from a
   * request that returned everything it was allowed to. So whatever is in
   * these Maps stays until something drops it on purpose — which is why every
   * new round of subscriptions has to start from nothing.
   */
  private dropCollected(): void {
    this.revisions.clear()
    this.placements.clear()
    this.comments.clear()
    this.deletions.clear()
    this.metadataEvent = null
    this.groupEventAt.clear()
    if (this.snapshot === EMPTY) return
    this.snapshot = EMPTY
    for (const listener of this.listeners) listener()
  }

  private rebuildPages(): void {
    const revisions = [...this.revisions.values()]
    const deleted = this.effectiveDeleted()
    const pages = buildPages(revisions, this.placements, deleted)
    const removedRevisions = revisions
      .filter((revision) => deleted.has(revision.id))
      .sort((a, b) => b.createdAt - a.createdAt)
    this.emit({ pages, tree: buildTree(pages), removedRevisions })
  }

  /**
   * The revision ids a valid NIP-09 request actually removes. The relay does
   * not enforce this, so the gate is ours: a request counts only against the
   * requester's own revision, and only once that revision is loaded. Deriving
   * the set on every rebuild instead of storing it keeps the result
   * independent of the order in which the revision and the request arrive.
   */
  private effectiveDeleted(): Set<string> {
    const deleted = new Set<string>()
    for (const deletion of this.deletions.values()) {
      for (const target of deletion.targets) {
        const revision = this.revisions.get(target)
        if (revision && revision.author === deletion.author) deleted.add(target)
      }
    }
    return deleted
  }

  /**
   * Subscriptions die with their connection and with every signer change (AUTH
   * is per connection). Detect both here and set them up again — otherwise the
   * app silently shows stale data after a relay restart.
   *
   * The AUTH state counts too. A relay may answer a request from an
   * unauthenticated reader with silence rather than `auth-required`, and a
   * subscription cannot tell that apart from a genuinely empty space — so a
   * request that went out too early stays empty for as long as it lives. The
   * connection waits for AUTH before it raises the epoch, and this catches the
   * rest: an AUTH that lands late, or one repeated after a write.
   *
   * Deliberately no third signal for "the signer changed". A counter bumped
   * inside `setSigner()` fired before the reconnect it queued had run, so it
   * could only ever start a round against the connection that was being
   * replaced (CON-36). The synchronous `auth` patch is safe to react to only
   * because `start()` refuses to subscribe until the connection is ready.
   */
  checkConnection(): void {
    if (this.listeners.size === 0) return
    const { epoch, auth, ready } = client.getSnapshot(this.relayUrl)

    // 'pending' is a transient on the way to 'ok': restarting on it would only
    // fire a round of requests as unauthenticated as the one before. It counts
    // as "no change" rather than as a reason to stop looking, though — a
    // signature that never comes back would otherwise leave this store waiting
    // for good, and the idle check below is exactly what rescues it.
    const changed = auth !== 'pending' && (this.epoch !== epoch || this.auth !== auth)

    // Usable connection, nothing subscribed on it. That is where a store gets
    // stranded: `start` has to bail while a connection is being rebuilt, and
    // if the moment it becomes ready passes while this store is not listening,
    // there is no second announcement to wait for — a settled connection sends
    // nothing further, and the space would sit on "loading" until a reload.
    // So the state is checked here, not only the change.
    const idle = ready && this.stop.length === 0 && this.groupId.length > 0

    if (changed || idle) this.start()
  }

  private start(): void {
    this.close()
    // Everything collected so far came from the subscriptions just closed —
    // over a connection, and under an identity, that may both be gone. Signing
    // out is exactly that case: the requests still in flight while the old
    // authenticated socket winds down deliver a last load of pages, and no
    // later empty answer would ever remove them again. A new round re-delivers
    // whatever the viewer may still see, so keeping the old events cannot fill
    // a gap — it can only keep showing what the relay now refuses to send.
    this.dropCollected()
    // Without a group id there is nothing to subscribe to (e.g. on /login).
    if (this.groupId.length === 0) {
      if (this.snapshot.loading) this.emit({ loading: false })
      return
    }
    const connection = client.getSnapshot(this.relayUrl)
    // Never subscribe onto a connection that is being rebuilt. Until it is
    // ready the pool may still hand out the previous socket, which stays
    // authenticated as the identity we are leaving until it has finished
    // closing — requests on it come back full, and they would come back into
    // the round we just started, where nothing clears them again. Leaving here
    // without stamping keeps `loading` true and makes `checkConnection` try
    // again on the next change; the epoch rises once the connection is up and
    // authenticated.
    if (!connection.ready) return
    this.epoch = connection.epoch
    this.auth = connection.auth
    this.eoseSeen = 0
    if (!this.snapshot.loading) this.emit({ loading: true })

    const onEose = () => {
      this.eoseSeen += 1
      if (this.eoseSeen >= 5) this.emit({ loading: false })
    }

    this.stop.push(
      client.subscribe(
        this.relayUrl,
        { kinds: [...GROUP_STATE_KINDS], '#d': [this.groupId] },
        (event) => this.applyGroupEvent(event),
        onEose,
      ),
      client.subscribe(
        this.relayUrl,
        { kinds: [KINDS.PAGE_REVISION], '#h': [this.groupId] },
        (event) => this.applyRevision(event),
        onEose,
      ),
      client.subscribe(
        this.relayUrl,
        { kinds: [KINDS.COMMENT], '#h': [this.groupId] },
        (event) => this.applyComment(event),
        onEose,
      ),
      client.subscribe(
        this.relayUrl,
        { kinds: [KINDS.PAGE_PLACEMENT], '#h': [this.groupId] },
        (event) => this.applyPlacement(event),
        onEose,
      ),
      client.subscribe(
        this.relayUrl,
        { kinds: [KINDS.DELETION_REQUEST], '#h': [this.groupId] },
        (event) => this.applyDeletion(event),
        onEose,
      ),
    )
  }

  private close(): void {
    for (const stop of this.stop) stop()
    this.stop = []
  }

  private applyGroupEvent(event: Event): void {
    if (event.kind === KINDS.GROUP_METADATA) {
      if (this.metadataEvent && this.metadataEvent.created_at > event.created_at) return
      this.metadataEvent = event
      this.emit({ metadata: parseGroupMetadata(event, this.groupId) })
    } else if (event.kind === KINDS.GROUP_ADMINS) {
      if (this.isOutdated(event)) return
      this.emit({ admins: parseAdmins(event) })
    } else if (event.kind === KINDS.GROUP_MEMBERS) {
      if (this.isOutdated(event)) return
      this.emit({ members: parseMembers(event) })
    }
  }

  /**
   * Relays do not necessarily deliver in chronological order. Without this
   * check an older member list could overwrite a newer one.
   */
  private isOutdated(event: Event): boolean {
    const seen = this.groupEventAt.get(event.kind)
    if (seen !== undefined && seen > event.created_at) return true
    this.groupEventAt.set(event.kind, event.created_at)
    return false
  }

  private applyRevision(event: Event): void {
    if (this.revisions.has(event.id)) return
    const revision = parseRevision(event, this.groupId)
    if (!revision) return
    this.revisions.set(event.id, revision)
    this.rebuildPages()
  }

  /**
   * Addressable events are replaced per author, so a page can have one
   * placement per pubkey. Keep the one that counts instead of whichever
   * arrived last — relays deliver in no particular order.
   */
  private applyPlacement(event: Event): void {
    const placement = parsePlacement(event, this.groupId)
    if (!placement) return
    const current = this.placements.get(placement.slug)
    const winner = current ? newerPlacement(current, placement) : placement
    if (current && winner.id === current.id) return
    this.placements.set(placement.slug, winner)
    this.rebuildPages()
  }

  private applyComment(event: Event): void {
    if (this.comments.has(event.id)) return
    const comment = parseComment(event, this.groupId)
    if (!comment) return
    this.comments.set(event.id, comment)
    this.emit({ comments: [...this.comments.values()] })
  }

  /**
   * A NIP-09 request. It is kept as a deletion and re-applied on every rebuild,
   * so a revision that arrives after its request is still skipped and the
   * removal is re-derived from the relay on the next round rather than living
   * only in local state.
   *
   * "Tombstone" is deliberately not used for this: in this codebase that word
   * belongs to `TAGS.TOMBSTONE`, a revision that hides its whole page, which is
   * a different thing entirely. src/nostr/kinds.ts
   */
  private applyDeletion(event: Event): void {
    if (this.deletions.has(event.id)) return
    const deletion = parseDeletion(event, this.groupId)
    if (!deletion) return
    this.deletions.set(event.id, deletion)
    this.rebuildPages()
  }

  private emit(change: Partial<SpaceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change }
    for (const listener of this.listeners) listener()
  }
}

const stores = new Map<string, SpaceStore>()

export function getSpaceStore(relayUrl: string, groupId: string): SpaceStore {
  const key = `${relayUrl}'${groupId}`
  let store = stores.get(key)
  if (!store) {
    store = new SpaceStore(relayUrl, groupId)
    stores.set(key, store)
  }
  return store
}

/** Removes a deleted event from the local state. */
export function forgetEvent(relayUrl: string, groupId: string, eventId: string): void {
  getSpaceStore(relayUrl, groupId).forget(eventId)
}

/**
 * Clears every space this tab has loaded. Belongs to every identity change —
 * see `switchIdentity` in src/session/session.tsx, which owns the ordering.
 */
export function clearAllSpaces(): void {
  for (const store of stores.values()) store.reset()
}

export function useSpace(relayUrl: string, groupId: string): SpaceSnapshot {
  const store = getSpaceStore(relayUrl, groupId)
  // Has to be memoised: with a new function identity useSyncExternalStore
  // resubscribes, which would restart the store — an endless loop.
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store])
  const getSnapshot = useCallback(() => store.getSnapshot(), [store])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  // After sign-in/sign-out and after every reconnect the subscriptions have to
  // be rebuilt. Checking once on mount as well, because the connection may have
  // become usable while this store had no listeners — waiting for the next
  // change would then be waiting for something that has already happened.
  useEffect(() => {
    store.checkConnection()
    return client.subscribeState(() => store.checkConnection())
  }, [store])
  return snapshot
}
