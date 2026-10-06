#!/bin/bash
# Pull + restart from ECR — commerce-platform prod stack.
#
# Usage:
#   ./ec2-deploy.sh latest                  # all 3 services, same tag
#   ./ec2-deploy.sh abc1234 platform         # just the API
#   ./ec2-deploy.sh abc1234 admin portal     # both UIs
#
# Compose services: platform | admin | portal
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ALL_SERVICES=(platform admin portal)

TAG="${1:-latest}"
shift || true
SERVICES=("$@")
if [[ ${#SERVICES[@]} -eq 0 ]]; then
  SERVICES=("${ALL_SERVICES[@]}")
fi

TAG_VARS=()
for svc in "${SERVICES[@]}"; do
  case "$svc" in
    platform) TAG_VAR=PLATFORM_TAG ;;
    admin) TAG_VAR=ADMIN_TAG ;;
    portal) TAG_VAR=PORTAL_TAG ;;
    *) echo "unknown service: $svc"; exit 1 ;;
  esac
  export "$TAG_VAR=$TAG"
  TAG_VARS+=("$TAG_VAR")
done

COMPOSE=(docker compose -f docker-compose.prod.yml)
"${COMPOSE[@]}" pull "${SERVICES[@]}"
# Schema first: the app never runs migrations itself (migrationsRun is off). A failed migration
# stops the deploy before the new platform container replaces the running one.
if [[ " ${SERVICES[*]} " == *" platform "* ]]; then
  "${COMPOSE[@]}" run --rm --no-deps platform node node_modules/typeorm/cli.js migration:run -d src/data-source.js
fi
"${COMPOSE[@]}" up -d "${SERVICES[@]}"
# Remember the running tags in .env, so later partial deploys and manual compose commands
# don't fall back to a :latest tag that CI never pushes.
touch .env
for v in "${TAG_VARS[@]}"; do sed -i "/^$v=/d" .env; echo "$v=$TAG" >> .env; done
# Public edge, once the first cert exists (./ssl-init.sh issues it). --no-deps: never touch the apps.
if [[ -f certbot/conf/renewal/commerce.joshapp.io.conf ]]; then  # live/ is root-only (0700); renewal/ is readable
  "${COMPOSE[@]}" up -d --no-deps nginx certbot
fi
docker image prune -f
