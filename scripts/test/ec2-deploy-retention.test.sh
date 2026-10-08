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

echo "----"
echo "passed=${pass} failed=${fail}"
[[ "$fail" -eq 0 ]]
