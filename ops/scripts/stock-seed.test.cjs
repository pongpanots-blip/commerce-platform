// node --test ops/scripts/stock-seed.test.cjs
process.env.STOCK_SEED_TEST = "1";
const test = require("node:test");
const assert = require("node:assert");
const { plan, SEED_AT } = require("./stock-seed.cjs");

test("seeds every valid SKU once, clamps negatives, creates missing products", () => {
  const p = plan([{ sku: "A", qty: 5 }, { sku: "B", qty: -3 }, { sku: "A", qty: 9 }, { sku: "", qty: 1 }, { sku: "C", qty: "x" }, { sku: " D ", qty: "2.7" }], new Set(["B"]), new Set());
  assert.deepStrictEqual(p.seed, [{ sku: "A", qty: 5 }, { sku: "B", qty: 0 }, { sku: "D", qty: 2 }]);
  assert.deepStrictEqual(p.createProducts, ["A", "D"]);
  assert.strictEqual(p.duplicates, 1);
  assert.strictEqual(p.invalid, 2);
});

test("never touches a SKU that already has an applied movement (ERP / replay / earlier seed wins; re-run is a no-op)", () => {
  const p = plan([{ sku: "A", qty: 5 }, { sku: "B", qty: 7 }], new Set(["A", "B"]), new Set(["A", "B"]));
  assert.strictEqual(p.seed.length, 0);
  assert.strictEqual(p.skipHasMovement, 2);
});

test("seed date is before every stored ERP fallback call (first 2026-10-07)", () => {
  assert.ok(SEED_AT < new Date("2026-10-07T00:00:00Z"));
});
