#!/bin/bash
# One-time: issue the first Let's Encrypt cert for commerce.joshapp.io, then start nginx + certbot
# (certbot renews every 12h, nginx reloads every 6h — no cron needed).
# Needs: DNS → this box (Cloudflare proxied is fine), SG port 80 open to Cloudflare.
#
# Usage (on the EC2, in EC2_DEPLOY_DIR/docker):  LETSENCRYPT_EMAIL=you@example.com ./ssl-init.sh
# Running it means you accept the Let's Encrypt Subscriber Agreement.
set -euo pipefail
cd "$(dirname "$0")"
[[ -f .env ]] || { echo "no .env here — run a deploy from GitHub Actions first (it writes .env)"; exit 1; }
DOMAIN=commerce.joshapp.io
COMPOSE=(docker compose -f docker-compose.prod.yml)

if [[ ! -f certbot/conf/live/$DOMAIN/fullchain.pem ]]; then
  "${COMPOSE[@]}" stop nginx 2>/dev/null || true   # standalone needs port 80
  EMAIL_ARGS=(--register-unsafely-without-email)
  [[ -n "${LETSENCRYPT_EMAIL:-}" ]] && EMAIL_ARGS=(-m "$LETSENCRYPT_EMAIL")
  "${COMPOSE[@]}" run --rm -p 80:80 --entrypoint certbot certbot \
    certonly --standalone -d "$DOMAIN" --agree-tos -n "${EMAIL_ARGS[@]}"
fi
"${COMPOSE[@]}" up -d --no-deps nginx certbot   # --no-deps: never recreate platform/admin
"${COMPOSE[@]}" ps nginx certbot
