#!/bin/bash
# Existing container credentials only. Reads tags/metadata; run mode permits the approved DDL.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/ec2-deploy.sh"
[[ $# -eq 2 && ( "$1" == preflight || "$1" == run ) ]] || { echo 'invalid migration gate arguments' >&2; exit 1; }
mode="$1"
[[ -n "${ECR_REGISTRY:-}" && -n "${MIGRATION_SCOPE_COMMIT:-}" && -n "${MIGRATION_SCOPE_IMAGE_TAG:-}" ]] || { echo 'migration gate configuration missing' >&2; exit 1; }
[[ -r "$SCRIPT_DIR/platform-migration-scope.cjs" && -r "$SCRIPT_DIR/platform-migration-policy.json" ]] || { echo 'migration gate files missing' >&2; exit 1; }
cd "$2"
scope_env=(--env "MIGRATION_SCOPE_COMMIT=$MIGRATION_SCOPE_COMMIT" --env "MIGRATION_SCOPE_IMAGE_TAG=$MIGRATION_SCOPE_IMAGE_TAG")
for svc in platform admin portal; do
  id="$(docker compose -f docker-compose.prod.yml ps -q "$svc")"
  [[ -n "$id" && "$id" != *$'\n'* ]] || { echo 'expected one running application container' >&2; exit 1; }
  tag="$(commerce_deploy_read_kv .env "$(commerce_deploy_tag_var "$svc")")"
  ref="$(docker inspect -f '{{.Config.Image}}' "$id")"
  [[ -n "$tag" && "$ref" == "$ECR_REGISTRY/commerce-$svc:$tag" ]] || { echo 'application image/tag mismatch' >&2; exit 1; }
  scope_env+=(--env "MIGRATION_SCOPE_${svc^^}_TAG=$tag")
  [[ "$svc" != platform ]] || platform_id="$id"
done
running_preflight() {
  # Copy-free execution: helpers are streamed to the existing platform, not written inside it.
  policy="$(base64 -w0 "$SCRIPT_DIR/platform-migration-policy.json")"
  { printf 'const policy = JSON.parse(Buffer.from("%s", "base64").toString());\n' "$policy"
    sed "s@const policy = JSON.parse(fs.readFileSync(path.join(__dirname, 'platform-migration-policy.json'), 'utf8'));@@" "$SCRIPT_DIR/platform-migration-scope.cjs"
  } | docker exec -i "${scope_env[@]}" "$platform_id" node - preflight
}
if [[ "$mode" == preflight ]]; then
  running_preflight
else
  # Bind the target connection and runtime configuration to the running platform.
  # Only the single aggregate hash is passed; configuration values stay in containers.
  verified="$(running_preflight)"
  printf '%s\n' "$verified"
  fingerprint="$(printf '%s\n' "$verified" | sed -n 's/^migration scope fingerprint: //p')"
  [[ "$fingerprint" =~ ^[a-f0-9]{64}$ ]] || { echo 'running configuration fingerprint missing' >&2; exit 1; }
  scope_env+=(--env "MIGRATION_SCOPE_EXPECTED_FINGERPRINT=$fingerprint")
  # Target image is selected by the caller's PLATFORM_TAG. Mount only immutable gate files.
  docker compose -f docker-compose.prod.yml run --rm --no-deps \
    --volume "$SCRIPT_DIR/platform-migration-scope.cjs:/cp-deploy/platform-migration-scope.cjs:ro" \
    --volume "$SCRIPT_DIR/platform-migration-policy.json:/cp-deploy/platform-migration-policy.json:ro" \
    "${scope_env[@]}" platform node /cp-deploy/platform-migration-scope.cjs run
fi
