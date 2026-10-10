import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import {
  FinancialReaderService,
  financialSql,
} from "./financial-reader.service";
import { fields, recordedVariance } from "./financial-analysis";
import { orderId, refundId } from "./finance-fixtures";
import { financialFixture } from "./financial-sql-fixtures";
const url = process.env.FINANCE_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "native financial SELECTs on isolated owned PostgreSQL fixture",
  () => {
    let db: DataSource,
      reader: FinancialReaderService,
      old: string | undefined,
      schema: string;
    beforeAll(async () => {
      const u = new URL(url!);
      if (
        u.hostname !== "127.0.0.1" ||
        u.pathname !== "/commerce_preview_test" ||
        u.port !== process.env.FINANCE_FIXTURE_PORT ||
        process.env.FINANCE_FIXTURE_OWNED !== "commerce-pack-price-20261009"
      )
        throw Error("Owned localhost fixture only");
      schema = "financial_analysis_fixture_" + randomUUID().replace(/-/g, "");
      db = await new DataSource({
        type: "postgres",
        url,
        synchronize: false,
        extra: { max: 3, options: `-c search_path=${schema}` },
      }).initialize();
      await financialFixture(db, schema);
      reader = new FinancialReaderService(
        {
          configured: true,
          query: (sql: string, args: unknown[]) => db.query(sql, args),
        } as never,
        db,
      );
      old = process.env.SALES_SOURCE;
    });
    afterAll(async () => {
      if (old === undefined) delete process.env.SALES_SOURCE;
      else process.env.SALES_SOURCE = old;
      if (db?.isInitialized) await db.destroy();
    });
    it.each(["copies", "replica"])(
      "%s retains original non-test direct/batch payment and settled-status eligibility",
      async (source) => {
        process.env.SALES_SOURCE = source;
        const p = await reader.period("2026-09", "UTC");
        expect(p.orders).toMatchObject({
          paidOrders: 3,
          excludedWithoutPayment: 1,
        });
        expect(p.orders!.values.total_price).toEqual({
          knownSum: "103.50",
          value: null,
          knownRows: 2,
          negativeRows: 1,
          missingRows: 1,
        });
        expect(p.orders!.items.map((x) => x.number)).toEqual([
          "SYNTHETIC-1",
          "SYNTHETIC-2",
          "SYNTHETIC-4",
        ]);
        expect(p.coverage).toBe("partial");
        expect(p.orders!.legacyCopyOrders).toBe(source === "copies" ? 1 : null);
      },
    );
    it("uses Bangkok calendar boundaries independently from UTC", async () => {
      process.env.SALES_SOURCE = "copies";
      const p = await reader.period("2026-09", "Asia/Bangkok");
      expect(p.orders!.paidOrders).toBe(4);
      expect(p.orders!.items.some((x) => x.number === "SYNTHETIC-5")).toBe(
        true,
      );
      expect(p.orders!.items.some((x) => x.number === "SYNTHETIC-6")).toBe(
        false,
      );
    });
    it("retains missing, negative, unlinked and cross-order-period refunds without subtraction", async () => {
      process.env.SALES_SOURCE = "replica";
      const p = await reader.period("2026-09", "UTC");
      expect(p.refunds).toMatchObject({
        records: 3,
        knownAmount: "5.00",
        knownRows: 2,
        missingRows: 1,
        negativeRows: 1,
        unlinkedOrders: 1,
        outsideOrderPeriod: 1,
      });
      const v = recordedVariance(p, await reader.period("2026-08", "UTC"));
      expect(v.refundsSubtracted).toBe(false);
      expect(v.fields[0].delta).toBeNull();
      expect(v.actualNetSalesExVat).toBeNull();
    });
    it("keeps composite refund identity for copied records and period-scoped GET detail", async () => {
      process.env.SALES_SOURCE = "copies";
      await db.query(
        "INSERT INTO josh_order_refunds VALUES($1,$2,0,'refunded','2026-09-19T00:00:00Z',NULL)",
        [refundId, orderId],
      );
      const p = await reader.period("2026-09", "UTC");
      expect(p.refunds!.items.filter((x) => x.id === refundId)).toHaveLength(2);
      const a = await reader.detail(
        "refunds",
        "2026-09",
        "UTC",
        refundId,
        orderId,
      );
      expect(a.record).toMatchObject({ orderId, amount: "0.00" });
      await expect(
        reader.detail("refunds", "2026-08", "UTC", refundId, orderId),
      ).rejects.toThrow("absent");
      const o = await reader.detail("orders", "2026-09", "UTC", orderId);
      expect(o.record).toMatchObject({
        status: "paid",
        values: { total_price: "107.00" },
      });
      await expect(
        reader.detail("orders", "2026-08", "UTC", orderId),
      ).rejects.toThrow("absent");
      await expect(
        reader.detail(
          "orders",
          "2026-09",
          "UTC",
          "00000000-0000-4000-8000-000000000003",
        ),
      ).rejects.toThrow("absent");
    });
    it("samples 20 records while authoritative counts cover every eligible row", async () => {
      process.env.SALES_SOURCE = "copies";
      for (let n = 100; n < 122; n++)
        await db.query(
          "INSERT INTO josh_orders SELECT $1,'SYNTHETIC-MORE',status,create_date,total_price,subtotal_ex_vat,vat_amount,discount_inc_vat,delivery_fee,paid,source_version,copied_at FROM josh_orders WHERE orders_id=$2",
          [`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, orderId],
        );
      const p = await reader.period("2026-09", "UTC");
      expect(p.orders!.paidOrders).toBe(25);
      expect(p.orders!.items).toHaveLength(20);
      expect(p.orders!.hasMore).toBe(true);
    });
    it("empty successful local reads differ from absence of upstream history", async () => {
      process.env.SALES_SOURCE = "copies";
      const p = await reader.period("2026-07", "UTC");
      expect(p.orders!.values.total_price).toMatchObject({
        value: "0.00",
        knownSum: null,
      });
      expect(p.refunds!.knownAmount).toBeNull();
      expect(p).toMatchObject({
        coverage: "partial",
        upstreamCompleteness: "unverified",
        upstreamFreshness: "unverified",
      });
    });
    it("a refund source outage leaves valid orders visible and no fake zero", async () => {
      process.env.SALES_SOURCE = "copies";
      await db.query(
        "ALTER TABLE josh_order_refunds RENAME TO financial_fixture_unavailable_refunds",
      );
      try {
        const p = await reader.period("2026-09", "UTC");
        expect(p.orders!.paidOrders).toBe(25);
        expect(p.refunds).toBeNull();
        expect(p.issues).toEqual(["refunds_unavailable"]);
        await expect(
          reader.detail("refunds", "2026-09", "UTC", refundId, orderId),
        ).rejects.toThrow("unavailable");
      } finally {
        await db.query(
          "ALTER TABLE financial_fixture_unavailable_refunds RENAME TO josh_order_refunds",
        );
      }
    });
    it("an unconfigured replica does not query or synthesize known totals", async () => {
      process.env.SALES_SOURCE = "replica";
      const query = jest.fn();
      const p = await new FinancialReaderService(
        { configured: false, query } as never,
        db,
      ).period("2026-09", "UTC");
      expect(query).not.toHaveBeenCalled();
      expect(p).toMatchObject({
        coverage: "unavailable",
        orders: null,
        refunds: null,
        issues: ["orders_unavailable", "refunds_unavailable"],
      });
    });
    it("all projection statements are SELECT-only and bind windows, IDs and statuses", () => {
      for (const s of ["replica", "copies"] as const)
        for (const k of ["orders", "refunds"] as const)
          for (const detail of [true, false])
            expect(financialSql(s, k, detail)).not.toMatch(
              /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/,
            );
    });
  },
);
