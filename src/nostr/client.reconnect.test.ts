// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

/**
 * The connection lifecycle driven through the *real* nostr-tools client and a
 * fake WebSocket, rather than through a faked pool like client.test.ts. The
 * bugs this guards against — an AUTH round trip outliving its connection, the
 * pool's own idle-close, and two consumers of one relay — live in exactly that
 * interaction, so faking the pool would fake the bug away.
 */

/**
 * A minimal fake of the WebSocket API nostr-tools' AbstractRelay drives
 * directly. Exercises the real nostr-tools code against controllable timing
 * instead of re-implementing its close/connect semantics by hand.
 */
class FakeSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = FakeSocket.CONNECTING
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  url: string
  sent: string[] = []
  constructor(url: string) {
    this.url = url
    sockets.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    if (this.readyState === FakeSocket.CLOSED) return
    this.readyState = FakeSocket.CLOSED
    this.onclose?.({ code: 1000, reason: 'closed', wasClean: true })
  }
  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }
  message(json: unknown) {
    this.onmessage?.({ data: JSON.stringify(json) })
  }
  reqIds(): string[] {
    return this.sent
      .map((raw) => JSON.parse(raw))
      .filter((m) => m[0] === 'REQ')
      .map((m) => m[1] as string)
  }
}

let sockets: FakeSocket[] = []

async function freshClient() {
  sockets = []
  vi.resetModules()
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
  return import('./client')
}

// signAuth() rejects an event whose signature doesn't verify (rightly so),
// so the fake signer has to produce a real one, not a placeholder string.
function fakeSigner() {
  const secretKey = generateSecretKey()
  const pubkey = getPublicKey(secretKey)
  return {
    kind: 'dev' as const,
    pubkey,
    getPublicKey: async () => pubkey,
    signEvent: async (t: { tags: string[][]; content: string; kind: number; created_at: number }) =>
      finalizeEvent(t, secretKey),
  }
}

async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// no @types/node in this project's tsconfig; the vitest/node runtime has a
// real `process` regardless
const nodeProcess = (
  globalThis as unknown as {
    process: {
      on: (event: 'unhandledRejection', listener: (reason: unknown) => void) => void
      off: (event: 'unhandledRejection', listener: (reason: unknown) => void) => void
    }
  }
).process

function latestSocket(): FakeSocket {
  const socket = sockets.at(-1)
  if (!socket) throw new Error('no socket created')
  return socket
}

describe('NostrClient and SpaceStore reconnect races', () => {
  it('logging out while an AUTH round trip is still in flight does not flip auth to failed', async () => {
    // nostr-tools' own AUTH auto-trigger (AbstractRelay._onmessage, on
    // receiving an "AUTH" challenge) does `this.auth(this.onauth).catch(err
    // => { if (!(err instanceof SendingOnClosedConnection)) throw err })` —
    // rethrowing inside that .catch produces a genuine unhandled rejection
    // of its own whenever the intentional pool.close() below interrupts it,
    // independent of anything in client.ts. Real behaviour, not a test
    // artifact (it would show up as a console warning in the browser too);
    // swallow exactly this one so it doesn't fail the run.
    const rejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => rejections.push(reason)
    nodeProcess.on('unhandledRejection', onUnhandledRejection)

    try {
      const { client } = await freshClient()
      const url = 'ws://fake/'

      client.want(url)
      await flush()
      latestSocket().open()
      await flush()
      expect(client.getSnapshot(url).connection).toBe('online')

      // sign in: this closes and reopens the connection, then refreshAuth()
      // starts a real AUTH round trip against the new one
      client.setSigner(fakeSigner())
      await flush()
      latestSocket().open()
      await flush()
      expect(client.getSnapshot(url).connection).toBe('online')

      // the relay challenges; refreshAuth's own delay(200) means the AUTH
      // publish is still unanswered when we log out below
      latestSocket().message(['AUTH', 'challenge-1'])
      await new Promise((resolve) => setTimeout(resolve, 210))

      // logging out closes the relay refreshAuth is still waiting on — its
      // relay.auth(sign) promise rejects with "relay connection closed by
      // us", which used to be misread as a real AUTH failure. Check before
      // the new (post-logout) connection even opens, let alone gets a chance
      // to run its own refreshAuth and overwrite the damage — a version
      // without the fix can "self-heal" a moment later and still pass an
      // end-of-test-only assertion.
      client.setSigner(null)
      await flush()

      expect(client.getSnapshot(url).auth).not.toBe('failed')

      latestSocket().open()
      await flush(30)
      expect(client.getSnapshot(url).auth).toBe('none')

      expect(rejections).toEqual([new Error('relay connection closed by us')])
    } finally {
      nodeProcess.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('rapid logout immediately followed by login settles online, not stuck connecting', async () => {
    const { client } = await freshClient()
    const url = 'ws://fake/'

    client.want(url)
    await flush()
    latestSocket().open()
    await flush()
    expect(client.getSnapshot(url).connection).toBe('online')

    client.setSigner(null)
    client.setSigner(fakeSigner())

    // drain a few rounds of "open whatever socket is currently pending",
    // since the client supersedes the older open attempt rather than racing
    // them into each other
    for (let round = 0; round < 4; round++) {
      await flush()
      for (const socket of sockets) {
        if (socket.readyState === FakeSocket.CONNECTING) socket.open()
      }
    }
    await flush(20)

    expect(client.getSnapshot(url).connection).toBe('online')
  })

  it('does not idle-close the connection while subscriptions are open (CON-35, third cause)', async () => {
    // nostr-tools closes a relay by itself once AbstractRelay.ongoingOperations
    // reaches 0 (AbstractSimplePool.idleTimeout, 20s by default). That counter
    // is unreliable: Subscription.close() decrements it unconditionally, with
    // no guard against being called twice, so closing a subscription the relay
    // had already CLOSED (auth-required, the normal state for a private
    // group's content right after logout) decrements a second time. The
    // counter drifts and passes through exactly 0 while real subscriptions
    // are still open — SpaceStore.start() closes every previous
    // subscription before rebuilding, whether or not the relay already
    // killed it, which is exactly that second decrement. 20s later the
    // connection closes itself, our reconnect brings it back, and it repeats
    // every ~20s. Fixed by disabling nostr-tools' idle-close entirely
    // (NostrClient's pool.idleTimeout = 0) — we already own this
    // connection's lifecycle via want()/wanted.
    vi.useFakeTimers()
    try {
      const { client } = await freshClient()
      const url = 'ws://fake/'

      client.want(url)
      await vi.advanceTimersByTimeAsync(10)
      const socket = latestSocket()
      socket.open()
      await vi.advanceTimersByTimeAsync(10)
      expect(client.getSnapshot(url).connection).toBe('online')

      // the group-state subscription stays open all along
      client.subscribe(url, { kinds: [39000, 39001, 39002] }, () => {})
      // a content subscription the relay rejects, the way it does for a
      // private group's content without AUTH
      const stopContent = client.subscribe(url, { kinds: [1818] }, () => {})
      await vi.advanceTimersByTimeAsync(10)

      const ids = socket.reqIds()
      expect(ids).toHaveLength(2)
      socket.message(['CLOSED', ids[1], 'auth-required: Authentication required'])
      await vi.advanceTimersByTimeAsync(10)

      // the app closes the subscription too, on top of the relay's own
      // CLOSED — the double decrement
      stopContent()
      await vi.advanceTimersByTimeAsync(10)

      const socketsBefore = sockets.length
      await vi.advanceTimersByTimeAsync(25000)

      expect(socket.readyState).toBe(FakeSocket.OPEN)
      expect(sockets.length).toBe(socketsBefore)
      expect(client.getSnapshot(url).connection).toBe('online')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a second consumer releasing the relay does not take the first one down (CON-35, real cause)', async () => {
    // The one thing no isolated test had ever done: hold the same relay from
    // two places at once. In the app `Shell` holds it for the whole session
    // and `ProfileSettings` holds it again while /settings/profile is open —
    // and the Sign out button lives on that page and navigates away, so
    // logging out releases the second hold while the first is still live.
    // With `wanted` as a Set that release dropped the url outright and every
    // later open()/scheduleRetry bailed at the `wanted` check: the status
    // froze, nothing reconnected, only a reload recovered. Logging in never
    // unmounts anything, which is why only logout ever showed it.
    const { client } = await freshClient()
    const url = 'ws://fake/'

    client.setSigner(fakeSigner())
    const releaseShell = client.want(url)
    await flush()
    latestSocket().open()
    await flush()
    expect(client.getSnapshot(url).connection).toBe('online')

    const releaseProfile = client.want(url)
    await flush()

    // --- the Sign out click: logout(), then navigate() unmounts the page ---
    client.setSigner(null)
    // React's passive-effect cleanup lands after the microtask setSigner
    // queued, i.e. while open() is awaiting ensureRelay
    await Promise.resolve()
    releaseProfile()

    for (let round = 0; round < 4; round++) {
      await flush()
      for (const socket of sockets) {
        if (socket.readyState === FakeSocket.CONNECTING) socket.open()
      }
    }
    await flush(20)

    expect(client.getSnapshot(url).connection).toBe('online')

    // and the connection is still being maintained: a drop has to come back
    // on its own (first backoff step is 1s)
    const before = sockets.length
    latestSocket().close()
    await flush()
    expect(client.getSnapshot(url).connection).toBe('offline')
    await new Promise((resolve) => setTimeout(resolve, 1200))
    for (let round = 0; round < 4; round++) {
      await flush()
      for (const socket of sockets) {
        if (socket.readyState === FakeSocket.CONNECTING) socket.open()
      }
    }
    await flush(20)
    expect(sockets.length).toBeGreaterThan(before)
    expect(client.getSnapshot(url).connection).toBe('online')

    releaseShell()
  })

  it('releasing the same hold twice does not drop the other consumer (CON-35 review)', async () => {
    // React can run the same cleanup twice under StrictMode. The release is
    // a no-op the second time; decrementing again would drop Shell's hold and
    // the connection would stop being maintained.
    const { client } = await freshClient()
    const url = 'ws://fake/'

    const releaseShell = client.want(url)
    await flush()
    latestSocket().open()
    await flush()
    expect(client.getSnapshot(url).connection).toBe('online')

    const releaseProfile = client.want(url)
    await flush()

    releaseProfile()
    releaseProfile()

    // Shell's hold is still counted, so a drop has to come back on its own.
    const before = sockets.length
    latestSocket().close()
    await flush()
    expect(client.getSnapshot(url).connection).toBe('offline')
    await new Promise((resolve) => setTimeout(resolve, 1200))
    for (let round = 0; round < 4; round++) {
      await flush()
      for (const socket of sockets) {
        if (socket.readyState === FakeSocket.CONNECTING) socket.open()
      }
    }
    await flush(20)
    expect(sockets.length).toBeGreaterThan(before)
    expect(client.getSnapshot(url).connection).toBe('online')

    releaseShell()
  })

  it('closes the connection once the last consumer releases it', async () => {
    // nostr-tools' own idle-close is disabled (see the idle-close test above),
    // so this is the only thing that ever shuts an unwanted relay down.
    const { client } = await freshClient()
    const url = 'ws://fake/'

    const release = client.want(url)
    await flush()
    const socket = latestSocket()
    socket.open()
    await flush()
    expect(client.getSnapshot(url).connection).toBe('online')

    release()
    // Deferred by a moment so a StrictMode remount can still cancel it.
    await flush()
    expect(socket.readyState).toBe(FakeSocket.OPEN)

    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(socket.readyState).toBe(FakeSocket.CLOSED)

    // And it stays closed — nothing reconnects behind our back.
    await flush(30)
    expect(sockets.length).toBe(1)
    expect(client.getSnapshot(url).connection).toBe('online')
  })

  it('does not tear down a connection that is still connecting (CON-35 review)', async () => {
    // `pool.close()` during an in-flight `ensureRelay` nulls the handlers that
    // connect() is waiting on, and nostr-tools' own catch then does an
    // unguarded `relays.delete(url)` — the trap from AGENTS.md. The idle close
    // has to wait for the attempt to settle instead of racing it.
    const { client } = await freshClient()
    const url = 'ws://fake/'

    const release = client.want(url)
    await flush()
    const socket = latestSocket()
    expect(socket.readyState).toBe(FakeSocket.CONNECTING)

    release()
    // the idle close fires here, while the socket is still connecting
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(socket.readyState).toBe(FakeSocket.CONNECTING)

    // once the attempt settles, the connection is closed after all — and
    // nothing reconnects behind our back
    socket.open()
    await flush(20)
    expect(socket.readyState).toBe(FakeSocket.CLOSED)
    expect(sockets.length).toBe(1)
  })

  it('AUTH state lands on the url the UI reads, not on nostr-tools normalised twin', async () => {
    // The app addresses the relay as `ws://localhost:8080`; nostr-tools keys
    // everything internally by normalizeURL(), which appends a slash. The
    // client used to keep both: refreshAuth looked the connection up in
    // listConnectionStatus() with the unnormalised string, missed, and
    // returned early every time — so AUTH never reached 'ok' — while the
    // pool called signAuth with the normalised url and wrote 'pending' into
    // a second snapshot nothing rendered.
    const { client } = await freshClient()
    const plain = 'ws://fake'

    client.setSigner(fakeSigner())
    const release = client.want(plain)
    await flush()
    const socket = latestSocket()
    socket.open()
    socket.message(['AUTH', 'challenge-for-the-test'])
    await flush(30)

    // whatever the relay answers, both spellings have to be one snapshot
    expect(client.getSnapshot(plain)).toBe(client.getSnapshot(`${plain}/`))
    expect(client.getSnapshot(plain).auth).not.toBe('none')
    release()
  })

  it('does not resubscribe onto the connection a signer change is replacing (CON-36)', async () => {
    // setSigner() withdraws the connection synchronously (ready: false) and
    // patches auth to 'none' before it has actually closed and reopened it.
    // SpaceStore.checkConnection() reacts to that patch — an identity change
    // has to clear what the old one collected — and the only thing between
    // that reaction and a round of requests on the dying socket is start()'s
    // own ready check. Without it those requests race the pool.close() behind
    // them; some throw out of nostr-tools' sub.fire() and never reach the
    // relay at all, leaving a subscription nothing can close and a share of
    // the relay's ongoingOperations count nothing gives back.
    //
    // Signing in from anonymous is not the interesting direction: auth is
    // 'none' before and after that patch, so the store does not react at all.
    // Logging out is, and this drives it through the real setSigner().
    vi.useFakeTimers()
    const rejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => rejections.push(reason)
    nodeProcess.on('unhandledRejection', onUnhandledRejection)

    try {
      const { client } = await freshClient()
      const { getSpaceStore } = await import('./space-store')
      const url = 'ws://fake/'

      client.setSigner(fakeSigner())
      client.want(url)
      await vi.advanceTimersByTimeAsync(10)
      const socket = latestSocket()
      socket.open()
      socket.message(['AUTH', 'challenge-for-the-logout-test'])
      await vi.advanceTimersByTimeAsync(300)
      // Answer the AUTH event the client published, so the connection really
      // is authenticated when the store opens its subscriptions on it.
      const authEvent = JSON.parse(socket.sent.find((raw) => raw.startsWith('["AUTH"')) ?? '[]')[1] as {
        id: string
      }
      socket.message(['OK', authEvent.id, true, ''])
      await vi.advanceTimersByTimeAsync(50)
      expect(client.getSnapshot(url).auth).toBe('ok')
      expect(client.getSnapshot(url).ready).toBe(true)

      const store = getSpaceStore(url, 'engineering')
      const stopWatching = client.subscribeState(() => store.checkConnection())
      const subscribeSpy = vi.spyOn(client, 'subscribe')

      const releaseStore = store.subscribe(() => {})
      // one round: group state, revisions, comments, placements, deletions
      expect(subscribeSpy).toHaveBeenCalledTimes(5)
      // Let that round's REQ frames go out first: nostr-tools sends them
      // asynchronously, and they are not what this test measures.
      await vi.advanceTimersByTimeAsync(10)
      expect(rejections, 'the setup round must not fail on its own').toEqual([])
      subscribeSpy.mockClear()
      rejections.length = 0

      client.setSigner(null)

      expect(
        subscribeSpy,
        'must not open requests on the connection that is being replaced',
      ).not.toHaveBeenCalled()

      // Let the reconnect actually complete; the store has to come back on its
      // own once the new connection is up.
      for (let round = 0; round < 4; round++) {
        await vi.advanceTimersByTimeAsync(10)
        for (const candidate of sockets) {
          if (candidate.readyState === FakeSocket.CONNECTING) candidate.open()
        }
      }
      await vi.advanceTimersByTimeAsync(300)

      expect(client.getSnapshot(url).connection).toBe('online')
      expect(client.getSnapshot(url).ready).toBe(true)
      expect(subscribeSpy, 'must resubscribe once the new connection is up').toHaveBeenCalledTimes(
        5,
      )
      // Closing the subscriptions on top of the deliberate pool.close() can
      // still put a CLOSE frame on a dead socket; a REQ frame cannot, and that
      // is the one that loses a subscription.
      expect(
        rejections.filter((reason) => String((reason as Error).message).includes('"REQ"')),
        'no REQ may race the pool.close() being replaced',
      ).toEqual([])

      releaseStore()
      stopWatching()
    } finally {
      nodeProcess.off('unhandledRejection', onUnhandledRejection)
      vi.useRealTimers()
    }
  })
})
