// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KINDS } from './kinds'
import type { Event, Filter } from 'nostr-tools'

type Sub = { url: string; filter: Filter; onEvent: (event: Event) => void; onEose: () => void }

// vi.mock is hoisted above the imports, so the registry the factory writes to
// has to be hoisted with it.
const relay = vi.hoisted(() => ({
  subs: [] as Sub[],
  epoch: 1,
  auth: 'ok',
  ready: true,
}))

vi.mock('./client', () => ({
  client: {
    getSnapshot: () => ({ epoch: relay.epoch, auth: relay.auth, ready: relay.ready }),
    subscribe: (url: string, filter: Filter, onEvent: Sub['onEvent'], onEose: Sub['onEose']) => {
      relay.subs.push({ url, filter, onEvent, onEose })
      return () => {}
    },
    subscribeState: () => () => {},
  },
}))

const { clearAllSpaces, getSpaceStore } = await import('./space-store')

const RELAY = 'wss://relay.test'
const GROUP = 'engineering'

function revision(
  id: string,
  slug: string,
  parentRevs: string[] = [],
  pubkey = 'alice',
  createdAt = 1000,
): Event {
  return {
    id,
    pubkey,
    created_at: createdAt,
    kind: KINDS.PAGE_REVISION,
    tags: [
      ['h', GROUP],
      ['d', slug],
      ...parentRevs.map((parent) => ['parent-rev', parent]),
    ],
    content: '# secret',
    sig: 'sig',
  } as Event
}

/** A NIP-09 request for the given revision ids. */
function deletion(id: string, pubkey: string, targets: string[]): Event {
  return {
    id,
    pubkey,
    created_at: 2000,
    kind: KINDS.DELETION_REQUEST,
    tags: [
      ['h', GROUP],
      ['k', String(KINDS.PAGE_REVISION)],
      ...targets.map((target) => ['e', target]),
    ],
    content: '',
    sig: 'sig',
  } as Event
}

/** Hands an event to whichever subscription asked for its kind. */
function deliver(event: Event, subs: Sub[] = relay.subs): void {
  for (const sub of subs) {
    if (sub.filter.kinds?.includes(event.kind)) sub.onEvent(event)
  }
}

describe('clearAllSpaces', () => {
  beforeEach(() => {
    // Unsubscribing defers the actual close by 500ms (StrictMode mounts
    // twice). Nothing here asserts on that, and letting it fire after the test
    // has finished only leaves work running in a torn-down environment.
    vi.useFakeTimers()
    relay.subs = []
    relay.epoch = 1
    relay.auth = 'ok'
    relay.ready = true
    clearAllSpaces()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // The leak this guards against: sign-out (or an account switch in the
  // extension) leaves a private group's pages sitting in the store, where the
  // tree and the search keep showing them to whoever comes next.
  it('drops the pages a previous identity fetched', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})
    deliver(revision('e1', 'onboarding'))
    expect(store.getSnapshot().pages).toHaveLength(1)

    clearAllSpaces()

    expect(store.getSnapshot().pages).toEqual([])
    expect(store.getSnapshot().metadata).toBeNull()
    unsubscribe()
  })

  it('keeps listening, so the next identity still gets its own space', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})
    deliver(revision('e1', 'onboarding'))

    const before = relay.subs.length
    clearAllSpaces()
    // Only the subscriptions reset() opened afterwards, so this proves the
    // store resubscribed rather than the old ones still being wired up.
    const fresh = relay.subs.slice(before)
    expect(fresh.length).toBeGreaterThan(0)
    deliver(revision('e2', 'handbook'), fresh)

    const { pages } = store.getSnapshot()
    expect(pages.map((page) => page.slug)).toEqual(['handbook'])
    unsubscribe()
  })

  // What signing out actually looked like: reset() emptied the Maps, but the
  // requests still in flight over the old authenticated socket delivered one
  // more load of pages, and nothing ever removed those again — the sidebar
  // kept its tree and every page kept its content for an anonymous viewer.
  it('drops what an earlier round delivered when the subscriptions restart', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})
    const stale = relay.subs.slice()
    deliver(revision('e1', 'onboarding'), stale)
    expect(store.getSnapshot().pages).toHaveLength(1)

    // The connection comes back under a new identity; the store notices and
    // rebuilds its subscriptions.
    relay.epoch = 2
    store.checkConnection()

    // The relay serves an anonymous reader nothing at all: no events, and the
    // old ones must not stand in for them.
    expect(store.getSnapshot().pages).toEqual([])
    expect(store.getSnapshot().tree).toEqual([])
    unsubscribe()
  })

  it('ignores what a closed round delivers late', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})
    const stale = relay.subs.slice()

    relay.epoch = 2
    store.checkConnection()
    // The old subscription is closed but its callback still exists — a request
    // that was in flight when the socket went down lands here.
    deliver(revision('e1', 'onboarding'), stale)

    // It is still collected (the callback cannot know), but the next restart
    // clears it rather than carrying it into the new identity's view.
    relay.epoch = 3
    store.checkConnection()
    expect(store.getSnapshot().pages).toEqual([])
    unsubscribe()
  })

  // Switching accounts in the extension and then signing out and back in
  // quickly: the connection is torn down and rebuilt twice over, and while it
  // is, the pool still hands out the socket authenticated as the account
  // before. Subscribing into that window filled the store with pages the new
  // npub may not see, and no later round took them back out.
  it('opens no subscription while the connection is being rebuilt', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})
    relay.subs = []

    // What setSigner() patches synchronously: the connection is withdrawn
    // before the reconnect it queued has run.
    relay.ready = false
    relay.auth = 'none'
    store.checkConnection()

    expect(relay.subs).toEqual([])
    // Still loading, so nothing claims the space is empty or hidden either.
    expect(store.getSnapshot().loading).toBe(true)
    unsubscribe()
  })

  it('subscribes as soon as the rebuilt connection is authenticated', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})
    relay.subs = []

    relay.ready = false
    relay.auth = 'none'
    store.checkConnection()
    expect(relay.subs).toEqual([])

    relay.ready = true
    relay.auth = 'ok'
    relay.epoch = 2
    store.checkConnection()

    expect(relay.subs.length).toBeGreaterThan(0)
    deliver(revision('e2', 'handbook'))
    expect(store.getSnapshot().pages.map((page) => page.slug)).toEqual(['handbook'])
    unsubscribe()
  })

  // What left tab B on "loading pages…" until a reload: start() bailed on a
  // connection that was still being rebuilt, and by the time it was ready
  // again nothing was listening. A settled connection announces nothing
  // further, so waiting for the next change means waiting forever.
  it('picks up a connection that became ready unannounced', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})
    expect(relay.subs.length).toBeGreaterThan(0)

    // Torn down: the subscriptions are closed and nothing is opened, because
    // the connection is being rebuilt.
    relay.ready = false
    relay.epoch = 2
    store.checkConnection()
    relay.subs = []
    store.checkConnection()
    expect(relay.subs).toEqual([])

    // It comes back looking exactly like what this store last subscribed
    // under, so there is no change left to notice — the mock reproduces that
    // by restoring the values start() stamped. Only the state itself still
    // says anything, and without reading it the space waits for an
    // announcement that a settled connection never sends.
    relay.epoch = 1
    relay.ready = true
    store.checkConnection()

    expect(relay.subs.length).toBeGreaterThan(0)
    deliver(revision('e1', 'onboarding'))
    expect(store.getSnapshot().pages).toHaveLength(1)
    unsubscribe()
  })

  it('keeps looking even while a signature is outstanding', () => {
    const store = getSpaceStore(RELAY, GROUP)
    relay.ready = false
    const unsubscribe = store.subscribe(() => {})
    relay.subs = []

    // An AUTH the extension never answers leaves this hanging. It must not
    // stop the store from subscribing once the connection is usable.
    relay.auth = 'pending'
    relay.ready = true
    store.checkConnection()

    expect(relay.subs.length).toBeGreaterThan(0)
    unsubscribe()
  })

  // The review asked for this one by name: the store has to rebuild its
  // subscriptions when AUTH settles, exactly once, and not on the transient
  // 'pending' on the way there or on every later patch. Without it a private
  // space reads as empty for the admin who just signed in, forever.
  it('restarts once when AUTH settles, not on the way there', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})
    expect(relay.subs.length).toBeGreaterThan(0)

    // Signing out first: the round that is open went out as the old identity.
    relay.auth = 'none'
    const beforeDrop = relay.subs.length
    store.checkConnection()
    const oneRound = relay.subs.length - beforeDrop
    expect(oneRound, 'the drop starts one new round').toBeGreaterThan(0)

    // 'pending' is the transient on the way back. A round opened here would be
    // as unauthenticated as the one before it.
    relay.auth = 'pending'
    const beforePending = relay.subs.length
    store.checkConnection()
    expect(relay.subs.length, 'pending is not a reason to restart').toBe(beforePending)

    // AUTH settles: one new round, this time authenticated.
    relay.auth = 'ok'
    const beforeOk = relay.subs.length
    store.checkConnection()
    const authenticated = relay.subs.slice(beforeOk)
    expect(relay.subs.length - beforeOk, 'AUTH settling opens one round, not two').toBe(oneRound)

    // And the round it opened is the one the space now reads from.
    deliver(revision('e9', 'handbook'), authenticated)
    expect(store.getSnapshot().pages.map((page) => page.slug)).toEqual(['handbook'])

    // Further patches with the same AUTH state change nothing.
    store.checkConnection()
    store.checkConnection()
    expect(relay.subs.length).toBe(beforeOk + oneRound)
    unsubscribe()
  })

  it('does not pile up a second round on a store that is already subscribed', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})
    const opened = relay.subs.length
    expect(opened).toBeGreaterThan(0)

    store.checkConnection()
    store.checkConnection()

    expect(relay.subs.length).toBe(opened)
    unsubscribe()
  })

  it('tells its listeners, so the UI does not keep rendering the old snapshot', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    deliver(revision('e1', 'onboarding'))
    listener.mockClear()

    clearAllSpaces()

    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })
})

describe('NIP-09 deletion requests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    relay.subs = []
    relay.epoch = 1
    relay.auth = 'ok'
    relay.ready = true
    clearAllSpaces()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads kind 5 for the group on its own subscription', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})

    const requests = relay.subs.filter((sub) => sub.filter.kinds?.includes(KINDS.DELETION_REQUEST))
    expect(requests).toHaveLength(1)
    expect(requests[0].filter['#h']).toEqual([GROUP])
    unsubscribe()
  })

  it('skips a revision its author asked to remove and bridges the successor', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})
    deliver(revision('r1', 'page', [], 'alice', 100))
    deliver(revision('r2', 'page', ['r1'], 'alice', 200))
    deliver(revision('r3', 'page', ['r2'], 'alice', 300))

    deliver(deletion('d1', 'alice', ['r2']))

    const page = store.getSnapshot().pages[0]
    expect(page.head.id).toBe('r3')
    expect(page.revisions.map((r) => r.id)).toEqual(['r3', 'r1'])
    expect(page.revisions[0].parentRevs).toEqual(['r1'])
    expect(store.getSnapshot().removedRevisions.map((r) => r.id)).toEqual(['r2'])
    unsubscribe()
  })

  it('ignores a request from someone other than the revision’s author', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})
    deliver(revision('r1', 'page', [], 'alice', 100))
    deliver(revision('r2', 'page', ['r1'], 'alice', 200))

    deliver(deletion('d1', 'bob', ['r2']))

    const page = store.getSnapshot().pages[0]
    expect(page.revisions.map((r) => r.id)).toEqual(['r2', 'r1'])
    expect(store.getSnapshot().removedRevisions).toEqual([])
    unsubscribe()
  })

  // The tombstone has to be re-derived from the relay, not kept in local state:
  // a rebuild clears everything collected, and only the re-delivered kind 5
  // brings the removal back.
  it('survives a rebuild when the kind 5 is delivered again', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})
    deliver(revision('r1', 'page', [], 'alice', 100))
    deliver(revision('r2', 'page', ['r1'], 'alice', 200))
    const request = deletion('d1', 'alice', ['r1'])
    deliver(request)
    expect(store.getSnapshot().pages[0].revisions.map((r) => r.id)).toEqual(['r2'])

    relay.epoch = 2
    store.checkConnection()
    expect(store.getSnapshot().pages).toEqual([])

    deliver(revision('r1', 'page', [], 'alice', 100))
    deliver(revision('r2', 'page', ['r1'], 'alice', 200))
    deliver(request)

    const page = store.getSnapshot().pages[0]
    expect(page.revisions.map((r) => r.id)).toEqual(['r2'])
    expect(page.revisions[0].parentRevs).toEqual([])
    unsubscribe()
  })

  it('still removes an admin-deleted revision outright', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})
    deliver(revision('r1', 'page', [], 'alice', 100))
    deliver(revision('r2', 'page', ['r1'], 'alice', 200))

    store.forget('r2')

    expect(store.getSnapshot().pages[0].revisions.map((r) => r.id)).toEqual(['r1'])
    expect(store.getSnapshot().pages[0].head.id).toBe('r1')
    unsubscribe()
  })

  it('closes the loading gate only once all five subscriptions answered', () => {
    const store = getSpaceStore(RELAY, GROUP)
    const unsubscribe = store.subscribe(() => {})
    expect(relay.subs).toHaveLength(5)

    for (let index = 0; index < 4; index += 1) relay.subs[index].onEose()
    expect(store.getSnapshot().loading).toBe(true)

    relay.subs[4].onEose()
    expect(store.getSnapshot().loading).toBe(false)
    unsubscribe()
  })
})
