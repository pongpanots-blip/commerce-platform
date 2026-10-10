import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { OutboxMessage } from "../../../shared-kernel/infrastructure/outbox.entity";
import { priceApprovalFixture } from "./price-approval-fixtures";
import { PromotionDraftsService } from "../../integration/promotion-planning/promotion-drafts.service";
import { PackDraftsService } from "../../integration/pack-price-planning/pack-drafts.service";
const url = process.env.PRICE_APPROVAL_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "reviewed price decisions in owned native SQL",
  () => {
    let db: DataSource,
      f: Awaited<ReturnType<typeof priceApprovalFixture>>,
      before: string;
    const publicState = async () =>
      JSON.stringify({
        drafts: await db.query(
          "SELECT * FROM public.commerce_promotion_drafts ORDER BY id",
        ),
        requests: await db.query(
          "SELECT * FROM public.commerce_promotion_draft_requests ORDER BY actor_id,request_id",
        ),
        catalog: await db.query(
          "SELECT * FROM public.josh_catalog_products ORDER BY id",
        ),
        rules: await db.query(
          "SELECT * FROM public.product_promotion_rules ORDER BY sku",
        ),
      });
    const state = async () =>
      JSON.stringify({
        prices: await db.query(
          "SELECT * FROM product_prices ORDER BY product_inventory_sku",
        ),
        pending: await db.query(
          "SELECT * FROM product_price_pending ORDER BY product_inventory_sku",
        ),
        events: await db.query("SELECT * FROM outbox_messages ORDER BY id"),
        requests: await db.query(
          "SELECT * FROM commerce_promotion_draft_requests ORDER BY request_id",
        ),
      });
    const packet = async (
      decision: "approve" | "reject" = "approve",
      skus = ["SYNTHETIC-PRICE-1"],
    ) => ({
      requestId: randomUUID(),
      decision,
      changes: await Promise.all(
        skus.map(async (sku) => {
          const r = await f.approval.itemFor(sku);
          return { sku, version: r.items[0].version };
        }),
      ),
    });
    beforeAll(async () => {
      const u = new URL(url!);
      if (
        u.hostname !== "127.0.0.1" ||
        u.port !== process.env.PRICE_APPROVAL_FIXTURE_PORT ||
        u.pathname !== "/commerce_preview_test" ||
        process.env.PRICE_APPROVAL_FIXTURE_OWNED !==
          "commerce-pack-price-20261009"
      )
        throw Error("Explicit owned local fixture required");
      const schema = "price_approval_fixture_" + randomUUID().replace(/-/g, "");
      db = await new DataSource({
        type: "postgres",
        url,
        schema,
        entities: [OutboxMessage],
        uuidExtension: "pgcrypto",
        installExtensions: false,
        synchronize: false,
        extra: { max: 6, options: `-c search_path=${schema}` },
      }).initialize();
      before = await publicState();
      f = await priceApprovalFixture(db, schema);
    });
    beforeEach(async () => {
      process.env.COMMERCE_OWNS_PRICES = "true";
      await db.query("DELETE FROM product_price_pending");
      await db.query("DELETE FROM product_prices");
      await f.seed();
    });
    afterAll(async () => {
      expect(await publicState()).toBe(before);
      await db.destroy();
      delete process.env.COMMERCE_OWNS_PRICES;
    });
    it("reviews raw native decimals, timestamps and null-as-unchanged fields; pending totals come from SQL", async () => {
      const r = await f.approval.pending("SYNTHETIC", { page: 1, limit: 20 });
      expect(r).toMatchObject({
        total: 1,
        ownership: "commerce",
        items: [
          {
            current: {
              sellingUnitPrice: "10.00",
              orderingPrice: "100.00",
              moq: 1,
            },
            proposed: {
              sellingUnitPrice: "12.50",
              orderingPrice: null,
              moq: null,
            },
          },
        ],
      });
      expect(r.items[0].version).toMatch(/^[a-f0-9]{64}$/);
      expect(
        await f.approval.pending("missing", { page: 1, limit: 20 }),
      ).toMatchObject({ items: [], total: 0 });
    });
    it("approves exact native values, keeps unspecified fields and commits real outbox plus private immutable receipt", async () => {
      const p = await packet(),
        r = await f.approval.save(p, "mer-fixture");
      expect(r).toMatchObject({
        persisted: true,
        appliedCount: 1,
        outboxEnqueued: true,
        downstreamDelivery: "unverified",
      });
      expect(r.items[0].after).toEqual({
        sellingUnitPrice: "12.50",
        orderingPrice: "100.00",
        moq: 1,
      });
      expect(
        (
          await db.query(
            "SELECT payload FROM outbox_messages WHERE aggregate_id=$1 ORDER BY created_at DESC LIMIT 1",
            [
              (await import("./product-price-snapshot.event")).skuAggregateId(
                "SYNTHETIC-PRICE-1",
              ),
            ],
          )
        )[0].payload,
      ).toMatchObject({
        sku: "SYNTHETIC-PRICE-1",
        sellingUnitPrice: 12.5,
        orderingPrice: 100,
        moq: 1,
      });
      expect(
        await f.approval.request(p.requestId, "mer-fixture"),
      ).toMatchObject({ packet: p });
      await expect(f.approval.request(p.requestId, "other")).rejects.toThrow(
        "not found",
      );
    });
    it("rejects proposals without changing current values or enqueuing any price event; stores decision history", async () => {
      const p = await packet("reject"),
        n = (await db.query("SELECT count(*)::int n FROM outbox_messages"))[0]
          .n,
        r = await f.approval.save(p, "reject");
      expect(r).toMatchObject({
        appliedCount: 1,
        outboxEnqueued: false,
        downstreamDelivery: "not_applicable",
      });
      expect(r.items[0].after).toEqual(r.items[0].before.current);
      expect(
        (await db.query("SELECT count(*)::int n FROM outbox_messages"))[0].n,
      ).toBe(n);
      expect(await f.prices.pending()).toEqual([]);
    });
    it("accepts zero ERP values without treating them as absent", async () => {
      await f.prices.stage(
        db.manager,
        "SYNTHETIC-PRICE-1",
        { sellingUnitPrice: 0, orderingPrice: 0, moq: 0 },
        new Date(),
      );
      const r = await f.approval.save(await packet(), "zero");
      expect(r.items[0].after).toEqual({
        sellingUnitPrice: "0.00",
        orderingPrice: "0.00",
        moq: 0,
      });
    });
    it("serializes concurrent duplicate confirmation into one write/event/receipt", async () => {
      const p = await packet(),
        n = (await db.query("SELECT count(*)::int n FROM outbox_messages"))[0]
          .n;
      const [a, b] = await Promise.all([
        f.approval.save(p, "dupe"),
        f.approval.save(p, "dupe"),
      ]);
      expect(a.id).toBe(b.id);
      expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
      expect(
        (await db.query("SELECT count(*)::int n FROM outbox_messages"))[0].n,
      ).toBe(n + 1);
    });
    it.each(["pending", "current", "missing"])(
      "stale %s evidence stops the entire selected batch without false partial completion",
      async (kind) => {
        await f.seed("SYNTHETIC-PRICE-2");
        const p = await packet("approve", [
          "SYNTHETIC-PRICE-1",
          "SYNTHETIC-PRICE-2",
        ]);
        if (kind === "pending")
          await f.prices.stage(
            db.manager,
            "SYNTHETIC-PRICE-2",
            { sellingUnitPrice: 15 },
            new Date(),
          );
        if (kind === "current")
          await f.prices.edit(
            "SYNTHETIC-PRICE-2",
            { orderingPrice: 200 },
            "other",
          );
        if (kind === "missing") await f.prices.reject(["SYNTHETIC-PRICE-2"]);
        const s = await state();
        await expect(f.approval.save(p, "stale")).rejects.toThrow(
          /changed|available/,
        );
        expect(await state()).toBe(s);
      },
    );
    it("detects same-value queue replacement and current-row creation after review", async () => {
      const p = await packet();
      await f.prices.stage(
        db.manager,
        "SYNTHETIC-PRICE-1",
        { sellingUnitPrice: 12.5 },
        new Date("2026-10-10T01:00:00.123Z"),
      );
      await expect(f.approval.save(p, "aba")).rejects.toThrow("changed");
      await db.query("DELETE FROM product_prices");
      const absent = await packet();
      await db.query(
        "INSERT INTO josh_catalog_products VALUES('SYNTHETIC-PRICE-1') ON CONFLICT DO NOTHING",
      );
      await f.prices.edit(
        "SYNTHETIC-PRICE-1",
        { sellingUnitPrice: 10 },
        "creator",
      );
      await expect(f.approval.save(absent, "absent")).rejects.toThrow(
        "changed",
      );
    });
    it("replays the old receipt after a new ERP proposal and ownership change, without approving the new proposal", async () => {
      const p = await packet(),
        r = await f.approval.save(p, "recover");
      await f.prices.stage(
        db.manager,
        "SYNTHETIC-PRICE-1",
        { sellingUnitPrice: 90 },
        new Date(),
      );
      process.env.COMMERCE_OWNS_PRICES = "false";
      const s = await state();
      expect(await f.approval.save(p, "recover")).toMatchObject({
        id: r.id,
        replayed: true,
      });
      expect(await state()).toBe(s);
      await expect(
        f.approval.save({ ...p, requestId: randomUUID() }, "recover"),
      ).rejects.toThrow("owned");
    });
    it("rejects altered request bodies and conflicting stored hashes", async () => {
      const p = await packet();
      await f.approval.save(p, "collision");
      await expect(
        f.approval.save({ ...p, decision: "reject" }, "collision"),
      ).rejects.toThrow("different decision");
      await db.query(
        "UPDATE commerce_promotion_draft_requests SET request_hash='other' WHERE actor_id='collision' AND request_id=$1",
        [p.requestId],
      );
      await expect(f.approval.save(p, "collision")).rejects.toThrow(
        "different decision",
      );
    });
    it("rolls back all native changes and outbox when a selected native patch is invalid", async () => {
      await f.seed("SYNTHETIC-PRICE-2");
      await db.query(
        "UPDATE product_price_pending SET selling_unit_price=NULL,ordering_price=NULL,moq=NULL WHERE product_inventory_sku='SYNTHETIC-PRICE-2'",
      );
      const p = await packet("approve", [
          "SYNTHETIC-PRICE-1",
          "SYNTHETIC-PRICE-2",
        ]),
        s = await state();
      await expect(f.approval.save(p, "invalid")).rejects.toThrow();
      expect(await state()).toBe(s);
    });
    it("rolls back approval and real outbox if receipt persistence fails", async () => {
      const p = await packet(),
        s = await state();
      await db.query(
        "ALTER TABLE commerce_promotion_draft_requests ADD CONSTRAINT price_receipt_failure CHECK(actor_id<>'fail-receipt')",
      );
      try {
        await expect(f.approval.save(p, "fail-receipt")).rejects.toThrow(
          "storage unavailable",
        );
        expect(await state()).toBe(s);
      } finally {
        await db.query(
          "ALTER TABLE commerce_promotion_draft_requests DROP CONSTRAINT price_receipt_failure",
        );
      }
    });
    it("mixed legacy/reviewed overlapping batches resolve atomically without lock-order deadlock", async () => {
      await f.seed("SYNTHETIC-PRICE-2");
      const p = await packet("approve", [
        "SYNTHETIC-PRICE-1",
        "SYNTHETIC-PRICE-2",
      ]);
      const n = (
        await db.query("SELECT count(*)::int n FROM outbox_messages")
      )[0].n;
      const results = await Promise.allSettled([
        f.approval.save(p, "mixed"),
        f.prices.approve(
          ["SYNTHETIC-PRICE-2", "SYNTHETIC-PRICE-1"],
          "legacy-mixed",
        ),
      ]);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
      for (const r of results)
        if (r.status === "rejected")
          expect(r.reason.message).toMatch(/changed|available/);
      expect(await f.prices.pending()).toEqual([]);
      expect((await f.prices.list()).map((i) => i.selling_unit_price)).toEqual([
        "12.50",
        "12.50",
      ]);
      expect(
        (await db.query("SELECT count(*)::int n FROM outbox_messages"))[0].n,
      ).toBe(n + 2);
    });
    it("new price audit records do not enter promotion or pack draft lists", async () => {
      const p = await packet();
      await f.approval.save(p, "partition");
      expect(
        await new PromotionDraftsService(db, {} as never).list("partition"),
      ).toMatchObject({ items: [] });
      expect(
        await new PackDraftsService(db, {} as never).list("partition"),
      ).toMatchObject({ items: [] });
    });
    it("native reserved and 64-character supplementary Unicode SKUs retain exact identity and persistence", async () => {
      for (const sku of ["A/B.ไทย\\1", "🐟".repeat(64)]) {
        await f.seed(sku);
        const p = await packet("approve", [sku]),
          r = await f.approval.save(p, "reserved");
        expect(r.items[0].before.sku).toBe(sku);
        expect(r.items[0].after.sellingUnitPrice).toBe("12.50");
        expect(
          (await f.approval.request(p.requestId, "reserved")).packet.changes[0]
            .sku,
        ).toBe(sku);
        expect(
          (
            await db.query(
              "SELECT selling_unit_price FROM product_prices WHERE product_inventory_sku=$1",
              [sku],
            )
          )[0].selling_unit_price,
        ).toBe("12.50");
      }
      await expect(f.approval.itemFor("🐟".repeat(65))).rejects.toThrow(
        "Invalid SKU",
      );
    });
    it("preserves original API semantics: missing SKUs are skipped, native staff edits publish, rejection changes only pending rows", async () => {
      expect(
        await f.prices.approve(["missing", "SYNTHETIC-PRICE-1"], "legacy"),
      ).toEqual({ approved: 1 });
      await f.prices.edit(
        "SYNTHETIC-PRICE-1",
        { orderingPrice: 250 },
        "legacy",
      );
      await f.prices.stage(
        db.manager,
        "SYNTHETIC-PRICE-1",
        { orderingPrice: 999 },
        new Date(),
      );
      expect(await f.prices.reject(["missing", "SYNTHETIC-PRICE-1"])).toEqual({
        rejected: 1,
      });
      expect((await f.prices.list())[0].ordering_price).toBe("250.00");
    });
  },
);
