#!/usr/bin/env bash
# Storefront gateway e2e (scenario S): auth → customer upsert (ERP mock code)
# → catalog → checkout → payment-result → stitched order view.
#
# Prereqs (see apps/commerce-platform/README.md):
#   - platform running on :3100; jq and curl installed
#   - STOREFRONT_API_KEYS must include the KEY this script uses (default
#     "e2e-key") — S0's "no key rejected" assertion only means anything when
#     the guard is actually enforcing keys.
#   - an active 'erp-stub' integration row (shared with checkout-scenarios.sh)
#     is NOT required here; this script creates the 'erp' integration row
#     itself if missing (idempotent — reuses an existing one).
set -euo pipefail
API=${API:-http://localhost:3100/api}
source "$(dirname "$0")/_staff-token.sh"
KEY=${KEY:-e2e-key}

req()   { curl -sf -H 'Content-Type: application/json' -H "X-Api-Key: $KEY" -H "Authorization: Bearer $STAFF_TOKEN" "$@"; }
nokey() { curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' "$@"; }
assert(){ if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (got '$2', want '$3')"; exit 1; fi }

echo "== S0: auth =="
assert "S0 no key rejected" "$(nokey "$API/v1/storefront/catalog/products")" "401"

echo "== S1: customer upsert (mock ERP code) =="
# ensure an active 'erp' integration exists (idempotent) — required for the code round-trip
ERP_ID=$(req "$API/integrations?page=1&pageSize=100" | jq -r '(.items? // .)[] | select(.type=="erp") | .id' | head -1)
if [ -z "$ERP_ID" ]; then
  req -X POST "$API/integrations" -d '{"name":"ERP (Oracle)","type":"erp"}' > /dev/null
fi
CUST=$(req -X POST "$API/v1/storefront/customers" \
  -d '{"name":"E2E Somchai","email":"e2e-somchai@example.com","phone":"0812345678"}')
CUSTOMER_ID=$(echo "$CUST" | jq -r .customerId)
assert "S1 got mock customer code" "$(echo "$CUST" | jq -r .customerCode | cut -c1-10)" "MOCK-CUST-"

echo "== S2: catalog =="
SKU="SF-$RANDOM"
PRODUCT=$(req -X POST "$API/products" -d "{\"sku\":\"$SKU\",\"name\":\"SF $SKU\",\"fulfillmentMode\":\"on_hand\"}" | jq -r .id)
req -X PUT "$API/erp-stub/stock" -d "{\"sku\":\"$SKU\",\"qty\":3}" > /dev/null
FOUND=$(req "$API/v1/storefront/catalog/products?search=$SKU" | jq -r '.items[0].sku')
assert "S2 product visible in catalog" "$FOUND" "$SKU"

echo "== S3: checkout =="
idem_key() {
  if command -v uuidgen > /dev/null 2>&1; then uuidgen; else echo "$(date +%s%N)-$RANDOM"; fi
}
CHK=$(req -X POST "$API/v1/storefront/checkout" -H "Idempotency-Key: $(idem_key)" \
  -d "{\"customerId\":\"$CUSTOMER_ID\",\"lines\":[{\"productId\":\"$PRODUCT\",\"qty\":1,\"unitPrice\":150}]}")
ORDER_ID=$(echo "$CHK" | jq -r .orderId)
assert "S3 pending_payment" "$(echo "$CHK" | jq -r .status)" "pending_payment"

echo "== S4: payment result → confirmed =="
req -X POST "$API/v1/storefront/checkout/$ORDER_ID/payment-result" -d '{"result":"paid"}' > /dev/null
VIEW=$(req "$API/v1/storefront/orders/$ORDER_ID")
assert "S4 order confirmed" "$(echo "$VIEW" | jq -r .status)" "confirmed"
assert "S4 line fulfillment confirmed" "$(echo "$VIEW" | jq -r '.lines[0].fulfillment.status')" "confirmed"
assert "S4 payment paid" "$(echo "$VIEW" | jq -r .payment.status)" "paid"

echo "ALL STOREFRONT SCENARIOS PASS"
