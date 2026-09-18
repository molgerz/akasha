# Notes for AI agents working in this repo

Project: a Confluence-like wiki on Nostr. The full design lives in
[`docs/`](docs/README.md) — that is where the reasoning behind every decision
is. This file only contains working rules.

## Always manage groups with `nak group`

**Rule:** NIP-29 groups are created and modified exclusively through
`nak group` — `create-group`, `edit-metadata`, `put-user`, `remove-user`,
`create-invite`, `delete-event`. Never sign and publish the relay-generated
events `39000`, `39001`, `39002`, `39003` yourself.

**Why:** with NIP-29 the relay is the authority. Self-signed metadata events are
a stand-in: they look right in the client, but the relay enforces nothing,
membership and roles are fiction, and behavioural differences from a real relay
surface late.

**Consequence:** a relay that really implements NIP-29 has to be running.
`nak serve` does not (its NIP-11 lists no NIP 29, and `9007`/`9000` are only
stored raw). Therefore:

```bash
./scripts/dev-relay-up.sh     # verse-pbc/groups_relay on :8080 (natively via cargo)
./scripts/dev-group-seed.sh   # group and members via nak group
```

The build runs natively through cargo because the bundled `Dockerfile.dev` fails
at `cargo build --features console`. Without Rust the script falls back to
Docker with the production Dockerfile.

`nak serve` is only admissible for work without Docker and without group logic
(for example pure event-format checks) — and then without faked group metadata.

`nak group` is a **client**, not a relay: it does not replace a running relay.

## Addressing groups with nak

`nak group <command> <address>` accepts two forms:

- NIP-AD web address `host/group` — resolved via
  `https://<host>/.well-known/nostr.json`, so it does **not** work against
  `localhost` without TLS.
- `naddr1…` — always works:
  `nak encode naddr -d <group> -k 39000 -a <relay-pubkey> -r <relay-url>`

The relay pubkey comes from the NIP-11 document (`nak relay <url>`, field `self`
or `pubkey`).

## nak against `groups_relay`: which flags when

Measured on 2026-09-07. Without these rules commands come back empty or hang:

| Call | Flags | Reason |
|---|---|---|
| `nak req`, reading in general | `--fpa --sec <key>` | For private groups the relay **silently** filters out unauthenticated readers instead of rejecting with `auth-required`. `--auth` only reacts to a rejection and therefore never fires; `--fpa` (force-pre-auth) waits for the challenge |
| `nak event` (publishing) | `--fpa --sec <key>` | Works; `--auth` alone is often enough, `--fpa` is more reliable |
| `nak group create-group` | **only** `--sec` | With `--fpa` the command hangs: it reads metadata before publishing and waits there for a challenge that never arrives on that path |
| `nak group put-user` | `--fpa --sec` | Works |
| `nak group info`, `members`, `edit-metadata` | — | **Unusable against this relay.** They call `fetchGroupMetadata` through nak's internal pool, which knows no AUTH; `info` hangs forever. Check state with `nak req -k 39000 -k 39001 -k 39002` instead |

**Creating a group and editing its metadata right after it needs a wait in
between.** Measured on 2026-09-11: a `9002` sent immediately after a `9007` is
accepted (`OK true`), but the group then has no queryable `39000`/`39001`/`39002`
at all — as if the create had never landed. The relay's own indexing of the
freshly created group lags its `OK` for the `9007`. Waiting for `39000` to
become readable before sending the `9002` avoids it reliably (a few hundred ms
in practice). `createGroupAndWait` in `src/nostr/moderation.ts` does this; do
not send `9002` right after a raw `createGroup` call.

Two further substantive consequences:

- **Opening a group needs a raw `9002`.** The relay creates groups as `private`
  + `closed`. `nak group edit-metadata` omits the `public` and `open` tags when
  those flags are false — but `apply_tags` in the relay is additive and only
  changes what is present as a tag. `private` could therefore never be cleared.
  Hence one
  `nak event -k 9002 -h <group> -t public= -t open= …`. That is still the
  intended NIP-29 path (a moderation event the relay evaluates) and **not** a
  self-signed `39000`.
- **Kind 0 is rejected.** A real NIP-29 relay requires an `h` tag on every
  event; profiles belong on the user's own relays (`VITE_PROFILE_RELAYS`).
  Locally the app therefore shows npubs instead of names.

## Ports on this machine

| Purpose | Port | Reason |
|---|---|---|
| App (Vite) | 5273 | 5173 is taken by a container |
| NIP-29 relay | 8080 | — |
| `nak serve` (emergencies only) | 10577 | 10547 is taken by a relay container |
| Blossom dev server | 3355 | — |

## Small things that cost time

- **zsh:** `GID` is a reserved variable. `GID=engineering` fails with "failed to
  change group ID". Use `GROUP_ID` in scripts.
- **Every** nak call in a script needs `</dev/null` — including
  `nak key public`. Otherwise they block on stdin when the script runs from a
  pipe. `nak event` without `-c` waits on stdin as well.
- nak exits with 1 for expected states (for example "Group already exists").
  With `set -e` a script dies silently at that point — add `|| true` and check
  the output yourself.
- Ephemeral events (20000–29999) are rejected by `nak serve` with
  `mute: no one was listening for this` when nobody has subscribed. That is not
  a permission problem.

## Traps in the Nostr layer

- **Do not overwrite `relay.onclose`.** `SimplePool.ensureRelay` installs its
  own handler there which removes the dead connection from the registry.
  Replacing it means the next `ensureRelay` hands back the same dead object.
  Chain onto it instead of replacing it.
- **Subscriptions die with their connection.** After a reconnect or a signer
  change (AUTH is per connection) all subscriptions have to be set up again. The
  client counts an `epoch` per relay for exactly this.
- **`pool.get` has no `onauth` hook.** On a relay with enforced NIP-42 it
  silently returns empty results. Read through `subscribeEose` with `onauth`.
- **`subscribeEose` closes on EOSE.** That is too early for the echo of an
  ephemeral event — use `pool.subscribe` there.
- **`useSyncExternalStore` needs a memoised `subscribe` function.** A new
  function identity per render resubscribes; if the store starts something while
  doing so, the loop never ends.
- **"The signer changed" is not "the relay reconnected".** `setSigner()` patches
  `auth: 'none'` and withdraws the connection *synchronously*, before the
  reconnect it queued has run. A subscription store that treats the signer
  change itself as its trigger therefore rebuilds against the connection on its
  way out; the requests race the `pool.close()` behind it and some never reach
  the relay at all — no `CLOSED`, no `onclose`, just a silently lost
  subscription and a permanently leaked `ongoingOperations` count on the
  discarded relay (CON-36). React to the relay's `epoch`, which only rises once
  the new connection is up, and have the store refuse to subscribe while the
  snapshot is not `ready` (`SpaceStore.start()`) — that ready check is what
  makes even the synchronous `auth` patch safe to react to for clearing.
  `NostrClient` deliberately carries no signer-generation counter.
- **Key every internal map by nostr-tools' own normalised url, not by the
  app's string.** `normalizeURL()` (from `nostr-tools/utils`, also used
  internally by `SimplePool`) appends a trailing slash:
  `ws://localhost:8080` becomes `ws://localhost:8080/`. `NostrClient` used
  to keep two sets of books — `refreshAuth` looked the connection up with the
  app's unnormalised string, `listConnectionStatus()` knew it only under the
  normalised one, so the lookup missed and the function returned early *every
  time*: AUTH never reached `'ok'`. Meanwhile `pool.automaticallyAuth`
  called `signAuth` with the normalised url and wrote `'pending'` into a
  second snapshot nothing ever rendered. Fixed with `NostrClient.key()`
  (wrapping `normalizeURL`, with a try/catch fallback) that `wanted`,
  `snapshots` and the rest are addressed through; `getSnapshot`/`patch`
  normalise on the way in, so `RelaySnapshot.url` is normalised too —
  `RelayStatusBadge`'s `hostOf()` strips the trailing slash back out for
  display. Found 2026-09-11 auditing CON-35.
- **A relay's rejection of a pending operation does not mean that operation
  actually failed.** `AbstractRelay.close()` rejects every open publish with
  `Error("relay connection closed by us")` — including a pending
  `relay.auth(sign)` from a `refreshAuth` call started on the *previous*
  connection and not yet settled when `NostrClient` intentionally closed it
  to reconnect (e.g. on `setSigner`). Reading that rejection at face value
  and patching `auth: 'failed'` reports an AUTH failure that never happened.
  Found 2026-09-11 as a second cause behind CON-35: logging out alone (no
  second `setSigner` call, no race with a later `open()`) could flip the
  relay indicator red this way, because the last read/publish before logout
  often still has a `refreshAuth` in flight. Fixed with
  `NostrClient.connGeneration`, a per-url counter bumped synchronously inside
  every relay's `onclose`; `refreshAuth` captures it before its
  `relay.auth()` round trip and discards a stale result, success or failure.
  (This only starts to matter once the point above is fixed — before that,
  `refreshAuth` returned early and never reached `relay.auth` at all.)
  Note that nostr-tools' own AUTH auto-trigger rethrows when an auth attempt
  fails with anything but `SendingOnClosedConnection`, which produces an
  unrelated, genuine unhandled-rejection console warning on this same
  interrupted-AUTH path — real, harmless, and deliberately swallowed by
  `src/nostr/client.reconnect.test.ts` rather than treated as a bug.
- **nostr-tools closes an idle relay by itself, and `ongoingOperations` (the
  counter it decides "idle" from) is unreliable.** `AbstractSimplePool`
  defaults `idleTimeout` to 20s and passes it to every `AbstractRelay` it
  creates; once `ongoingOperations` hits 0, `scheduleIdleClose` arms a timer
  that calls `relay.close()` if it is still 0 after that.
  `Subscription.close()` decrements `ongoingOperations` unconditionally,
  with no guard against being called twice — so closing a subscription the
  relay had *already* sent `CLOSED` for (e.g. `auth-required` on a private
  group's content, the normal state right after logout) decrements it a second
  time. `SpaceStore.start()` closes every previous round's subscriptions
  whenever it rebuilds, whether or not the relay already killed one of them —
  that is the second decrement in practice. The counter drifts below the
  number of subscriptions genuinely still open (observed as low as -2) and
  passes through exactly 0 even while a real one (the group-state
  subscription, which the relay never closes, just silently filters — see the
  `pool.get` entry above) is still live. 20s later the connection closes
  itself client-side, `NostrClient`'s own reconnect-on-close brings it back,
  the same subscriptions get rejected again, and it repeats every ~20-80s.
  Found 2026-09-11 as a third cause of CON-35 (an initial theory blamed 3-of-4
  subscriptions being rejected for reaching `ongoingOperations === 0`
  directly — verified false, that alone leaves it at 1; the double-decrement
  is what gets it there). We own this connection's lifecycle ourselves via
  `want()`/`wanted`, so nostr-tools' idle-management only fights that —
  fixed by `pool.idleTimeout = 0` right after construction
  (`SimplePool`'s constructor type does not expose it, but it is a plain
  public field on `AbstractSimplePool`). That also removes the only thing
  that ever closed an *unwanted* relay, so `want()`'s release has to: at
  refcount zero it closes the url. Deferred by 500ms and cancelled by a new
  hold, because React mounts twice in StrictMode (`SpaceStore.subscribe`
  defers its close the same way) — and it waits for an in-flight
  `ensureRelay` to settle first, because closing under one is the trap two
  entries below. Serializing every `open()` instead would be simpler but is
  what CON-30 removed on purpose: a logout→login would then have to wait out
  the previous attempt's whole timeout before even trying to connect.
- **`NostrClient.want(url)` has more than one caller for the same relay at
  once, and a `Set` cannot tell them apart.** `AppShell`'s `Shell` holds
  the main relay for the whole session; `ProfileSettings`
  (`/settings/profile`) holds the same url again for as long as that page is
  open — and the app's only Sign out button lives there and navigates away
  right after, which unmounts it. With `wanted` as a `Set<string>`, that
  unmount's cleanup did `wanted.delete(url)` and removed the *only* record of
  anyone wanting the relay — including `Shell`'s still-live hold. Every later
  `open()`/`scheduleRetry` call then bails at its `wanted` check, so
  nothing reconnects when the connection eventually drops for any reason; only
  a full reload recovers. Found 2026-09-11 as CON-35's actual, deterministic
  cause: logging out is the only thing in the app that unmounts a second
  `want()` holder, which is why logging in never showed it and three earlier
  fixes (real bugs, but not this one) did not touch it. Fixed by making
  `wanted` a `Map<string, number>` reference count — `want()` increments,
  the returned release decrements and only actually removes the entry (and
  stops retrying) at zero, and a second release is a no-op (React can run the
  same cleanup twice under StrictMode), and it closes the connection at zero
  (see the idle-close entry above). No client.ts-only test could have found
  this, since none had more than one `want()` holder; guarded by
  `src/nostr/relay-status.test.tsx`, which mounts two `useRelay()`
  consumers under one stable parent and unmounts only the child.
- **`pool.close(url)` during an in-flight `pool.ensureRelay(url)` for the
  same url corrupts the pool, permanently.** `AbstractRelay.close()`
  synchronously nulls `ws.onopen`/`onerror`/`onclose` — the handlers that
  would resolve or reject the `connect()` promise a concurrent
  `ensureRelay()` call is still awaiting. That call then hangs until its own
  `connectionTimeout`, and its catch block does `this.relays.delete(url)` —
  on whatever relay object is registered for that url *by then*, which by then
  can be a different, perfectly healthy connection a second, later
  `ensureRelay()` already finished setting up. That orphans the healthy
  connection from the pool's registry and, in `NostrClient`, flips the UI to
  "offline" with a retry loop that never recovers — only a page reload resets
  the module-level state. Found 2026-09-11 as a further cause of CON-35
  (relay breaks after logout→login, needs a reload): `setSigner` calls
  `pool.close([url])` and then reconnects for every wanted url, and a second
  `setSigner` shortly after the first — any logout immediately followed by
  login — raced its `pool.close` against the first call's still-pending
  `ensureRelay`. CON-30's rewrite covers it by bounding every `ensureRelay`
  (`withTimeout`) and tagging each open attempt with a sequence number, so a
  superseded attempt returns silently instead of deleting whatever the pool
  holds; the earlier per-url serialization of `open()` is gone with it.

## Conventions

- Documentation, code comments and commit messages in English.
- Tickets, PR descriptions and other write-ups about this project are always in English.
- Kind numbers and tag names only in `src/nostr/kinds.ts`.
- Before every commit:
  `npm run typecheck && npm run lint && npm test && npm run build`.
  `lint` is deliberately its own step rather than folded into `typecheck`,
  so a hook or dependency finding is never reported as a type error.
  `eslint.config.js` carries only what `tsc` cannot see: `react-hooks/*`
  (`rules-of-hooks`, `exhaustive-deps` — the stale-closure and
  resubscribe-race class behind CON-35/CON-36/CON-37) plus
  `js.configs.recommended`. The React-Compiler-era rules that ship with
  `eslint-plugin-react-hooks` 7 are off on purpose: this app is built on
  `useSyncExternalStore` and external stores, which those rules flag as a
  matter of design. Add one individually, with its findings fixed, if it is
  ever wanted. Ignored trees: `dist`, `coverage`, and the third-party
  checkouts under `.local/` and `.gstack/`.
- **A branch does not change the same thing twice.** Its commits have to read
  as if the work had been done once, in order: no file is touched by two
  commits of the same branch unless the second change is a consequence of
  later work rather than a correction of the first, and nothing a branch adds
  is renamed or removed again by that same branch. Otherwise the reviewer
  reads work that was thrown away before the PR was even opened. Count the
  touches before handing over — anything above `1` is a file to justify or to
  fold together:

  ```
  git log --format='%h' main..HEAD | while read c; do git show --format= --name-only $c; done | sort | uniq -c | sort -rn
  ```

  The repair is not to patch history but to rebuild the branch from its final
  tree, which removes the churn by construction: `git reset <main>`, then one
  `git add`/`git commit` per group, and `git diff --quiet HEAD <backup>` as
  the proof that the tree still is the one that was reviewed. Every commit
  passes the gates above on its own — that is what makes a split honest
  rather than cosmetic, and it is also what caps the number of commits: a
  boundary that would split one file across two commits is not a boundary.
- Placeholders in the UI name their phase from `docs/10-roadmap.md`.
- Every branch and PR title starts with its Kaneo ticket id, so either is
  traceable back to the ticket at a glance: branch `con-1-create-space-from-app`
  (type prefix optional in front, e.g. `feat/con-1-...`), PR title
  `CON-1: create a space from the app`. A change with no ticket gets no prefix.
- **Never delete or "tidy up" branches on its own initiative** — local or
  remote, merged or stale. Branch cleanup always needs the user's explicit
  approval first; propose the exact list and wait.
- **Changes to `main` always go through a pull request.** Branch
  `con-<n>-...` off `main`, push it, open a PR against `main` — never push to
  `main` directly, even when account permissions would allow bypassing branch
  protection. Merge the PR once its required checks pass.
