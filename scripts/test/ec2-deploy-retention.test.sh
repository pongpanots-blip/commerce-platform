#!/bin/bash
# Dry-run tests for commerce_deploy_select_removable_tags in docker/ec2-deploy.sh.
# No docker / no deploy — sources the script and feeds fake image lists.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/docker/ec2-deploy.sh"

pass=0
fail=0

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  local exp_n act_n
  exp_n="$(printf '%s
' "$expected" | sed '/^$/d' | sort)"
  act_n="$(printf '%s
' "$actual" | sed '/^$/d' | sort)"
  if [[ "$exp_n" == "$act_n" ]]; then
    echo "PASS: $name"
    pass=$((pass + 1))
  else
    echo "FAIL: $name" >&2
    echo "  expected:" >&2
    printf '%s
' "$exp_n" | sed 's/^/    /' >&2
    echo "  actual:" >&2
    printf '%s
' "$act_n" | sed 's/^/    /' >&2
    fail=$((fail + 1))
  fi
}

REGISTRY="123456789012.dkr.ecr.ap-southeast-1.amazonaws.com"
SUFFIX="commerce-platform"
REPO="${REGISTRY}/${SUFFIX}"

# Fake docker images --format TSV: Repository, Tag, CreatedAt, ID
# CreatedAt sorted newest-first for readability; selection uses string compare.
IMAGES_TSV="$(cat <<EOF
${REPO}	add97ee	2026-10-08 10:00:00 +0000 UTC	aaa111111111
${REPO}	947d385	2026-10-07 10:00:00 +0000 UTC	bbb222222222
${REPO}	olddead1	2026-10-01 10:00:00 +0000 UTC	ccc333333333
${REPO}	olddead2	2026-09-01 10:00:00 +0000 UTC	ddd444444444
${REPO}	<none>	2026-08-01 10:00:00 +0000 UTC	eee555555555
other.registry.example/commerce-platform	straytag	2026-10-06 10:00:00 +0000 UTC	fff666666666
${REGISTRY}/commerce-admin	6817a67	2026-10-08 11:00:00 +0000 UTC	ggg777777777
EOF
)"

# --- Case 1: first run (no previous tag) ---
# Current=add97ee. No prev → keep newest other (947d385 by CreatedAt).
# Removable: olddead1, olddead2, and other.registry straytag (same suffix).
# Keep: add97ee, 947d385. Skip <none>. Ignore commerce-admin.
got="$(commerce_deploy_select_removable_tags "$SUFFIX" "add97ee" "" "$IMAGES_TSV" "")"
want="$(cat <<EOF
${REPO}:olddead1
${REPO}:olddead2
other.registry.example/commerce-platform:straytag
EOF
)"
assert_eq "first-run keeps newest other tag" "$want" "$got"

# --- Case 2: normal run (prev + current) ---
# Current=add97ee, prev=947d385 → keep both; remove olddead* and straytag.
# Newest-other rule does NOT apply when prev is set.
got="$(commerce_deploy_select_removable_tags "$SUFFIX" "add97ee" "947d385" "$IMAGES_TSV" "")"
want="$(cat <<EOF
${REPO}:olddead1
${REPO}:olddead2
other.registry.example/commerce-platform:straytag
EOF
)"
assert_eq "normal run keeps current + previous" "$want" "$got"

# --- Case 3: image used by a running container ---
# Current=add97ee, prev=947d385, but a container still runs olddead1 (by repo:tag).
# olddead1 must be kept; olddead2 + straytag removable.
running="${REPO}:olddead1"$'\n'"sha256:ccc333333333aaaaaaaa"
got="$(commerce_deploy_select_removable_tags "$SUFFIX" "add97ee" "947d385" "$IMAGES_TSV" "$running")"
want="$(cat <<EOF
${REPO}:olddead2
other.registry.example/commerce-platform:straytag
EOF
)"
assert_eq "running container image is kept" "$want" "$got"

# --- Case 4: running by image ID only (short ID prefix match) ---
running="ccc333333333"
got="$(commerce_deploy_select_removable_tags "$SUFFIX" "add97ee" "947d385" "$IMAGES_TSV" "$running")"
want="$(cat <<EOF
${REPO}:olddead2
other.registry.example/commerce-platform:straytag
EOF
)"
assert_eq "running image ID keeps matching tag" "$want" "$got"

# --- Case 5: empty images → nothing to remove ---
got="$(commerce_deploy_select_removable_tags "$SUFFIX" "add97ee" "947d385" "" "")"
assert_eq "empty image list removes nothing" "" "$got"

# --- Case 6: running by full sha256 ID only (docker inspect .Image form) ---
running="sha256:ddd444444444$(printf 'f%.0s' {1..52})"
got="$(commerce_deploy_select_removable_tags "$SUFFIX" "add97ee" "947d385" "$IMAGES_TSV" "$running")"
want="$(cat <<EOF
${REPO}:olddead1
other.registry.example/commerce-platform:straytag
EOF
)"
assert_eq "running sha256 ID keeps matching tag" "$want" "$got"

# --- Case 8: prev + pending prev (retry after a failed health check) both kept ---
got="$(commerce_deploy_select_removable_tags "$SUFFIX" "add97ee" "947d385 olddead1" "$IMAGES_TSV" "")"
want="$(cat <<EOF
${REPO}:olddead2
other.registry.example/commerce-platform:straytag
EOF
)"
assert_eq "multiple previous tags are all kept" "$want" "$got"

# --- Case 7: state file helpers (read quoted .env, atomic prev-tag merge) ---
tmpd="$(mktemp -d)"
printf "ECR_REGISTRY='x'\nPLATFORM_TAG=add97ee\nADMIN_TAG='6817a67'\n" > "$tmpd/.env"
assert_eq "read_kv plain" "add97ee" "$(commerce_deploy_read_kv "$tmpd/.env" PLATFORM_TAG)"
assert_eq "read_kv quoted" "6817a67" "$(commerce_deploy_read_kv "$tmpd/.env" ADMIN_TAG)"
assert_eq "read_kv missing file" "" "$(commerce_deploy_read_kv "$tmpd/nope" ADMIN_TAG)"
printf "PORTAL_TAG=947d385\nADMIN_TAG=old\n" > "$tmpd/.image-tags-prev"
commerce_deploy_write_prev_tags "$tmpd/.image-tags-prev" ADMIN_TAG 6817a67 PLATFORM_TAG ""
want="$(printf 'PORTAL_TAG=947d385\nADMIN_TAG=6817a67\n')"
assert_eq "write_prev_tags updates only given non-empty keys" "$want" "$(cat "$tmpd/.image-tags-prev")"
leftover="$(find "$tmpd" -name '.image-tags-prev.tmp.*' | wc -l)"
assert_eq "write_prev_tags leaves no tmp file" "0" "$leftover"
rm -rf "$tmpd"

# --- remove_keys: drops only named keys; deletes file when empty ---
tmpd="$(mktemp -d)"
printf 'PORTAL_TAG=add97ee\nADMIN_TAG=6817a67\n' > "$tmpd/p"
commerce_deploy_remove_keys "$tmpd/p" ADMIN_TAG
assert_eq "remove_keys drops only ADMIN_TAG" "PORTAL_TAG=add97ee" "$(cat "$tmpd/p")"
commerce_deploy_remove_keys "$tmpd/p" PORTAL_TAG
assert_eq "remove_keys deletes empty file" "no" "$([[ -f "$tmpd/p" ]] && echo yes || echo no)"
commerce_deploy_remove_keys "$tmpd/missing" ADMIN_TAG
assert_eq "remove_keys on missing file is a no-op" "no" "$([[ -f "$tmpd/missing" ]] && echo yes || echo no)"
rm -rf "$tmpd"

# --- parse_keep: comma-separated + repeated ---
COMMERCE_DEPLOY_KEEP=()
commerce_deploy_parse_keep "platform=947d385,admin=947d385"
commerce_deploy_parse_keep "portal=947d385"
assert_eq "parse_keep collects all pins" "PLATFORM_TAG=947d385 ADMIN_TAG=947d385 PORTAL_TAG=947d385" "${COMMERCE_DEPLOY_KEEP[*]}"
assert_eq "keep_tags_for admin" "947d385" "$(commerce_deploy_keep_tags_for ADMIN_TAG)"
assert_eq "parse_keep rejects unknown service" "1" "$(commerce_deploy_parse_keep 'nope=1' 2>/dev/null && echo 0 || echo 1)"
COMMERCE_DEPLOY_KEEP=()

# ===========================================================================
# Flow tests: run the real script end-to-end against a stateful fake docker/curl
# (temp deploy dir; nothing touches the real docker daemon or network).
# ===========================================================================

FLOW_ROOT="$(mktemp -d)"
trap 'rm -rf "$FLOW_ROOT"' EXIT
STUB_BIN="$FLOW_ROOT/bin"
mkdir -p "$STUB_BIN"

# Fake docker. State in $STUB_STATE: images.tsv (repo\ttag\tcreated\tid), running
# ("cid ref sha256:id" per line), clock (counter for CreatedAt of pulled images), log.
cat > "$STUB_BIN/docker" <<'STUB'
#!/bin/bash
S="$STUB_STATE"
echo "docker $*" >> "$S/log"
img_id() { printf '%s' "$1" | md5sum | cut -c1-12; }
case "$1" in
  images) cat "$S/images.tsv" ;;
  ps) cut -d' ' -f1 "$S/running" ;;
  inspect)
    line="$(grep "^$4 " "$S/running")"
    if [[ "$3" == *Config.Image* ]]; then echo "$line" | cut -d' ' -f2; else echo "$line" | cut -d' ' -f3; fi ;;
  rmi)
    ref="$2"
    if grep -q " ${ref} " "$S/running"; then echo "conflict: ${ref} in use" >&2; exit 1; fi
    repo="${ref%:*}"; tag="${ref##*:}"
    if ! grep -qP "^\Q${repo}\E\t\Q${tag}\E\t" "$S/images.tsv"; then echo "no such image ${ref}" >&2; exit 1; fi
    grep -vP "^\Q${repo}\E\t\Q${tag}\E\t" "$S/images.tsv" > "$S/images.new" || true
    mv "$S/images.new" "$S/images.tsv"; echo "Untagged: ${ref}" ;;
  compose)
    sub="$4"; shift 4
    case "$sub" in
      pull)
        for svc in "$@"; do
          var="${svc^^}_TAG"; tag="${!var}"; repo="reg/commerce-${svc}"
          if ! grep -qP "^\Q${repo}\E\t\Q${tag}\E\t" "$S/images.tsv"; then
            n=$(( $(cat "$S/clock") + 1 )); echo "$n" > "$S/clock"
            printf '%s\t%s\t2026-10-09 %02d:00:00 +0700 +07\t%s\n' "$repo" "$tag" "$n" "$(img_id "$repo:$tag")" >> "$S/images.tsv"
          fi
        done ;;
      up)
        for svc in "$@"; do
          case "$svc" in platform|admin|portal) ;; *) continue ;; esac
          var="${svc^^}_TAG"; tag="${!var}"; ref="reg/commerce-${svc}:${tag}"
          grep -v "^c-${svc} " "$S/running" > "$S/running.new" || true
          echo "c-${svc} ${ref} sha256:$(img_id "$ref")$(printf 'f%.0s' {1..52})" >> "$S/running.new"
          mv "$S/running.new" "$S/running"
        done ;;
      logs) printf 'booting\nDB_PASSWORD=fake-pw-value\nJWT Token fake-token-value\nboom: health failed\n' ;;
    esac ;;
esac
exit 0
STUB
cat > "$STUB_BIN/curl" <<'STUB'
#!/bin/bash
for a in "$@"; do
  case "$a" in http://*)
    port="${a#http://127.0.0.1:}"; port="${port%%/*}"
    grep -qx "$port" "$STUB_STATE/down" 2>/dev/null && exit 22 ;;
  esac
done
exit 0
STUB
chmod +x "$STUB_BIN/docker" "$STUB_BIN/curl"

# Fresh deploy dir + state matching prod today:
# platform/portal add97ee, admin 6817a67, rollback 947d385 everywhere, plus older tags.
flow_setup() {
  FLOW_DIR="$(mktemp -d "$FLOW_ROOT/case.XXXXXX")"
  mkdir -p "$FLOW_DIR/docker"
  cp "$ROOT/docker/ec2-deploy.sh" "$FLOW_DIR/docker/"
  export STUB_STATE="$FLOW_DIR/state"
  mkdir -p "$STUB_STATE"
  : > "$STUB_STATE/log"; : > "$STUB_STATE/down"; echo 0 > "$STUB_STATE/clock"
  : > "$STUB_STATE/images.tsv"; : > "$STUB_STATE/running"
  local svc cur repo
  for svc in platform admin portal; do
    repo="reg/commerce-${svc}"; cur=add97ee; [[ "$svc" == admin ]] && cur=6817a67
    {
      printf '%s\t%s\t2026-10-08 10:00:00 +0700 +07\tid%s1\n' "$repo" "$cur" "$svc"
      printf '%s\t947d385\t2026-10-07 10:00:00 +0700 +07\tid%s2\n' "$repo" "$svc"
      printf '%s\told1\t2026-09-20 10:00:00 +0700 +07\tid%s3\n' "$repo" "$svc"
      printf '%s\told2\t2026-09-10 10:00:00 +0700 +07\tid%s4\n' "$repo" "$svc"
    } >> "$STUB_STATE/images.tsv"
    echo "c-${svc} ${repo}:${cur} sha256:id${svc}1" >> "$STUB_STATE/running"
  done
  printf "ECR_REGISTRY='reg'\nPLATFORM_TAG=add97ee\nADMIN_TAG=6817a67\nPORTAL_TAG=add97ee\n" > "$FLOW_DIR/docker/.env"
}

# Run the script; sets FLOW_RC and FLOW_OUT.
flow_run() {
  FLOW_RC=0
  FLOW_OUT="$(PATH="$STUB_BIN:$PATH" COMMERCE_HEALTH_ATTEMPTS=1 COMMERCE_HEALTH_SLEEP_SEC=0 \
    "$FLOW_DIR/docker/ec2-deploy.sh" "$@" 2>&1)" || FLOW_RC=$?
}
flow_down() { printf '%s\n' "$@" > "$STUB_STATE/down"; }
has_image() { grep -qP "^reg/commerce-$1\t$2\t" "$STUB_STATE/images.tsv" && echo yes || echo no; }
kv() { commerce_deploy_read_kv "$FLOW_DIR/docker/$1" "$2"; }
rmi_count() { grep -c '^docker rmi' "$STUB_STATE/log" || true; }

# --- Flow 1: failed admin deploy, then healthy PLATFORM deploy keeps the admin rollback ---
flow_setup
flow_down 4403
flow_run newA admin
assert_eq "F1 failed admin deploy exits 1" "1" "$FLOW_RC"
assert_eq "F1 failed admin: no rmi" "0" "$(rmi_count)"
assert_eq "F1 failed admin: pending ADMIN_TAG=6817a67" "6817a67" "$(kv .image-tags-prev.pending ADMIN_TAG)"
assert_eq "F1 failed admin: prev file not created" "no" "$([[ -f "$FLOW_DIR/docker/.image-tags-prev" ]] && echo yes || echo no)"
assert_eq "F1 failed admin: secret lines filtered from logs" "0" "$(grep -cE 'fake-pw-value|fake-token-value' <<< "$FLOW_OUT" || true)"
assert_eq "F1 failed admin: non-secret log line shown" "1" "$(grep -c 'boom: health failed' <<< "$FLOW_OUT" || true)"
flow_down
: > "$STUB_STATE/log"
flow_run newP platform
assert_eq "F1 healthy platform deploy exits 0" "0" "$FLOW_RC"
assert_eq "F1 platform: admin pending entry untouched" "6817a67" "$(kv .image-tags-prev.pending ADMIN_TAG)"
assert_eq "F1 platform: admin NOT promoted to prev" "" "$(kv .image-tags-prev ADMIN_TAG)"
assert_eq "F1 platform: prev PLATFORM_TAG=add97ee" "add97ee" "$(kv .image-tags-prev PLATFORM_TAG)"
assert_eq "F1 platform: admin rollback 6817a67 kept" "yes" "$(has_image admin 6817a67)"
assert_eq "F1 platform: admin current newA kept" "yes" "$(has_image admin newA)"
assert_eq "F1 platform: admin 947d385 removed (pending exists, not first run)" "no" "$(has_image admin 947d385)"
assert_eq "F1 platform: platform newP + add97ee kept" "yes yes" "$(has_image platform newP) $(has_image platform add97ee)"
assert_eq "F1 platform: platform 947d385 removed" "no" "$(has_image platform 947d385)"
assert_eq "F1 platform: portal first-run keeps 947d385" "yes" "$(has_image portal 947d385)"
assert_eq "F1 platform: portal old1/old2 removed" "no no" "$(has_image portal old1) $(has_image portal old2)"
assert_eq "F1 platform: no system prune / volume / rmi -f" "0" "$(grep -cE 'system prune|volume|rmi -f' "$STUB_STATE/log" || true)"
# a second failed admin deploy must not overwrite the last known-good pending entry
flow_down 4403
flow_run newB admin
assert_eq "F1 second failed admin: pending still 6817a67" "6817a67" "$(kv .image-tags-prev.pending ADMIN_TAG)"
flow_down
flow_run newB admin
assert_eq "F1 healthy admin after two failures exits 0" "0" "$FLOW_RC"
assert_eq "F1 healthy admin: prev ADMIN_TAG=6817a67 (last known-good)" "6817a67" "$(kv .image-tags-prev ADMIN_TAG)"
assert_eq "F1 healthy admin: pending file gone (admin was its only entry)" "no" "$([[ -f "$FLOW_DIR/docker/.image-tags-prev.pending" ]] && echo yes || echo no)"
assert_eq "F1 healthy admin: failed newA removed, 6817a67 kept" "no yes" "$(has_image admin newA) $(has_image admin 6817a67)"

# --- Flow 2: failed portal + failed admin, then healthy ADMIN clears only admin's pending ---
flow_setup
flow_down 4404
flow_run newQ portal
assert_eq "F2 failed portal exits 1" "1" "$FLOW_RC"
flow_run newA admin
assert_eq "F2 failed admin (portal still down) exits 1" "1" "$FLOW_RC"
assert_eq "F2 pending has both entries" "add97ee 6817a67" "$(kv .image-tags-prev.pending PORTAL_TAG) $(kv .image-tags-prev.pending ADMIN_TAG)"
flow_down
flow_run newA admin
assert_eq "F2 healthy admin retry (same tag) exits 0" "0" "$FLOW_RC"
assert_eq "F2 admin promoted: prev ADMIN_TAG=6817a67" "6817a67" "$(kv .image-tags-prev ADMIN_TAG)"
assert_eq "F2 admin cleared from pending" "" "$(kv .image-tags-prev.pending ADMIN_TAG)"
assert_eq "F2 portal pending entry left alone" "add97ee" "$(kv .image-tags-prev.pending PORTAL_TAG)"
assert_eq "F2 portal: no prev entry written" "" "$(kv .image-tags-prev PORTAL_TAG)"
assert_eq "F2 portal rollback add97ee + current newQ kept" "yes yes" "$(has_image portal add97ee) $(has_image portal newQ)"
assert_eq "F2 admin 6817a67 + newA kept" "yes yes" "$(has_image admin 6817a67) $(has_image admin newA)"

# --- Flow 3: --retention-only --keep pins 947d385 instead of the CreatedAt fallback ---
flow_setup
for s in platform admin portal; do
  printf 'reg/commerce-%s\tdecoy\t2026-10-08 23:00:00 +0700 +07\tid%sd\n' "$s" "$s" >> "$STUB_STATE/images.tsv"
done
cp -r "$STUB_STATE" "$FLOW_ROOT/f3-state-copy"
flow_run --retention-only --keep platform=947d385,admin=947d385 --keep portal=947d385
assert_eq "F3 --keep retention-only exits 0" "0" "$FLOW_RC"
assert_eq "F3 --keep: 947d385 kept for all three" "yes yes yes" "$(has_image platform 947d385) $(has_image admin 947d385) $(has_image portal 947d385)"
assert_eq "F3 --keep: newer decoy removed for all three" "no no no" "$(has_image platform decoy) $(has_image admin decoy) $(has_image portal decoy)"
assert_eq "F3 --keep: seeded prev for all three" "947d385 947d385 947d385" "$(kv .image-tags-prev PLATFORM_TAG) $(kv .image-tags-prev ADMIN_TAG) $(kv .image-tags-prev PORTAL_TAG)"
assert_eq "F3 --keep: no pull/up in retention-only" "0" "$(grep -cE 'compose .* (pull|up)' "$STUB_STATE/log" || true)"
# same state without --keep: CreatedAt fallback keeps the decoy and drops 947d385
rm -rf "$STUB_STATE"; cp -r "$FLOW_ROOT/f3-state-copy" "$STUB_STATE"; rm -f "$FLOW_DIR/docker/.image-tags-prev"
flow_run --retention-only
assert_eq "F3 without --keep: CreatedAt fallback keeps decoy, drops 947d385" "yes no" "$(has_image admin decoy) $(has_image admin 947d385)"

# --- Flow 4: --keep validation, never overwrites a recorded prev, unhealthy = no cleanup ---
flow_setup
flow_run --retention-only --keep bogus=947d385
assert_eq "F4 --keep unknown service exits 1" "1" "$FLOW_RC"
flow_run --retention-only --keep 'admin=bad/tag'
assert_eq "F4 --keep invalid tag exits 1" "1" "$FLOW_RC"
flow_run --retention-only extra
assert_eq "F4 --retention-only with positional exits 1" "1" "$FLOW_RC"
assert_eq "F4 invalid invocations removed nothing" "0" "$(rmi_count)"
printf 'ADMIN_TAG=old1\n' > "$FLOW_DIR/docker/.image-tags-prev"
flow_down 4404
flow_run --retention-only --keep admin=947d385
assert_eq "F4 unhealthy retention-only exits 1, no rmi" "1 0" "$FLOW_RC $(rmi_count)"
flow_down
flow_run --retention-only --keep=admin=947d385
assert_eq "F4 --keep=... form exits 0" "0" "$FLOW_RC"
assert_eq "F4 --keep never overwrites a recorded prev" "old1" "$(kv .image-tags-prev ADMIN_TAG)"
assert_eq "F4 recorded prev old1 and pin 947d385 both kept" "yes yes" "$(has_image admin old1) $(has_image admin 947d385)"
assert_eq "F4 admin old2 removed" "no" "$(has_image admin old2)"

echo "----"
echo "passed=${pass} failed=${fail}"
[[ "$fail" -eq 0 ]]
