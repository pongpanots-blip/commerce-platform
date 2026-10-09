#!/bin/bash
# Pull + restart from ECR — commerce-platform prod stack.
#
# Usage:
#   ./ec2-deploy.sh latest                  # all 3 services, same tag
#   ./ec2-deploy.sh abc1234 platform         # just the API
#   ./ec2-deploy.sh abc1234 admin portal     # both UIs
#   ./ec2-deploy.sh --retention-only         # health-check + reclaim old tags (no pull/up)
#   ./ec2-deploy.sh --retention-only --keep platform=947d385 --keep admin=947d385,portal=947d385
#
# Compose services: platform | admin | portal
#
# --keep <service>=<tag>[,<service>=<tag>...]  (repeatable; any mode)
#   Pins a tag so this run's retention never removes it, and seeds it as that service's
#   previous tag in .image-tags-prev when the service has no recorded previous tag yet
#   (never overwrites one). Use it on the first run to choose the rollback tag explicitly
#   instead of the "newest other by CreatedAt" fallback.
#
# Image retention (post-deploy, only after health checks pass), per service:
#   keep the current .env tag, every tag recorded for it in .image-tags-prev or
#   .image-tags-prev.pending, any --keep pin, and any image used by a running container.
#   When none of prev/pending/--keep has an entry for the service (first run), also keep
#   the newest other tag by CreatedAt. Then prune dangling images, stopped containers and
#   build cache. Never touches volumes, never `docker system prune`.
#
# State files (deploy dir, per service, KEY=value with PLATFORM_TAG/ADMIN_TAG/PORTAL_TAG):
#   .image-tags-prev          last known-good previous tag per service
#   .image-tags-prev.pending  tag that was live before a deploy of that service started;
#                             promoted to .image-tags-prev (and removed from pending) only
#                             when THAT service is deployed healthy. Entries for other
#                             services are never touched by a partial deploy.
set -euo pipefail

ALL_SERVICES=(platform admin portal)
PREV_TAGS_FILE=".image-tags-prev"
PENDING_PREV_FILE=".image-tags-prev.pending"
# --keep pins for this run: "TAG_VAR=tag" entries.
COMMERCE_DEPLOY_KEEP=()
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

# Atomically remove KEYs from a KEY=value state file. Deletes the file if it ends up empty.
commerce_deploy_remove_keys() {
  local dest="$1"
  shift
  [[ -f "$dest" ]] || return 0
  local tmp key
  tmp="$(mktemp "${dest}.tmp.XXXXXX")"
  cp "$dest" "$tmp"
  for key in "$@"; do
    sed -i "/^${key}=/d" "$tmp"
  done
  if [[ -s "$tmp" ]]; then
    mv "$tmp" "$dest"
  else
    rm -f "$tmp" "$dest"
  fi
}

# Parse one --keep value ("svc=tag[,svc=tag...]") into COMMERCE_DEPLOY_KEEP.
# Returns 1 (with a message) on an unknown service or a malformed tag.
commerce_deploy_parse_keep() {
  local spec="$1" item svc tag tag_var
  local -a items=()
  IFS=',' read -r -a items <<< "$spec"
  if [[ ${#items[@]} -eq 0 ]]; then
    echo "--keep needs <service>=<tag>" >&2
    return 1
  fi
  for item in "${items[@]}"; do
    [[ -z "$item" ]] && continue
    if [[ "$item" != *=* ]]; then
      echo "--keep: expected <service>=<tag>, got '${item}'" >&2
      return 1
    fi
    svc="${item%%=*}"
    tag="${item#*=}"
    if ! tag_var="$(commerce_deploy_tag_var "$svc")"; then
      echo "--keep: unknown service '${svc}' (platform|admin|portal)" >&2
      return 1
    fi
    if [[ ! "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
      echo "--keep: invalid tag '${tag}' for ${svc}" >&2
      return 1
    fi
    COMMERCE_DEPLOY_KEEP+=("${tag_var}=${tag}")
  done
}

# Space-separated --keep tags for one TAG_VAR (empty if none).
commerce_deploy_keep_tags_for() {
  local tag_var="$1" entry out=""
  for entry in "${COMMERCE_DEPLOY_KEEP[@]+"${COMMERCE_DEPLOY_KEEP[@]}"}"; do
    [[ "${entry%%=*}" == "$tag_var" ]] && out="${out:+$out }${entry#*=}"
  done
  printf '%s' "$out"
}

# Seed .image-tags-prev with --keep pins for services that have no previous tag yet.
commerce_deploy_seed_keep_prev() {
  local entry tag_var tag
  local -a pairs=()
  local -A seen=()
  for entry in "${COMMERCE_DEPLOY_KEEP[@]+"${COMMERCE_DEPLOY_KEEP[@]}"}"; do
    tag_var="${entry%%=*}"
    tag="${entry#*=}"
    [[ -n "${seen[$tag_var]:-}" ]] && continue
    seen["$tag_var"]=1
    if [[ -z "$(commerce_deploy_read_kv "$PREV_TAGS_FILE" "$tag_var")" ]]; then
      pairs+=("$tag_var" "$tag")
      echo "seeding previous ${tag_var}=${tag} from --keep"
    fi
  done
  if [[ ${#pairs[@]} -gt 0 ]]; then
    commerce_deploy_write_prev_tags "$PREV_TAGS_FILE" "${pairs[@]}"
  fi
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

  local svc suffix tag_var current_tag prev_tag pending_tag keep_tags ref
  local -a keep_list=()
  for svc in "${ALL_SERVICES[@]}"; do
    suffix="$(commerce_deploy_repo_suffix "$svc")"
    tag_var="$(commerce_deploy_tag_var "$svc")"
    current_tag="$(commerce_deploy_read_kv .env "$tag_var")"
    prev_tag="$(commerce_deploy_read_kv "$PREV_TAGS_FILE" "$tag_var")"
    pending_tag="$(commerce_deploy_read_kv "$PENDING_PREV_FILE" "$tag_var")"
    keep_tags="$(commerce_deploy_keep_tags_for "$tag_var")"
    # Every tag named in .image-tags-prev, .image-tags-prev.pending or --keep is kept.
    # Empty only when none of them has an entry -> first-run "newest other" rule applies.
    read -r -a keep_list <<< "${prev_tag} ${pending_tag} ${keep_tags}"
    prev_tag="${keep_list[*]+"${keep_list[*]}"}"
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

  # Split options (--retention-only, --keep) from positionals (TAG, services...).
  local retention_only=0
  local -a positional=()
  COMMERCE_DEPLOY_KEEP=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --retention-only) retention_only=1; shift ;;
      --keep)
        [[ $# -ge 2 ]] || { echo "--keep needs <service>=<tag>" >&2; exit 1; }
        commerce_deploy_parse_keep "$2" || exit 1
        shift 2 ;;
      --keep=*) commerce_deploy_parse_keep "${1#--keep=}" || exit 1; shift ;;
      --*) echo "unknown option: $1" >&2; exit 1 ;;
      *) positional+=("$1"); shift ;;
    esac
  done

  # --- retention-only mode ---
  if [[ "$retention_only" -eq 1 ]]; then
    if [[ ${#positional[@]} -gt 0 ]]; then
      echo "usage: $0 --retention-only [--keep <service>=<tag>[,...]]..." >&2
      exit 1
    fi
    echo "retention-only: checking health of all app services first"
    # Check all three: retention reclaims tags for every service, so an
    # unhealthy sibling must not lose its rollback images.
    if ! commerce_deploy_wait_healthy "${ALL_SERVICES[@]}"; then
      commerce_deploy_fail_unhealthy
    fi
    commerce_deploy_seed_keep_prev
    commerce_deploy_run_retention
    return 0
  fi

  local TAG="${positional[0]:-latest}"
  local -a SERVICES=("${positional[@]:1}")
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
    OLD_TAGS+=("$(commerce_deploy_read_kv .env "$TAG_VAR")")
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

  # Per deployed service, remember the tag that was live before this deploy in the pending
  # file. If the service already has a pending entry, an earlier deploy of it did not finish
  # healthy: that entry is still its last known-good tag, so it is kept, not overwritten
  # with the (unhealthy) tag currently in .env. Other services' entries are left alone.
  local -a pending_pairs=()
  local i pending_tag
  for i in "${!SERVICES[@]}"; do
    TAG_VAR="${TAG_VARS[$i]}"
    old_tag="${OLD_TAGS[$i]}"
    pending_tag="$(commerce_deploy_read_kv "$PENDING_PREV_FILE" "$TAG_VAR")"
    if [[ -z "$pending_tag" && -n "$old_tag" && "$old_tag" != "$TAG" ]]; then
      pending_pairs+=("$TAG_VAR" "$old_tag")
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

  # Healthy: for each service deployed in THIS run only, promote its pending entry into
  # .image-tags-prev (merge) and drop just that entry from pending. A pending entry equal to
  # the new tag (rollback to the last known-good) is dropped without touching prev.
  local -a prev_pairs=()
  local -a done_keys=()
  for i in "${!SERVICES[@]}"; do
    TAG_VAR="${TAG_VARS[$i]}"
    pending_tag="$(commerce_deploy_read_kv "$PENDING_PREV_FILE" "$TAG_VAR")"
    if [[ -n "$pending_tag" && "$pending_tag" != "$TAG" ]]; then
      prev_pairs+=("$TAG_VAR" "$pending_tag")
      echo "recording previous ${TAG_VAR}=${pending_tag} (new=${TAG})"
    fi
    done_keys+=("$TAG_VAR")
  done
  if [[ ${#prev_pairs[@]} -gt 0 ]]; then
    commerce_deploy_write_prev_tags "$PREV_TAGS_FILE" "${prev_pairs[@]}"
  fi
  commerce_deploy_remove_keys "$PENDING_PREV_FILE" "${done_keys[@]}"
  commerce_deploy_seed_keep_prev

  commerce_deploy_run_retention
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  commerce_deploy_main "$@"
fi
