# 08 — Relay setup & test environment

**Decision (confirmed):** running our own relay is part of the project. The fact
that the relay operator (the company or an admin) can read all content in
plaintext is accepted for this use case — see [09](09-security-privacy.md).

**Project rule:** groups are created and modified **exclusively through
`nak group`**. The relay-generated events `39000`–`39003` are never signed by us.
Reasoning and consequences are in [AGENTS.md](../AGENTS.md). It follows that
development runs against a relay that really implements NIP-29 from day one —
not against a stand-in.

## Development relay: `verse-pbc/groups_relay`

[verse-pbc/groups_relay](https://github.com/verse-pbc/groups_relay) (Rust,
AGPL-3.0, last commit 2026-02-11). Source reviewed on 2026-09-07:

- Enforces membership: non-members are rejected in `closed` groups with "User is
  not a member of this group" (`src/group.rs`).
- **No kind allowlist inside groups.** `validation_middleware.rs` only requires
  an `h` tag (exceptions in `NON_GROUP_ALLOWED_KINDS`). So our `kind 1818` goes
  through without patching the relay — that was the biggest open risk in the
  data model.
- In `open` groups the author becomes a member when posting ("Open groups
  auto-join the author when posting") and `39002` is updated.
- Generates `39000`–`39003` itself, supports `public`/`private`, `open`/`closed`
  and `broadcast`, plus NIP-09/40/42/70.
- **Limitation:** timeline references (the `previous` tag) are not implemented
  according to its README. The tag may be written, the relay does not check it.

No longer to be used: `fiatjaf/relay29` was archived on 2026-04-20 and carries a
note not to trust it with anything serious.

### Starting it

```bash
./scripts/dev-relay-up.sh     # clones into .local/, builds, starts on :8080
./scripts/dev-group-seed.sh   # space, members and sample pages via nak group
```

The seed script performs five steps and is repeatable:

1. `nak group create-group` — on a second run the relay reports "Group already
   exists", which the script catches.
2. A `9002` moderation event with explicit `public`/`open` tags. Necessary
   because the relay creates groups private and closed, and `nak group
   edit-metadata` cannot clear those flags — reasoning in
   [AGENTS.md](../AGENTS.md).
3. `nak group put-user` for the second test account.
4. Three `1818` revisions (two pages, one of them with a second revision and a
   `parent-rev`) — content, not group administration.
5. Verification through raw `nak req` queries for `39000`/`39001`/`39002`,
   because `nak group info` hangs against this relay.

Which nak flags are needed when (`--fpa` instead of `--auth`, `create-group`
with neither) is documented in [AGENTS.md](../AGENTS.md) — that is the part
which costs the most time on a first attempt.

The build runs **natively through cargo**, not through Docker: the bundled
`Dockerfile.dev` fails at `cargo build --features console` (exit 101) — the
feature is explicitly disabled as unstable in the production Dockerfile. Without
a local Rust toolchain the script falls back to Docker with the production
Dockerfile ([docker/groups-relay.override.yml](../docker/groups-relay.override.yml)).
Configuration comes from the relay's `config/settings.yml` plus
`settings.local.yml`; the script overrides port and URL through
`NIP29__relay__*` environment variables.

### Addressing groups

`nak group <command> <address>` accepts two forms:

| Form | Resolution | Usable locally |
|---|---|---|
| `host/group` (NIP-AD) | `https://<host>/.well-known/nostr.json` | no, needs TLS |
| `naddr1…` | directly from the code | yes |

That is why the seed script always builds an `naddr`:

```bash
nak encode naddr -d engineering -k 39000 -a "$RELAY_PUBKEY" -r ws://localhost:8080
```

The relay pubkey comes from the NIP-11 document (`nak relay <url>`, field `self`
or `pubkey`). Background: `fetchGroupMetadata` in nak first takes that pubkey as
the author of the group metadata and only falls back to the author from the
`naddr` — so with a real NIP-29 relay the relay pubkey is the right one.

## `nak serve`: only for things without group logic

`nak serve` starts an in-memory relay (`slicestore.SliceStore`), but it is **not
a NIP-29 relay**. Verified on 2026-09-07 with nak 0.20.6:

- Its NIP-11 reports `supported_nips: [1, 11, 42, 70, 86, 40, 9, 45]` — 29 is
  missing.
- `9007` (create-group) and `9000` (put-user) are stored raw, with no effect. No
  `39000`–`39003` are produced.
- Any foreign key may write into any group.

So it is only admissible for things unrelated to groups — event formats, the
NIP-42 flow (`nak serve --auth`), reconnect behaviour. Creating group metadata
by hand is explicitly no longer allowed.

Two quirks that cost time:

- **Port collision:** the default is `10547`, where a `nostr-rs-relay` container
  already listens on this machine. Two listeners on the same port (IPv4 and the
  IPv6 wildcard) mean `localhost` sometimes lands on one, sometimes the other.
  If you do need it: `nak serve --port 10577`.
- **Ephemeral events** (20000–29999) are rejected by `nak serve` with
  `mute: no one was listening for this` when nobody has subscribed. That is not
  a permission problem — the app classifies such reasons accordingly
  (`classifyRejection` in `src/nostr/client.ts`).

## Operations

- Put the relay behind TLS (`wss://`), because an HTTPS page may not open
  `ws://` (except for `localhost`). The app derives the scheme from the host in
  the space address and counts exactly `localhost`, `127.0.0.1` and `[::1]` as
  local, each with an optional port — so a dev relay bound to IPv6 is reached
  as `[::1]:8080`. Every other host gets `wss://`, including one that merely
  begins with `localhost` (`isLocalRelayHost` in `src/nostr/group-address.ts`;
  CON-45).
- The web app is a static bundle on any host.
- Backup = event export as JSONL. Because everything is signed, an export is
  verifiably restorable on another relay. That is also the migration strategy:
  moving a space means copying events.
