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

for svc in "${SERVICES[@]}"; do
  case "$svc" in
    platform) TAG_VAR=PLATFORM_TAG ;;
    admin) TAG_VAR=ADMIN_TAG ;;
    portal) TAG_VAR=PORTAL_TAG ;;
    *) echo "unknown service: $svc"; exit 1 ;;
  esac
  export "$TAG_VAR=$TAG"
done

docker compose -f docker-compose.prod.yml pull "${SERVICES[@]}"
docker compose -f docker-compose.prod.yml up -d "${SERVICES[@]}"
docker image prune -f
