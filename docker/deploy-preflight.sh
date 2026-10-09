#!/bin/bash
# Read-only target and rollback checks for deployments that explicitly disable cleanup.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/ec2-deploy.sh"
fail() { echo "deployment preflight failed: $1" >&2; exit 1; }
[[ $# -eq 1 && -d "$1" ]] || fail "existing deploy directory is unavailable"
[[ -n "${ECR_REGISTRY:-}" ]] || fail "ECR registry is not configured"
cd "$1"
[[ -r docker-compose.prod.yml && -r .env ]] || fail "existing Compose configuration is unavailable"
[[ -r nginx/commerce-proxy.conf ]] || fail "existing public proxy configuration is unavailable"
grep -Eq '^[[:space:]]*server_name[[:space:]]+commerce\.joshapp\.io;' nginx/commerce-proxy.conf || fail "public proxy target is not commerce.joshapp.io"

for svc in "${ALL_SERVICES[@]}"; do
  id="$(docker compose -f docker-compose.prod.yml ps -q "$svc")" || fail "cannot inspect $svc container"
  [[ -n "$id" && "$id" != *$'\n'* ]] || fail "expected one running $svc container"
  ref="$(docker inspect -f '{{.Config.Image}}' "$id")" || fail "cannot inspect $svc image reference"
  tag="$(commerce_deploy_read_kv .env "$(commerce_deploy_tag_var "$svc")")"
  [[ -n "$tag" && "$ref" == "${ECR_REGISTRY}/commerce-${svc}:${tag}" ]] || fail "$svc running image differs from configured tag or registry"
  image_id="$(docker inspect -f '{{.Image}}' "$id")" || fail "cannot inspect $svc image identity"
  [[ "$image_id" == sha256:* ]] || fail "$svc image identity is unavailable"
  rollback_id="$(docker image inspect -f '{{.Id}}' "$ref" 2>/dev/null)" || fail "$svc rollback image is not available locally"
  [[ "$rollback_id" == "$image_id" ]] || fail "$svc rollback tag points to a different image from the running container"
  printf 'verified current %s image: tag=%s id=%s\n' "$svc" "$tag" "$image_id"
done
commerce_deploy_wait_healthy "${ALL_SERVICES[@]}" || fail "existing applications are not all healthy"
echo "verified production proxy target and locally available healthy rollback images; no state changed"
