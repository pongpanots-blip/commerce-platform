#!/usr/bin/env bash
# End-to-end proof of the reservation + checkout saga against a running
# platform (:3100). Scenarios:
#   A happy path: reserve -> pay -> confirmed (stub hold confirmed)
#   B race: stock=1, two concurrent checkouts -> exactly one held
#   C payment failure: release -> stock restored
#   D TTL expiry: unpaid order expires, stock restored (needs TTL=0, sweep=2s)
#
# Prereqs (see apps/commerce-platform/README.md):
#   - platform running on :3100; jq installed
#   - an active integration row of type 'erp-stub' (POST /integrations once;
#     idempotent - the script does not create it)
#
# TTL note: scenario D needs RESERVATION_TTL_MINUTES=0 + RESERVATION_SWEEP_MS=2000
# to expire fast. Running A-D in one go against a TTL=0 platform is flaky: scenario
# B deliberately leaves its WINNING order in pending_payment (never paid/failed, by
# design, so we can assert "exactly one winner") — under TTL=0 that leftover held
# reservation is itself immediately expiry-eligible, and the background sweep can
# reap it later and credit stock back while a *later* scenario is mid-flight,
# double-crediting the shared SKU. Fix: run A-C against a platform with the
# default TTL (30 min - nothing expires during a short test run), and D alone
# against a separate platform launch with TTL=0. Select which scenarios run via
# SCENARIOS=ABCD (default all four); e.g.:
#   SCENARIOS=ABC bash checkout-scenarios.sh   # against default-TTL platform
#   SCENARIOS=D   bash checkout-scenarios.sh   # against TTL=0 platform
set -euo pipefail
API=${API:-http://localhost:3100/api}
source "$(dirname "$0")/_staff-token.sh"
SCENARIOS=${SCENARIOS:-ABCD}
has_scenario() { case "$SCENARIOS" in *"$1"*) return 0 ;; *) return 1 ;; esac; }

req() { curl -sf -H 'Content-Type: application/json' -H "Authorization: Bearer $STAFF_TOKEN" "$@"; }
new_order() { # $1 = productId
  req -X POST "$API/orders" -d "{\"customerId\":\"$CUSTOMER\",\"lines\":[{\"productId\":\"$1\",\"qty\":1,\"unitPrice\":100}]}" | jq -r .id
}
checkout() { # $1 = orderId -> prints order status
  req -X POST "$API/orders/$1/checkout" -H "Idempotency-Key: $(idem_key)" | jq -r .status
}
idem_key() {
  if command -v uuidgen > /dev/null 2>&1; then uuidgen; else echo "$(date +%s%N)-$RANDOM"; fi
}
payment_id() { req "$API/payments?orderId=$1" | jq -r '.items[0].id'; }
stock_of()  { req "$API/erp-stub/stock" | jq -r ".items[] | select(.sku==\"$1\") | .qty"; }
set_stock() { req -X PUT "$API/erp-stub/stock" -d "{\"sku\":\"$1\",\"qty\":$2}" > /dev/null; }
assert() { # $1 label, $2 actual, $3 expected
  if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (got '$2', want '$3')"; exit 1; fi
}

echo "== setup =="
CUSTOMER=$(req -X POST "$API/customers" -d '{"name":"E2E Customer"}' | jq -r .id)
SKU="E2E-$RANDOM"
PRODUCT=$(req -X POST "$API/products" -d "{\"sku\":\"$SKU\",\"name\":\"E2E $SKU\",\"fulfillmentMode\":\"on_hand\"}" | jq -r .id)

if has_scenario A; then
echo "== A: happy path =="
set_stock "$SKU" 5
O=$(new_order "$PRODUCT")
assert "A checkout" "$(checkout "$O")" "pending_payment"
req -X POST "$API/payments/$(payment_id "$O")/pay" > /dev/null
assert "A confirmed" "$(req "$API/orders/$O/full" | jq -r .order.status)" "confirmed"
assert "A stock decremented" "$(stock_of "$SKU")" "4"
fi

if has_scenario B; then
echo "== B: last-piece race =="
# NOTE: we do NOT rely on capturing checkout()'s stdout from a backgrounded
# subshell command substitution ($(...) & does not reliably propagate output
# back to the parent shell across bash versions/platforms). Instead each
# checkout runs in the background writing its own temp file, and R1/R2 (read
# straight from the DB-backed /full endpoint afterwards) are the sole source
# of truth for the assertions, per the T11 brief warnbox.
set_stock "$SKU" 1
O1=$(new_order "$PRODUCT"); O2=$(new_order "$PRODUCT")
TMP1=$(mktemp); TMP2=$(mktemp)
trap 'rm -f "$TMP1" "$TMP2"' EXIT
( checkout "$O1" > "$TMP1" 2>&1 || true ) &
P1=$!
( checkout "$O2" > "$TMP2" 2>&1 || true ) &
P2=$!
wait "$P1" "$P2" || true
R1=$(req "$API/orders/$O1/full" | jq -r .order.status)
R2=$(req "$API/orders/$O2/full" | jq -r .order.status)
WINNERS=$(printf "%s\n%s\n" "$R1" "$R2" | grep -c pending_payment || true)
assert "B exactly one winner" "$WINNERS" "1"
assert "B stock exhausted" "$(stock_of "$SKU")" "0"
fi

if has_scenario C; then
echo "== C: payment failure releases =="
set_stock "$SKU" 1
O=$(new_order "$PRODUCT")
checkout "$O" > /dev/null
req -X POST "$API/payments/$(payment_id "$O")/fail" > /dev/null
assert "C order failed" "$(req "$API/orders/$O/full" | jq -r .order.status)" "failed"
assert "C stock restored" "$(stock_of "$SKU")" "1"
fi

if has_scenario D; then
echo "== D: TTL expiry (requires RESERVATION_TTL_MINUTES=0, RESERVATION_SWEEP_MS=2000) =="
set_stock "$SKU" 1
O=$(new_order "$PRODUCT")
checkout "$O" > /dev/null
sleep 5
assert "D order expired" "$(req "$API/orders/$O/full" | jq -r .order.status)" "expired"
assert "D stock restored" "$(stock_of "$SKU")" "1"
fi

echo "ALL SCENARIOS PASS"
