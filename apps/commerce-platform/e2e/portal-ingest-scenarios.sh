#!/usr/bin/env bash
# Developer portal + ERP inbound ingest + ERP order push e2e (scenarios P / I / O).
#
# Prereqs (see apps/commerce-platform/README.md):
#   - platform running on :3100 with PORTAL_JWT_SECRET set and
#     PORTAL_SELF_REGISTER=true (P1 registers a fresh account); jq, curl,
#     openssl, psql installed
#   - STOREFRONT_API_KEYS must include the KEY this script uses as its env
#     fallback (default "e2e-key") for helper calls (products, erp-stub/stock,
#     admin) — P3/P4 exercise a freshly portal-issued DB-backed key instead.
#   - psql reachable at $PGHOST/$PGUSER_/$PGDATABASE (defaults: localhost /
#     pongpanot_s / commerce_db) — used for (a) the 'erp' integration's
#     signing_secret (see "Webhook signature" note below) and (b) the O
#     scenario's order_mappings check, per the task brief.
#
# Webhook signature note: WebhookReceiverService.verify() rejects a request
# unless BOTH a signingSecret is configured on the integration row AND a
# matching X-Signature header is sent — an integration row with NO
# signingSecret accepts NOTHING, signed or unsigned (verified live: a plain
# unsigned POST against the pre-existing 'erp' row from the 3a e2e runs, which
# has no signingSecret, returns 401 "Invalid webhook signature"). So this
# script ensures the 'erp' integration carries a known signing secret
# (idempotently, via psql — there is no PATCH endpoint for signingSecret) and
# HMAC-SHA256-signs each of the 4 Oracle payloads with it, matching what a
# real ERP producer would do.
#
# I3 customer-code precedence: applying the ERP customer.changed payload sets
# customers.code = 'JGT-00871' (the real ERP account number). A field-ownership
# guard in StorefrontCustomersService.syncToErp (added alongside this script
# after live verification caught a clobber bug) makes sure a subsequent
# storefront POST /v1/storefront/customers with the same email does NOT
# overwrite that with a synthetic mock code.
#
# Re-run tolerance: ingest fixtures may already exist from a previous run
# (e.g. sku FISH-SALMON-1KG). Every assertion below targets END-STATE values
# (catalog price/stock, most-recent ingest row per externalId) rather than
# "a row was created just now", so repeated runs against the same DB pass.
set -euo pipefail
API=${API:-http://localhost:3100/api}
source "$(dirname "$0")/_staff-token.sh"
KEY=${KEY:-e2e-key}
PGHOST=${PGHOST:-localhost}
PG_USER=${PGUSER:-pongpanot_s}
PGDATABASE=${PGDATABASE:-commerce_db}
ERP_SECRET_DEFAULT=${ERP_SIGNING_SECRET:-e2e-erp-secret}

req()   { curl -sf -H 'Content-Type: application/json' -H "X-Api-Key: $KEY" -H "Authorization: Bearer $STAFF_TOKEN" "$@"; }
httpcode(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }
psqlc() { psql -h "$PGHOST" -U "$PG_USER" -d "$PGDATABASE" -tAc "$1"; }
assert(){ if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (got '$2', want '$3')"; exit 1; fi }
idem_key(){ if command -v uuidgen > /dev/null 2>&1; then uuidgen; else echo "$(date +%s%N)-$RANDOM"; fi }

##############################################################################
# P: portal loop (register -> login -> key lifecycle -> webhook self-service)
##############################################################################
echo "== P1: register (random email) =="
EMAIL="e2e-portal-$RANDOM-$$@example.com"
PASSWORD="hunter2pass12"
P1_CODE=$(httpcode -X POST "$API/v1/portal/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
assert "P1 register 201" "$P1_CODE" "201"

echo "== P2: login =="
LOGIN=$(curl -sf -X POST "$API/v1/portal/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(echo "$LOGIN" | jq -r .accessToken)
assert "P2 login returned a token" "$([ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && echo yes || echo no)" "yes"

echo "== P3: create key =="
KEYRES=$(curl -sf -X POST "$API/v1/portal/keys" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"e2e portal key"}')
FULLKEY=$(echo "$KEYRES" | jq -r .fullKey)
KEY_ID=$(echo "$KEYRES" | jq -r .id)
assert "P3 fullKey is ck_live_*" "$(echo "$FULLKEY" | cut -c1-8)" "ck_live_"

echo "== P4: catalog with the new key =="
P4_CODE=$(httpcode -H "X-Api-Key: $FULLKEY" "$API/v1/storefront/catalog/products")
assert "P4 catalog 200 with portal-issued key" "$P4_CODE" "200"

echo "== P5: revoke =="
curl -sf -X POST "$API/v1/portal/keys/$KEY_ID/revoke" -H "Authorization: Bearer $TOKEN" > /dev/null
# The guard has an in-memory ~30s positive cache keyed by the raw key string,
# so an immediate re-call with $FULLKEY can still succeed inside that window
# (documented in README) — assert against the keys list (DB truth) instead of
# sleeping 31s or racing the cache.
ACTIVE_AFTER_REVOKE=$(curl -sf "$API/v1/portal/keys" -H "Authorization: Bearer $TOKEN" \
  | jq -r --arg id "$KEY_ID" '.[] | select(.id==$id) | .active')
assert "P5 revoked key shows active=false in list" "$ACTIVE_AFTER_REVOKE" "false"

echo "== P6: webhook subscription + test-send =="
WH=$(curl -sf -X POST "$API/v1/portal/webhooks" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"E2E dead sink","targetUrl":"http://127.0.0.1:9/dead","eventTypes":["order.confirmed"]}')
WH_ID=$(echo "$WH" | jq -r .id)
assert "P6 webhook subscribed to order.confirmed" "$(echo "$WH" | jq -r '.eventTypes[0]')" "order.confirmed"

WH_TEST_BODY=$(mktemp)
trap 'rm -f "$WH_TEST_BODY"' EXIT
WH_TEST_CODE=$(curl -s -o "$WH_TEST_BODY" -w '%{http_code}' -X POST \
  "$API/v1/portal/webhooks/$WH_ID/test" -H "Authorization: Bearer $TOKEN")
assert "P6 test-send http status" "$WH_TEST_CODE" "201"
assert "P6 test-send has ok/status fields" "$(jq 'has("ok") and has("status")' < "$WH_TEST_BODY")" "true"
# dead sink (nothing listens on 127.0.0.1:9) -> delivery refused, ok:false
assert "P6 test-send ok:false against dead sink" "$(jq -r .ok < "$WH_TEST_BODY")" "false"

##############################################################################
# I: ERP inbound ingestion (the 4 Oracle examples, spec §5, used verbatim)
##############################################################################
echo "== I: ensure the 'erp' integration carries a known signing secret =="
ERP_ID=$(req "$API/integrations?page=1&pageSize=100" | jq -r '(.items? // .)[] | select(.type=="erp") | .id' | head -1)
if [ -z "$ERP_ID" ]; then
  ERP_ID=$(req -X POST "$API/integrations" \
    -d "{\"name\":\"ERP (Oracle)\",\"type\":\"erp\",\"signingSecret\":\"$ERP_SECRET_DEFAULT\"}" | jq -r .id)
fi
# idempotent: only sets the secret if the row (e.g. left over from a prior
# 3a/3b e2e run) doesn't already have one — never clobbers an existing secret.
psqlc "update integrations set signing_secret = coalesce(signing_secret, '$ERP_SECRET_DEFAULT') where id = '$ERP_ID'" > /dev/null
ERP_SECRET=$(psqlc "select signing_secret from integrations where id = '$ERP_ID'")

sign() { printf '%s' "$1" | openssl dgst -sha256 -hmac "$ERP_SECRET" | awk '{print $2}'; }
post_erp() { # $1 = raw JSON body
  curl -s -X POST "$API/webhooks/erp" -H 'Content-Type: application/json' -H "X-Signature: $(sign "$1")" -d "$1"
}
poll_ingest_status() { # $1 entityType, $2 externalId -> prints the newest matching row's status (or "")
  req "$API/admin/erp-ingest?entityType=$1&pageSize=50" \
    | jq -r --arg ext "$2" '[.items[] | select(.externalId==$ext)][0].status // ""'
}
wait_for_ingest() { # $1 entityType, $2 externalId, $3 want status, $4 label
  local status=""
  for _ in $(seq 1 15); do
    status=$(poll_ingest_status "$1" "$2")
    [ "$status" = "$3" ] && break
    sleep 1
  done
  assert "$4" "$status" "$3"
}

echo "== I1: product.changed =="
PRODUCT_PAYLOAD='{ "event_type": "product.changed", "item": {
  "INVENTORY_ITEM_ID": 10001, "SEGMENT1": "FISH-SALMON-1KG",
  "DESCRIPTION": "Salmon Fillet 1kg", "PRIMARY_UOM_CODE": "KG",
  "INVENTORY_ITEM_STATUS_CODE": "Active", "FULL_LEAD_TIME": 3,
  "LIST_PRICE": 590.00 } }'
post_erp "$PRODUCT_PAYLOAD" > /dev/null
wait_for_ingest product 10001 applied "I1 product ingest row applied"
CATALOG_1=$(req "$API/v1/storefront/catalog/products?search=FISH-SALMON-1KG")
assert "I1 product visible in storefront catalog" "$(echo "$CATALOG_1" | jq -r '.items[0].sku')" "FISH-SALMON-1KG"
assert "I1 product price 590.00" "$(echo "$CATALOG_1" | jq -r '.items[0].price')" "590.00"

echo "== I2: stock.changed =="
STOCK_PAYLOAD='{ "event_type": "stock.changed", "onhand": {
  "INVENTORY_ITEM_ID": 10001, "SEGMENT1": "FISH-SALMON-1KG",
  "SUBINVENTORY_CODE": "BKK-MAIN", "ON_HAND_QTY": 42 } }'
post_erp "$STOCK_PAYLOAD" > /dev/null
wait_for_ingest stock 10001 applied "I2 stock ingest row applied"
CATALOG_2=$(req "$API/v1/storefront/catalog/products?search=FISH-SALMON-1KG")
assert "I2 catalog stock 42" "$(echo "$CATALOG_2" | jq -r '.items[0].stock')" "42"

echo "== I3: customer.changed =="
CUSTOMER_PAYLOAD='{ "event_type": "customer.changed", "account": {
  "CUST_ACCOUNT_ID": 5001, "ACCOUNT_NUMBER": "JGT-00871",
  "PARTY_NAME": "Somchai Restaurant Co., Ltd.",
  "EMAIL_ADDRESS": "ap@somchai.co.th", "PHONE_NUMBER": "02-123-4567",
  "TAX_REFERENCE": "0105561234567" } }'
post_erp "$CUSTOMER_PAYLOAD" > /dev/null
wait_for_ingest customer 5001 applied "I3 customer ingest row applied"
UPSERT=$(req -X POST "$API/v1/storefront/customers" \
  -d '{"name":"Somchai Restaurant","email":"ap@somchai.co.th","phone":"02-123-4567"}')
assert "I3 storefront upsert returns existing customerId" "$([ -n "$(echo "$UPSERT" | jq -r .customerId)" ] && [ "$(echo "$UPSERT" | jq -r .customerId)" != "null" ] && echo yes || echo no)" "yes"
assert "I3 customerCode JGT-00871 (ERP code wins)" "$(echo "$UPSERT" | jq -r .customerCode)" "JGT-00871"

echo "== I4: sale_order.created (store-only, never becomes a platform order) =="
SALE_ORDER_PAYLOAD='{ "event_type": "sale_order.created", "order": {
  "HEADER_ID": 7001, "ORDER_NUMBER": "SO-2026-045121",
  "ORDERED_DATE": "2026-07-18T09:30:00Z", "SOLD_TO_ACCOUNT": "JGT-00871",
  "LINES": [ { "LINE_NUMBER": 1, "SEGMENT1": "FISH-SALMON-1KG",
    "ORDERED_QUANTITY": 10, "UNIT_SELLING_PRICE": 550.00 } ] } }'
post_erp "$SALE_ORDER_PAYLOAD" > /dev/null
wait_for_ingest sale_order "SO-2026-045121" skipped "I4 sale_order ingest row status skipped"

##############################################################################
# O: ERP order push (order.confirmed -> ERP ref recorded in order_mappings)
##############################################################################
echo "== O: storefront checkout + pay -> order push =="
CUST_O=$(req -X POST "$API/v1/storefront/customers" \
  -d "{\"name\":\"E2E OrderPush\",\"email\":\"e2e-orderpush-$RANDOM@example.com\",\"phone\":\"0899999999\"}")
CUSTOMER_ID=$(echo "$CUST_O" | jq -r .customerId)
SKU_O="OP-$RANDOM"
PRODUCT_O=$(req -X POST "$API/products" -d "{\"sku\":\"$SKU_O\",\"name\":\"OP $SKU_O\",\"fulfillmentMode\":\"on_hand\"}" | jq -r .id)
req -X PUT "$API/erp-stub/stock" -d "{\"sku\":\"$SKU_O\",\"qty\":5}" > /dev/null

CHK_O=$(req -X POST "$API/v1/storefront/checkout" -H "Idempotency-Key: $(idem_key)" \
  -d "{\"customerId\":\"$CUSTOMER_ID\",\"lines\":[{\"productId\":\"$PRODUCT_O\",\"qty\":1,\"unitPrice\":100}]}")
ORDER_ID=$(echo "$CHK_O" | jq -r .orderId)
assert "O checkout pending_payment" "$(echo "$CHK_O" | jq -r .status)" "pending_payment"

req -X POST "$API/v1/storefront/checkout/$ORDER_ID/payment-result" -d '{"result":"paid"}' > /dev/null

ERP_REF=""
for _ in $(seq 1 15); do
  ERP_REF=$(psqlc "select external_id from order_mappings where platform_id = '$ORDER_ID'")
  [ -n "$ERP_REF" ] && break
  sleep 1
done
assert "O order pushed to ERP (order_mappings)" "$ERP_REF" "MOCK-ORD-$ORDER_ID"

echo "ALL PORTAL/INGEST SCENARIOS PASS"
