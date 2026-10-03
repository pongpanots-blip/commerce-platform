# Sourced by the e2e scripts: admin endpoints need a staff token since the
# platform became default-deny. Create the account once with
#   STAFF_PASSWORD=... npm run create-staff -- e2e-admin@example.com admin
# then export CP_STAFF_EMAIL / CP_STAFF_PASSWORD before running a script.
: "${CP_STAFF_EMAIL:?set CP_STAFF_EMAIL (a staff account, see _staff-token.sh)}"
: "${CP_STAFF_PASSWORD:?set CP_STAFF_PASSWORD}"
STAFF_TOKEN=$(curl -sf -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg e "$CP_STAFF_EMAIL" --arg p "$CP_STAFF_PASSWORD" '{email:$e,password:$p}')" | jq -r .accessToken)
[ -n "$STAFF_TOKEN" ] && [ "$STAFF_TOKEN" != "null" ] || { echo "staff login failed" >&2; exit 1; }
