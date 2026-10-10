/** Owned synthetic fixture DDL; never imported by application readers. */
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { fields } from "./financial-analysis";
import { refundId } from "./finance-fixtures";
export async function financialFixture(db: DataSource, schema: string) {
  if (!/^financial_analysis_fixture_[a-f0-9]+$/.test(schema))
    throw Error("Synthetic namespace only");
  await db.query(`CREATE SCHEMA "${schema}"`);
  // Minimal fixture DDL mirrors native SELECT contracts; no migration or synchronisation execution.
  for (const table of ["orders", "josh_orders"])
    await db.query(
      `CREATE TABLE ${table}(orders_id uuid PRIMARY KEY,order_number text,status text,create_date timestamptz,${fields.map((f) => f + " numeric(14,2)").join(",")},paid boolean,source_version bigint,copied_at timestamptz)`,
    );
  await db.query(
    "CREATE TABLE payment_transactions(id uuid PRIMARY KEY,order_id uuid,status text,is_test boolean)",
  );
  await db.query(
    "CREATE TABLE payment_transaction_orders(transaction_id uuid,order_id uuid)",
  );
  await db.query(
    "CREATE TABLE order_refunds(id uuid PRIMARY KEY,order_id uuid,amount numeric(14,2),status text,created_at timestamptz,processed_at timestamptz)",
  );
  await db.query(
    "CREATE TABLE josh_order_refunds(id uuid,orders_id uuid,amount numeric(14,2),status text,created_at timestamptz,processed_at timestamptz,PRIMARY KEY(orders_id,id))",
  );
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  for (let n = 1; n <= 7; n++)
    for (const table of ["orders", "josh_orders"])
      await db.query(
        `INSERT INTO ${table} VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id(n),
          "SYNTHETIC-" + n,
          n === 7 ? "refunded" : n === 3 ? "delivered" : "paid",
          n === 5
            ? "2026-08-31T17:00:00Z"
            : n === 6
              ? "2026-10-01T00:00:00Z"
              : "2026-09-15T00:00:00Z",
          n === 2 ? null : n === 4 ? "-3.50" : n === 1 ? "107.00" : "0.00",
          n === 2 ? null : "100.00",
          n === 2 ? null : "7.00",
          "10.00",
          "0.00",
          n !== 3,
          n === 1 ? 0 : 1,
          "2026-10-09T00:00:00Z",
        ],
      );
  for (const n of [1, 4, 5, 6, 7])
    await db.query("INSERT INTO payment_transactions VALUES($1,$2,$3,false)", [
      randomUUID(),
      id(n),
      "success",
    ]);
  const batch = randomUUID();
  await db.query("INSERT INTO payment_transactions VALUES($1,NULL,$2,false)", [
    batch,
    "success",
  ]);
  await db.query("INSERT INTO payment_transaction_orders VALUES($1,$2)", [
    batch,
    id(2),
  ]);
  await db.query("INSERT INTO payment_transactions VALUES($1,$2,$3,true)", [
    randomUUID(),
    id(3),
    "success",
  ]);
  await db.query("INSERT INTO payment_transactions VALUES($1,$2,$3,false)", [
    randomUUID(),
    id(3),
    "cancelled",
  ]);
  for (const table of ["order_refunds", "josh_order_refunds"])
    await db.query(
      `INSERT INTO ${table} VALUES($1,$2,'7.00','refunded','2026-09-16T00:00:00Z','2026-10-02T00:00:00Z'),($3,$4,NULL,'refunded','2026-09-17T00:00:00Z',NULL),($5,$6,'-2.00','refunded','2026-09-18T00:00:00Z',NULL),($7,$2,'999.00','pending','2026-09-19T00:00:00Z',NULL)`,
      [refundId, id(5), id(98), id(999), id(97), id(1), id(96)],
    );
}
