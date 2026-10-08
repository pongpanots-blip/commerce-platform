#!/bin/bash
# Pull + restart from ECR — commerce-platform prod stack.
#
# Usage:
#   ./ec2-deploy.sh latest                  # all 3 services, same tag
#   ./ec2-deploy.sh abc1234 platform         # just the API
#   ./ec2-deploy.sh abc1234 admin portal     # both UIs
#   ./ec2-deploy.sh --retention-only         # health-check + reclaim old tags (no pull/up)
#
# Compose services: platform | admin | portal
#
# Image retention (post-deploy, only after health checks pass):
#   Keeps per service: current .env tag, previous tag from .image-tags-prev,
#   and any image used by a running container. On first run (no prev tag),
#   also keeps the newest other tag by CreatedAt. Then prunes dangling
#   images, stopped containers, and build cache. Never touches volumes.
set -euo pipefail

ALL_SERVICES=(platform admin portal)
PREV_TAGS_FILE=".image-tags-prev"
# Old tags captured before `up -d`. Promoted to PREV_TAGS_FILE only after a healthy deploy;
# kept (and honoured by retention) if the deploy fails, so a retry of the same tag — where
# .env already holds the new tag — still knows the real rollback tag.
PENDING_PREV_FILE=".image-tags-prev.pending"
HEALTH_ATTEMPTS="${COMMERCE_HEALTH_ATTEMPTS:-90}"
HEALTH_SLEEP_SEC="${COMMERCE_HEALTH_SLEEP_SEC:-2}"

# ---------------------------------------------------------------------------
# Pure helpers (sourcable by tests). No docker/deploy side effects.
# ---------------------------------------------------------------------------

# Map compose service -> TAG env key.
commerce_deploy_tag_var() {
  case "$1" in
    platform) echo PLATFORM_TAG ;;
    admin) echo ADMIN_TAG ;;
    portal) echo PORTAL_TAG ;;
    *) return 1 ;;
  esac
}

# Repo suffix for ECR image names (compose: ${ECR_REGISTRY}/commerce-<svc>).
commerce_deploy_repo_suffix() {
  case "$1" in
    platform) echo commerce-platform ;;
    admin) echo commerce-admin ;;
    portal) echo commerce-portal ;;
    *) return 1 ;;
  esac
}

# Read KEY=value from a file (last match wins). Empty if missing.
commerce_deploy_read_kv() {
  local file="$1" key="$2" line
  [[ -f "$file" ]] || { echo ""; return 0; }
  line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -1 || true)"
  line="${line#*=}"
  # .env lines may be quoted (KEY='v' / KEY="v").
  line="${line#\'}"; line="${line%\'}"
  line="${line#\"}"; line="${line%\"}"
  echo "$line"
}

# Strip "sha256:" so full IDs from `docker inspect` compare with short IDs from `docker images`.
commerce_deploy_norm_id() {
  local id="${1#sha256:}"
  echo "$id"
}

# True if repository matches */suffix or exact suffix (multi-registry safe).
commerce_deploy_repo_matches() {
  local repo="$1" suffix="$2"
  [[ "$repo" == "$suffix" || "$repo" == */"$suffix" ]]
}

# Select repository:tag refs to remove for one service.
#
# Args:
#   $1  repo suffix (e.g. commerce-platform)
#   $2  current tag (from .env); may be empty
#   $3  previous tag(s) to keep, whitespace-separated (from .image-tags-prev and any
#       pending entry); empty = first run
#   $4  images TSV: Repository<TAB>Tag<TAB>CreatedAt<TAB>ID  (one image per line)
#   $5  running refs, newline-separated (repo:tag and/or image IDs / sha256:...)
#
# Prints one "repository:tag" per line to remove. Skips <none> tags.
# Keep set: current, previous, any running match; if previous empty, also the
# newest other tag by CreatedAt (lexicographic on the CreatedAt string).
commerce_deploy_select_removable_tags() {
  local suffix="$1"
  local current_tag="${2:-}"
  local prev_tag="${3:-}"
  local images_tsv="${4:-}"
  local running_refs="${5:-}"

  local -a keep_tags=()
  local -a candidates_repo=()
  local -a candidates_tag=()
  local -a candidates_created=()
  local -a candidates_id=()

  [[ -n "$current_tag" && "$current_tag" != "<none>" ]] && keep_tags+=("$current_tag")
  local p
  for p in $prev_tag; do
    [[ "$p" != "<none>" ]] && keep_tags+=("$p")
  done

  # Running container refs: tag part of repo:tag, and full image IDs.
  local -a keep_ids=()
  local ref repo_part tag_part
  while IFS= read -r ref || [[ -n "${ref:-}" ]]; do
    [[ -z "$ref" ]] && continue
    if [[ "$ref" == *:* && "$ref" != sha256:* ]]; then
      repo_part="${ref%:*}"
      tag_part="${ref##*:}"
      if commerce_deploy_repo_matches "$repo_part" "$suffix"; then
        [[ -n "$tag_part" && "$tag_part" != "<none>" ]] && keep_tags+=("$tag_part")
      fi
    fi
    # Image ID forms (sha256:<64hex> from inspect, or bare 12..64 hex).
    if [[ "$ref" == sha256:* || "$ref" =~ ^[0-9a-f]{12,64}$ ]]; then
      keep_ids+=("$(commerce_deploy_norm_id "$ref")")
    fi
  done <<< "$running_refs"

  local repo tag created id i
  while IFS=$'\t' read -r repo tag created id || [[ -n "${repo:-}" ]]; do
    [[ -z "${repo:-}" ]] && continue
    commerce_deploy_repo_matches "$repo" "$suffix" || continue
    [[ "$tag" == "<none>" || -z "$tag" ]] && continue
    candidates_repo+=("$repo")
    candidates_tag+=("$tag")
    candidates_created+=("$created")
    candidates_id+=("$id")
  done <<< "$images_tsv"

  # First run: no previous tag → keep newest other tag (by CreatedAt desc).
  if [[ -z "$prev_tag" ]]; then
    local best_idx=-1 best_created=""
    for i in "${!candidates_tag[@]}"; do
      tag="${candidates_tag[$i]}"
      [[ "$tag" == "$current_tag" ]] && continue
      created="${candidates_created[$i]}"
      if [[ "$best_idx" -lt 0 || "$created" > "$best_created" ]]; then
        best_idx=$i
        best_created="$created"
      fi
    done
    if [[ "$best_idx" -ge 0 ]]; then
      keep_tags+=("${candidates_tag[$best_idx]}")
    fi
  fi

  # Running image IDs: keep every tag that shares that ID.
  if [[ ${#keep_ids[@]} -gt 0 && ${#candidates_id[@]} -gt 0 ]]; then
    local kid cid
    for i in "${!candidates_id[@]}"; do
      cid="$(commerce_deploy_norm_id "${candidates_id[$i]}")"
      [[ -z "$cid" ]] && continue
      for kid in "${keep_ids[@]}"; do
        if [[ "$cid" == "$kid"* || "$kid" == "$cid"* ]]; then
          keep_tags+=("${candidates_tag[$i]}")
        fi
      done
    done
  fi

  # Emit removable repo:tag (dedupe keep tags for membership checks).
  local -A keep_set=()
  for tag in "${keep_tags[@]+"${keep_tags[@]}"}"; do
    keep_set["$tag"]=1
  done

  local -A emitted=()
  for i in "${!candidates_tag[@]}"; do
    tag="${candidates_tag[$i]}"
    repo="${candidates_repo[$i]}"
    if [[ -n "${keep_set[$tag]:-}" ]]; then
      continue
    fi
    ref="${repo}:${tag}"
    [[ -n "${emitted[$ref]:-}" ]] && continue
    emitted["$ref"]=1
    printf '%s\n' "$ref"
  done
}

# ---------------------------------------------------------------------------
# Deploy helpers (use docker / filesystem).
# ---------------------------------------------------------------------------

commerce_deploy_log_disk() {
  local label="$1"
  echo "disk ${label}:"
  df -h / | tail -1 || true
  docker system df || true
}

# Atomic KEY=value merge into .image-tags-prev for the given keys.
# Args after file: pairs of KEY VALUE (only update when VALUE non-empty).
commerce_deploy_write_prev_tags() {
  local dest="$1"
  shift
  local tmp
  # Same directory as dest so mv is an atomic rename (not a cross-fs copy).
  tmp="$(mktemp "${dest}.tmp.XXXXXX")"
  # Start from existing file (preserve keys we are not updating).
  if [[ -f "$dest" ]]; then
    cp "$dest" "$tmp"
  else
    : >"$tmp"
  fi
  local key value
  while [[ $# -ge 2 ]]; do
    key="$1"
    value="$2"
    shift 2
    [[ -n "$value" ]] || continue
    if grep -qE "^${key}=" "$tmp" 2>/dev/null; then
      sed -i "/^${key}=/d" "$tmp"
    fi
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  done
  mv "$tmp" "$dest"
}

commerce_deploy_health_url() {
  case "$1" in
    platform) echo "http://127.0.0.1:3100/api" ;;
    admin) echo "http://127.0.0.1:4403/" ;;
    portal) echo "http://127.0.0.1:4404/" ;;
    *) return 1 ;;
  esac
}

# Services still failing after the last health attempt (set by commerce_deploy_wait_healthy).
COMMERCE_DEPLOY_UNHEALTHY=()

# Health-check the listed services (default: all three). Returns 0 if all OK.
commerce_deploy_wait_healthy() {
  local -a services=("$@")
  if [[ ${#services[@]} -eq 0 ]]; then
    services=("${ALL_SERVICES[@]}")
  fi
  local attempt svc url
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
    COMMERCE_DEPLOY_UNHEALTHY=()
    for svc in "${services[@]}"; do
      url="$(commerce_deploy_health_url "$svc")"
      if ! curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
        COMMERCE_DEPLOY_UNHEALTHY+=("$svc")
      fi
    done
    if [[ ${#COMMERCE_DEPLOY_UNHEALTHY[@]} -eq 0 ]]; then
      echo "health check OK (attempt ${attempt}/${HEALTH_ATTEMPTS}): ${services[*]}"
      return 0
    fi
    if [[ "$attempt" -eq "$HEALTH_ATTEMPTS" ]]; then
      echo "health check FAILED for ${COMMERCE_DEPLOY_UNHEALTHY[*]} after ${HEALTH_ATTEMPTS} attempts" >&2
      return 1
    fi
    sleep "$HEALTH_SLEEP_SEC"
  done
  return 1
}

# Print last 50 compose log lines for a service; strip password/secret/token lines.
commerce_deploy_print_safe_logs() {
  local svc="$1"
  echo "---- last 50 log lines for ${svc} (secrets filtered) ----"
  # compose may be unavailable in tests; tolerate failure.
  if command -v docker >/dev/null 2>&1; then
    docker compose -f docker-compose.prod.yml logs --tail 50 "$svc" 2>&1 \
      | grep -viE 'password|secret|token' || true
  fi
  echo "---- end logs for ${svc} ----"
}

# Collect running container image refs for commerce app services.
commerce_deploy_running_image_refs() {
  local refs=""
  local id image config_image
  # Every running container on the box (compose project or not). `docker rmi` without -f
  # also refuses images used by stopped containers, so that is a second safety net.
  if command -v docker >/dev/null 2>&1; then
    while IFS= read -r id; do
      [[ -z "$id" ]] && continue
      config_image="$(docker inspect -f '{{.Config.Image}}' "$id" 2>/dev/null || true)"
      image="$(docker inspect -f '{{.Image}}' "$id" 2>/dev/null || true)"
      [[ -n "$config_image" ]] && refs+="${config_image}"$'\n'
      [[ -n "$image" ]] && refs+="${image}"$'\n'
    done < <(docker ps -q 2>/dev/null || true)
  fi
  printf '%s' "$refs"
}

# List local images as TSV: Repository, Tag, CreatedAt, ID.
commerce_deploy_list_images_tsv() {
  docker images --format '{{.Repository}}\t{{.Tag}}\t{{.CreatedAt}}\t{{.ID}}' 2>/dev/null || true
}

# Run retention for all three app services. Assumes cwd is docker/.
commerce_deploy_run_retention() {
  echo "starting image retention for platform/admin/portal"
  commerce_deploy_log_disk "before retention"

  local images_tsv running_refs
  images_tsv="$(commerce_deploy_list_images_tsv)"
  running_refs="$(commerce_deploy_running_image_refs)"

  local svc suffix tag_var current_tag prev_tag pending_tag ref
  for svc in "${ALL_SERVICES[@]}"; do
    suffix="$(commerce_deploy_repo_suffix "$svc")"
    tag_var="$(commerce_deploy_tag_var "$svc")"
    current_tag="$(commerce_deploy_read_kv .env "$tag_var")"
    prev_tag="$(commerce_deploy_read_kv "$PREV_TAGS_FILE" "$tag_var")"
    pending_tag="$(commerce_deploy_read_kv "$PENDING_PREV_FILE" "$tag_var")"
    if [[ -n "$pending_tag" && "$pending_tag" != "$prev_tag" ]]; then
      prev_tag="${prev_tag:+$prev_tag }$pending_tag"
    fi
    echo "retention ${svc}: current=${current_tag:-<none>} keep-prev=${prev_tag:-<none (first run)>}"
    while IFS= read -r ref || [[ -n "${ref:-}" ]]; do
      [[ -z "${ref:-}" ]] && continue
      echo "docker rmi ${ref}"
      if ! docker rmi "$ref"; then
        echo "warning: docker rmi ${ref} failed (continuing)" >&2
      fi
    done < <(commerce_deploy_select_removable_tags \
      "$suffix" "$current_tag" "$prev_tag" "$images_tsv" "$running_refs")
  done

  docker image prune -f || true
  docker container prune -f || true
  docker builder prune -af || true

  commerce_deploy_log_disk "after retention"
  echo "image retention finished"
}

# Print filtered logs for the services that failed the last health check, then exit 1.
# Nothing is cleaned up and .image-tags-prev is not touched.
commerce_deploy_fail_unhealthy() {
  local svc
  for svc in "${COMMERCE_DEPLOY_UNHEALTHY[@]+"${COMMERCE_DEPLOY_UNHEALTHY[@]}"}"; do
    commerce_deploy_print_safe_logs "$svc"
  done
  echo "skipping ALL image cleanup after failed health check" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Main (skipped when sourced)
# ---------------------------------------------------------------------------

commerce_deploy_main() {
  local SCRIPT_DIR
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "$SCRIPT_DIR"

  # --- retention-only mode ---
  if [[ "${1:-}" == "--retention-only" ]]; then
    shift || true
    if [[ $# -gt 0 ]]; then
      echo "usage: $0 --retention-only" >&2
      exit 1
    fi
    echo "retention-only: checking health of all app services first"
    # Check all three: retention reclaims tags for every service, so an
    # unhealthy sibling must not lose its rollback images.
    if ! commerce_deploy_wait_healthy "${ALL_SERVICES[@]}"; then
      commerce_deploy_fail_unhealthy
    fi
    commerce_deploy_run_retention
    return 0
  fi

  local TAG="${1:-latest}"
  shift || true
  local -a SERVICES=("$@")
  if [[ ${#SERVICES[@]} -eq 0 ]]; then
    SERVICES=("${ALL_SERVICES[@]}")
  fi

  local -a TAG_VARS=()
  local -a OLD_TAGS=()
  local svc TAG_VAR old_tag
  for svc in "${SERVICES[@]}"; do
    TAG_VAR="$(commerce_deploy_tag_var "$svc")" || {
      echo "unknown service: $svc" >&2
      exit 1
    }
    old_tag="$(commerce_deploy_read_kv .env "$TAG_VAR")"
    # Re-deploy of the tag already in .env (e.g. retry after a failed health check): fall back
    # to the pending old tag captured by that failed run.
    if [[ -z "$old_tag" || "$old_tag" == "$TAG" ]]; then
      old_tag="$(commerce_deploy_read_kv "$PENDING_PREV_FILE" "$TAG_VAR")"
    fi
    OLD_TAGS+=("$old_tag")
    export "$TAG_VAR=$TAG"
    TAG_VARS+=("$TAG_VAR")
  done

  local -a COMPOSE=(docker compose -f docker-compose.prod.yml)
  # env_file of platform (cutover flags) must exist even when no flags are set.
  touch platform-flags.env

  # Optional sidecar for Jagota gateway (josh via-commerce). Survives deploy-ecr.yml's
  # .env rewrite (which only knows its listed keys). Create once on the box:
  #   printf "%s\n" "JAGOTA_GATEWAY_ENABLED=true" \
  #     "JAGOTA_NODEAPI_BASE_URL=https://nodeapi-staging.jagota.com" \
  #     "JAGOTA_NODEAPI_USERNAME=..." "JAGOTA_NODEAPI_PASSWORD=..." \
  #     > .env.jagota-gateway && chmod 600 .env.jagota-gateway
  # Then re-run this deploy (or compose up -d platform).
  if [[ -f .env.jagota-gateway ]]; then
    echo "merging .env.jagota-gateway into .env"
    touch .env
    local line key
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
      key="${line%%=*}"
      [[ "$key" == JAGOTA_* ]] || continue
      sed -i "/^${key}=/d" .env
      printf '%s\n' "$line" >> .env
    done < .env.jagota-gateway
  fi

  # Disk snapshot + dangling-only prune before pull. Do NOT use until=48h:
  # tagged deploy images are older than 48h and stayed forever, filling the disk.
  # Aggressive reclaim happens AFTER a healthy deploy (see retention below).
  commerce_deploy_log_disk "before pull"
  docker image prune -f || true

  "${COMPOSE[@]}" pull "${SERVICES[@]}"
  # Schema first: the app never runs migrations itself (migrationsRun is off). A failed migration
  # stops the deploy before the new platform container replaces the running one.
  if [[ " ${SERVICES[*]} " == *" platform "* ]]; then
    "${COMPOSE[@]}" run --rm --no-deps platform node node_modules/typeorm/cli.js migration:run -d src/data-source.js
  fi
  # Capture old tags (only where they differ from the new one) before replacing containers.
  local -a pending_pairs=()
  local i
  for i in "${!SERVICES[@]}"; do
    if [[ -n "${OLD_TAGS[$i]}" && "${OLD_TAGS[$i]}" != "$TAG" ]]; then
      pending_pairs+=("${TAG_VARS[$i]}" "${OLD_TAGS[$i]}")
    fi
  done
  if [[ ${#pending_pairs[@]} -gt 0 ]]; then
    commerce_deploy_write_prev_tags "$PENDING_PREV_FILE" "${pending_pairs[@]}"
  fi

  "${COMPOSE[@]}" up -d "${SERVICES[@]}"
  # Remember the running tags in .env, so later partial deploys and manual compose commands
  # don't fall back to a :latest tag that CI never pushes.
  touch .env
  local v
  for v in "${TAG_VARS[@]}"; do
    sed -i "/^$v=/d" .env
    echo "$v=$TAG" >> .env
  done
  # Public edge, once the first cert exists (./ssl-init.sh issues it). --no-deps: never touch the apps.
  if [[ -f certbot/conf/renewal/commerce.joshapp.io.conf ]]; then  # live/ is root-only (0700); renewal/ is readable
    "${COMPOSE[@]}" up -d --no-deps nginx certbot
  fi

  # Health-check all three app services (not only the ones just deployed).
  # Retention below reclaims images for every service; a broken undeployed
  # sibling must block cleanup so its rollback tag stays on disk.
  echo "waiting for health of all app services after deploy"
  if ! commerce_deploy_wait_healthy "${ALL_SERVICES[@]}"; then
    commerce_deploy_fail_unhealthy
  fi

  # Record previous tags only after a healthy deploy, only for services we
  # actually moved, and only when the old tag differs from the new one.
  local -a prev_pairs=()
  for i in "${!SERVICES[@]}"; do
    old_tag="${OLD_TAGS[$i]}"
    TAG_VAR="${TAG_VARS[$i]}"
    if [[ -n "$old_tag" && "$old_tag" != "$TAG" ]]; then
      prev_pairs+=("$TAG_VAR" "$old_tag")
      echo "recording previous ${TAG_VAR}=${old_tag} (new=${TAG})"
    fi
  done
  if [[ ${#prev_pairs[@]} -gt 0 ]]; then
    commerce_deploy_write_prev_tags "$PREV_TAGS_FILE" "${prev_pairs[@]}"
  fi
  rm -f "$PENDING_PREV_FILE"

  commerce_deploy_run_retention
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  commerce_deploy_main "$@"
fi
