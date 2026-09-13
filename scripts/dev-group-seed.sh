#!/usr/bin/env bash
# Creates the development space on a real NIP-29 relay — via `nak group`
# only. Group metadata (39000/39001/39002) is produced by the relay itself;
# it is never signed by hand here. See AGENTS.md.
#
# Requires: ./scripts/dev-relay-up.sh   (relay on ws://localhost:8080)
# Usage:    ./scripts/dev-group-seed.sh [relay-url] [group-id]

set -euo pipefail

RELAY="${1:-ws://localhost:8080}"
GROUP_ID="${2:-engineering}"          # do NOT call it GID: reserved in zsh
KEYFILE="$(dirname "$0")/.dev-keys"

command -v nak >/dev/null || { echo "nak is missing"; exit 1; }

# --- Preflight: does this relay speak NIP-29 at all? -----------------------
INFO=$(nak relay "$RELAY" </dev/null 2>/dev/null || true)
if [[ -z "$INFO" ]]; then
  echo "no relay reachable on $RELAY — run ./scripts/dev-relay-up.sh first"
  exit 1
fi

read -r RELAY_NAME RELAY_PK HAS29 <<<"$(python3 - "$INFO" <<'PY'
import json, sys
doc = json.loads(sys.argv[1])
nips = doc.get("supported_nips", [])
print(
    doc.get("name", "?").replace(" ", "_"),
    doc.get("self") or doc.get("pubkey") or "-",
    "yes" if 29 in nips else "no",
)
PY
)"

echo "Relay:    $RELAY_NAME ($RELAY)"
if [[ "$HAS29" != "yes" ]]; then
  echo
  echo "This relay does not implement NIP-29. Groups would only be simulated,"
  echo "and that is exactly what must not happen (AGENTS.md)."
  echo "Start a real group relay:  ./scripts/dev-relay-up.sh"
  exit 1
fi
if [[ "$RELAY_PK" == "-" ]]; then
  echo "The relay names no pubkey of its own in its NIP-11 (self/pubkey)."
  echo "Without it no naddr address can be built."
  exit 1
fi

# --- Throwaway keys, for local test relays only ---------------------------
if [[ ! -f "$KEYFILE" ]]; then
  {
    echo "ALICE_SEC=$(nak key generate </dev/null)"
    echo "BOB_SEC=$(nak key generate </dev/null)"
    echo "BLOSSOM_SEC=$(nak key generate </dev/null)"
  } > "$KEYFILE"
  echo "new throwaway keys created in $KEYFILE"
fi
# shellcheck source=/dev/null
source "$KEYFILE"
# Older key files predate the Blossom service identity (CON-26). Add it rather
# than regenerate: the app's memberships would not survive new keys.
if [[ -z "${BLOSSOM_SEC:-}" ]]; then
  echo "BLOSSOM_SEC=$(nak key generate </dev/null)" >> "$KEYFILE"
  # shellcheck source=/dev/null
  source "$KEYFILE"
  echo "added a Blossom service key to $KEYFILE"
fi
# Close stdin explicitly: otherwise nak commands read from stdin and block
# when the script runs out of a pipe.
ALICE_PK=$(nak key public "$ALICE_SEC" </dev/null)
BOB_PK=$(nak key public "$BOB_SEC" </dev/null)
BLOSSOM_PK=$(nak key public "$BLOSSOM_SEC" </dev/null)

ADDRESS=$(nak encode naddr -d "$GROUP_ID" -k 39000 -a "$RELAY_PK" -r "$RELAY" </dev/null)

# Every nak call needs --fpa (force-pre-auth): this relay silently filters out
# unauthenticated readers instead of rejecting them with "auth-required" — and
# --auth would only react to a rejection.
NAK_AUTH=(--fpa --sec "$ALICE_SEC")

run() { # run <seconds> <command...>
  local limit="$1"; shift
  if command -v timeout >/dev/null; then timeout -k 2 "$limit" "$@" </dev/null 2>&1
  else "$@" </dev/null 2>&1; fi
}

echo "group:    $GROUP_ID"
echo "admin:    $ALICE_PK (alice)"
echo "member:   $BOB_PK (bob)"
echo "service:  $BLOSSOM_PK (blossom, reads 39002 for attachment rights)"
echo

# create-group without --fpa: the command hangs with --fpa because it reads
# metadata before publishing and then waits for an AUTH challenge that never
# arrives on this path. Creating the group itself needs no AUTH.
echo "1) create the group (nak group create-group)"
OUT=$(run 25 nak group create-group --sec "$ALICE_SEC" "$ADDRESS") || true
if grep -q "already exists" <<<"$OUT"; then echo "   already there"; else echo "   created"; fi

# The space is invite-only: only members read, only members write, and joining
# happens by an admin adding the npub. The relay already creates groups as
# private+closed, but the tags are sent explicitly all the same — apply_tags in
# src/group.rs is additive, so a group that an earlier run opened stays open
# until the closing tags arrive. `restricted` is the one that is easy to miss:
# without it NIP-29 lets non-members publish into the group.
echo "2) close the group and set its metadata (kind 9002)"
OUT=$(run 25 nak event --fpa --sec "$ALICE_SEC" -k 9002 -h "$GROUP_ID" \
  -t "name=Engineering" -t "about=Team wiki on Nostr" \
  -t private= -t closed= -t restricted= -t visible= -t nonbroadcast= \
  -t "supported_kinds=1818;1111;9;31818" -c '' "$RELAY") || true
grep -q success <<<"$OUT" || { echo "   ERROR: $(tail -1 <<<"$OUT")"; exit 1; }
echo "   private, closed, restricted, supported_kinds=1818;1111;9;31818"

echo "3) add bob as a member (nak group put-user)"
OUT=$(run 25 nak group put-user "${NAK_AUTH[@]}" --pubkey "$BOB_PK" "$ADDRESS") || true
grep -q '"kind":9000' <<<"$OUT" || { echo "   ERROR: $(tail -1 <<<"$OUT")"; exit 1; }
echo "   added"

# The Blossom server checks attachment reads against 39002, and a private
# group's member list is only served to a member — so its service identity has
# to be one. scripts/dev-blossom.mjs reads BLOSSOM_SEC from the same key file.
echo "3b) add the Blossom service identity as a member"
OUT=$(run 25 nak group put-user "${NAK_AUTH[@]}" --pubkey "$BLOSSOM_PK" "$ADDRESS") || true
grep -q '"kind":9000' <<<"$OUT" || { echo "   ERROR: $(tail -1 <<<"$OUT")"; exit 1; }
echo "   blossom service added (BLOSSOM_SEC in $KEYFILE)"

# Fetch the head of a slug's revision chain, so that a second run of the
# script continues the chain instead of creating a second root (which the app
# would rightly show as a fork).
head_of() {
  run 15 nak req --fpa --sec "$ALICE_SEC" -k 1818 -t "d=$1" -t "h=$GROUP_ID" --limit 50 "$RELAY" \
    | grep '^{' | python3 -c '
import json, sys
revs = [json.loads(l) for l in sys.stdin if l.strip().startswith("{")]
parents = {t[1] for r in revs for t in r["tags"] if t[0] == "parent-rev" and len(t) > 1}
leaves = [r for r in revs if r["id"] not in parents]
leaves.sort(key=lambda r: (r["created_at"], r["id"]), reverse=True)
print(leaves[0]["id"] if leaves else "")
'
}

echo "4) sample pages (content, no group administration)"
page() { # page <sec> <slug> <title> <parent-slug> <note> <parent-rev> <text>
  local sec="$1" slug="$2" title="$3" parent="$4" note="$5" prev="$6" body="$7"
  local args=(--fpa --sec "$sec" -k 1818 -h "$GROUP_ID" -d "$slug"
              -t "title=$title" -t m=text/markdown)
  [[ -n "$parent" ]] && args+=(-t "page-parent=$parent")
  [[ -n "$note" ]] && args+=(-t "summary=$note")
  [[ -n "$prev" ]] && args+=(-t "parent-rev=$prev")
  local out
  out=$(run 25 nak event "${args[@]}" -c "$body" "$RELAY") || true
  grep -q success <<<"$out" || { echo "   REJECTED ($slug): $(tail -1 <<<"$out")"; exit 1; }
  LAST_ID=$(grep -o '"id":"[0-9a-f]\{64\}"' <<<"$out" | head -1 | cut -d'"' -f4)
  echo "   $slug ${LAST_ID:0:8}"
}

page "$ALICE_SEC" handbook Handbook "" "" "$(head_of handbook)" '# Handbook

Parent page for the sidebar.'
page "$ALICE_SEC" onboarding Onboarding handbook "" "$(head_of onboarding)" '# Onboarding

First revision.'
FIRST="$LAST_ID"
page "$BOB_SEC" onboarding Onboarding handbook "added a section" "$FIRST" '# Onboarding

First revision.

## Access

Added by bob.'

echo
echo "5) group state produced by the relay"
# Raw REQs on purpose instead of `nak group info`: its internal pool does not
# authenticate and the command hangs against this relay.
run 15 nak req "${NAK_AUTH[@]}" -k 39000 -k 39001 -k 39002 --limit 3 "$RELAY" \
  | grep '^{' | python3 -c '
import json, sys
names = {39000: "39000 metadata", 39001: "39001 admins  ", 39002: "39002 members"}
for line in sys.stdin:
    e = json.loads(line)
    label = names.get(e["kind"], str(e["kind"]))
    tags = ", ".join("=".join(t) if len(t) > 1 else t[0] for t in e["tags"] if t[0] != "d")
    print("   " + label + ": " + tags)
'

cat <<OUT

done.

  group address:  $(sed 's|wss\{0,1\}://||' <<<"$RELAY")'$GROUP_ID
  naddr:          $ADDRESS
  app:            npm run dev  ->  http://localhost:5273

Have a look:
  nak req --fpa --sec \$ALICE_SEC -k 1818 -t h=$GROUP_ID $RELAY
OUT
