import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { OutboxMessage } from "../../../shared-kernel/infrastructure/outbox.entity";
import { priceApprovalFixture } from "./price-approval-fixtures";
import { ManualPriceService } from "./manual-price.service";
import { skuAggregateId } from "./product-price-snapshot.event";
const url = process.env.PRICE_APPROVAL_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "reviewed native manual price edits in owned SQL",
  () => {
    let db: DataSource,
      f: Awaited<ReturnType<typeof priceApprovalFixture>>,
      editor: ManualPriceService,
      before: string,
      schema: string;
    const publicState = async () =>
      JSON.stringify(
        await Promise.all(
          [
            "commerce_promotion_drafts",
            "commerce_promotion_draft_requests",
            "josh_catalog_products",
            "product_promotion_rules",
          ].map((t) =>
            db.query(
              "SELECT * FROM public." +
                t +
                " ORDER BY " +
                (t === "commerce_promotion_draft_requests"
                  ? "actor_id,request_id"
                  : t === "product_promotion_rules"
                    ? "sku"
                    : "id"),
            ),
          ),
        ),
      );
    const state = async () =>
      JSON.stringify(
        await Promise.all(
          [
            "product_prices",
            "product_price_pending",
            "outbox_messages",
            "commerce_promotion_draft_requests",
          ].map((t) =>
            db.query(
              "SELECT * FROM " +
                t +
                " ORDER BY " +
                (t === "commerce_promotion_draft_requests"
                  ? "actor_id,request_id"
                  : t === "outbox_messages"
                    ? "id"
                    : "product_inventory_sku"),
            ),
          ),
        ),
      );
    const packet = async (
      patch: Record<string, number | null> = { sellingUnitPrice: 15 },
      sku = "SYNTHETIC-PRICE-1",
    ) => ({
      requestId: randomUUID(),
      sku,
      version: (await editor.itemFor(sku)).item.version,
      patch,
    });
    const eventCount = async () =>
      Number((await db.query("SELECT count(*) n FROM outbox_messages"))[0].n);
    const pendingState = async () =>
      JSON.stringify(
        await db.query(
          "SELECT * FROM product_price_pending ORDER BY product_inventory_sku",
        ),
      );
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
      schema = "price_approval_fixture_" + randomUUID().replace(/-/g, "");
      db = await new DataSource({
        type: "postgres",
        url,
        schema,
        entities: [OutboxMessage],
        uuidExtension: "pgcrypto",
        installExtensions: false,
        synchronize: false,
        extra: { max: 6, options: "-c search_path=" + schema },
      }).initialize();
      before = await publicState();
      f = await priceApprovalFixture(db, schema);
      editor = new ManualPriceService(db, f.prices);
    });
    beforeEach(async () => {
      process.env.COMMERCE_OWNS_PRICES = "true";
      await db.query("DELETE FROM product_price_pending");
      await db.query("DELETE FROM product_prices");
      await f.seed();
    });
    afterAll(async () => {
      if (!db?.isInitialized) return;
      try {
        expect(await publicState()).toBe(before);
      } finally {
        try {
          await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await db.destroy();
          delete process.env.COMMERCE_OWNS_PRICES;
        }
      }
    });
    it("keeps omitted fields, clears null and applies zero; actual source/actor/event/receipt commit while ERP stays untouched", async () => {
      const p = await packet({ sellingUnitPrice: 0, moq: null }),
        pending = await pendingState(),
        n = await eventCount(),
        r = await editor.save(p, "manual-actor");
      expect(r.after).toEqual({
        sellingUnitPrice: "0.00",
        orderingPrice: "100.00",
        moq: null,
      });
      expect(r).toMatchObject({
        persisted: true,
        source: "staff",
        updatedBy: "manual-actor",
        outboxEnqueued: true,
        downstreamDelivery: "unverified",
      });
      expect(await pendingState()).toBe(pending);
      // The queue's proposal is unchanged; its joined live-price context follows
      // the committed edit and must not keep reporting the old current values.
      expect(await f.prices.pending()).toEqual([
        expect.objectContaining({
          sku: p.sku,
          selling_unit_price: "12.50",
          current_selling_unit_price: "0.00",
          current_ordering_price: "100.00",
          current_moq: null,
        }),
      ]);
      expect(await eventCount()).toBe(n + 1);
      const [event] = await db.query(
        "SELECT payload,status FROM outbox_messages WHERE type='product.price.snapshot' AND aggregate_id=$1 ORDER BY created_at DESC LIMIT 1",
        [skuAggregateId(p.sku)],
      );
      expect(event).toMatchObject({
        status: "pending",
        payload: {
          sku: p.sku,
          sellingUnitPrice: 0,
          orderingPrice: 100,
          moq: null,
        },
      });
      expect(Number.isNaN(Date.parse(event.payload.version))).toBe(false);
      expect(await editor.request(p.requestId, "manual-actor")).toMatchObject({
        packet: p,
      });
      await expect(editor.request(p.requestId, "other")).rejects.toThrow(
        "not found",
      );
    });
    it("review, empty lookup and ownership-disabled confirmation leave all prices, events and receipts unchanged", async () => {
      const p = await packet(),
        s = await state();
      process.env.COMMERCE_OWNS_PRICES = "false";
      expect((await editor.itemFor(p.sku)).ownership).toBe("josh");
      expect(
        (
          await editor.review({
            sku: p.sku,
            version: p.version,
            patch: p.patch,
          })
        ).ownership,
      ).toBe("josh");
      await expect(editor.itemFor("UNKNOWN")).rejects.toThrow("not found");
      await expect(editor.save(p, "not-owned")).rejects.toThrow("owns");
      await expect(editor.request(p.requestId, "not-owned")).rejects.toThrow(
        "not found",
      );
      expect(await state()).toBe(s);
    });
    it("same-value explicit writes still publish with staff provenance", async () => {
      const n = await eventCount(),
        r = await editor.save(
          await packet({ orderingPrice: 100 }),
          "same-value",
        );
      expect(r.after).toEqual(r.before.current);
      expect(await eventCount()).toBe(n + 1);
      expect((await editor.itemFor(r.packet.sku)).item.currentUpdatedBy).toBe(
        "same-value",
      );
    });
    it("accepts exact native SQL maxima and rejects one beyond before confirmation", async () => {
      const p = await packet({
        sellingUnitPrice: 9999999999.99,
        moq: 2147483647,
      });
      expect(
        (
          await editor.review({
            sku: p.sku,
            version: p.version,
            patch: p.patch,
          })
        ).after,
      ).toMatchObject({ sellingUnitPrice: "9999999999.99", moq: 2147483647 });
      expect((await editor.save(p, "boundary")).after.sellingUnitPrice).toBe(
        "9999999999.99",
      );
      for (const patch of [
        { sellingUnitPrice: 10000000000 },
        { moq: 2147483648 },
        { moq: 0.1 },
        { sellingUnitPrice: 1.001 },
        {},
      ])
        await expect(
          editor.review({ sku: p.sku, version: p.version, patch }),
        ).rejects.toThrow("Invalid");
    });
    it("creates first price only for catalog-known SKU and respects null, keep and zero", async () => {
      await db.query("INSERT INTO josh_catalog_products VALUES($1)", [
        "CATALOG-ONLY",
      ]);
      const p = await packet({ orderingPrice: 0, moq: null }, "CATALOG-ONLY");
      expect((await editor.itemFor(p.sku)).item.currentRecorded).toBe(false);
      expect((await editor.save(p, "first")).after).toEqual({
        sellingUnitPrice: null,
        orderingPrice: "0.00",
        moq: null,
      });
      await expect(editor.itemFor("UNKNOWN")).rejects.toThrow("not found");
    });
    it.each(["S/1", "S%2", " SKU ", "สินค้า-😀", "😀".repeat(64)])(
      "writes the exact SKU %p without trimming, decoding or changing another product",
      async (sku) => {
        await f.seed(sku);
        const original = (await editor.itemFor("SYNTHETIC-PRICE-1")).item,
          p = await packet({ moq: 0 }, sku),
          saved = await editor.save(p, "exact-sku");
        expect(saved.packet.sku).toBe(sku);
        expect(saved.after.moq).toBe(0);
        expect((await editor.itemFor("SYNTHETIC-PRICE-1")).item).toEqual(
          original,
        );
      },
    );
    it.each(["value", "same-value", "absent-created"])(
      "rejects stale %s without writes or partial receipts",
      async (kind) => {
        if (kind === "absent-created")
          await db.query("DELETE FROM product_prices");
        if (kind === "absent-created")
          await db.query(
            "INSERT INTO josh_catalog_products VALUES($1) ON CONFLICT DO NOTHING",
            ["SYNTHETIC-PRICE-1"],
          );
        const p = await packet();
        await f.prices.edit(
          p.sku,
          { orderingPrice: kind === "value" ? 101 : 100 },
          "legacy",
        );
        const s = await state();
        await expect(editor.save(p, "stale")).rejects.toThrow("changed");
        expect(await state()).toBe(s);
      },
    );
    it("concurrent duplicate confirmation has one actual event and immutable outcome; replay after ownership/change", async () => {
      const p = await packet(),
        n = await eventCount(),
        [a, b] = await Promise.all([
          editor.save(p, "duplicate"),
          editor.save(p, "duplicate"),
        ]);
      expect(a.id).toBe(b.id);
      expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
      expect(await eventCount()).toBe(n + 1);
      await f.prices.edit(p.sku, { moq: 2 }, "later");
      process.env.COMMERCE_OWNS_PRICES = "false";
      expect((await editor.save(p, "duplicate")).replayed).toBe(true);
      await expect(
        editor.save({ ...p, patch: { moq: 3 } }, "duplicate"),
      ).rejects.toThrow("different");
      await expect(editor.save(await packet(), "new")).rejects.toThrow("owns");
    });
    it("recovers a committed request after a lost acknowledgement without writing another price or event", async () => {
      const p = await packet(),
        n = await eventCount(),
        disconnected = new ManualPriceService(
          {
            transaction: async (
              run: (manager: EntityManager) => Promise<unknown>,
            ) => {
              await db.transaction(run);
              throw Error("Synthetic connection lost after commit");
            },
          } as unknown as DataSource,
          f.prices,
        );
      await expect(disconnected.save(p, "interrupted")).rejects.toThrow(
        "unavailable",
      );
      const committed = await editor.request(
          p.requestId.toUpperCase(),
          "interrupted",
        ),
        replay = await editor.save(p, "interrupted");
      expect(committed.packet).toEqual(p);
      expect(replay).toMatchObject({ id: committed.id, replayed: true });
      expect(await eventCount()).toBe(n + 1);
    });
    it.each(["actor", "request", "draft"])(
      "does not confirm or replay a persisted receipt with mismatched %s identity",
      async (kind) => {
        const p = await packet(),
          actor = "receipt-integrity-" + kind,
          receipt = await editor.save(p, actor),
          corrupt = structuredClone(receipt);
        if (kind === "actor") corrupt.updatedBy = "another-account";
        if (kind === "request") {
          corrupt.requestId = randomUUID();
          corrupt.packet.requestId = corrupt.requestId;
        }
        if (kind === "draft") corrupt.id = randomUUID();
        await db.query(
          "UPDATE commerce_promotion_draft_requests SET receipt=$3 WHERE actor_id=$1 AND request_id=$2",
          [actor, p.requestId, JSON.stringify(corrupt)],
        );
        const s = await state();
        await expect(editor.request(p.requestId, actor)).rejects.toThrow(
          "unavailable",
        );
        await expect(editor.save(p, actor)).rejects.toThrow("unavailable");
        expect(await state()).toBe(s);
      },
    );
    it("two distinct manual edits from one version serialize and only one commits", async () => {
      const a = await packet({ sellingUnitPrice: 11 }),
        b = { ...a, requestId: randomUUID(), patch: { moq: 2 } },
        n = await eventCount(),
        results = await Promise.allSettled([
          editor.save(a, "a"),
          editor.save(b, "b"),
        ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await eventCount()).toBe(n + 1);
    });
    it("manual and ERP decisions from the same current evidence serialize; stale loser rolls back", async () => {
      const manual = await packet(),
        item = (await f.approval.itemFor(manual.sku)).items[0],
        erp = {
          requestId: randomUUID(),
          decision: "approve",
          changes: [{ sku: item.sku, version: item.version }],
        },
        n = await eventCount(),
        results = await Promise.allSettled([
          editor.save(manual, "manual-race"),
          f.approval.save(erp, "erp-race"),
        ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await eventCount()).toBe(n + 1);
    });
    it.each(["receipt", "outbox"])(
      "failed %s persistence rolls back price, ERP queue and event",
      async (kind) => {
        const p = await packet(),
          s = await state(),
          target =
            kind === "receipt"
              ? "commerce_promotion_draft_requests"
              : "outbox_messages";
        await db.query(
          `CREATE FUNCTION refuse_manual_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned fixture fault'; END $$`,
        );
        await db.query(
          `CREATE TRIGGER refuse_manual_fixture BEFORE INSERT ON ${target} FOR EACH ROW EXECUTE FUNCTION refuse_manual_fixture()`,
        );
        try {
          await expect(editor.save(p, "rollback")).rejects.toThrow(
            "unavailable",
          );
          expect(await state()).toBe(s);
          await expect(editor.request(p.requestId, "rollback")).rejects.toThrow(
            "not found",
          );
        } finally {
          await db.query(`DROP TRIGGER refuse_manual_fixture ON ${target}`);
          await db.query("DROP FUNCTION refuse_manual_fixture()");
        }
      },
    );
    it("refuses completion and rolls back when native storage returns different price values", async () => {
      const p = await packet(),
        s = await state();
      await db.query(
        "CREATE FUNCTION corrupt_manual_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.selling_unit_price := 42; RETURN NEW; END $$",
      );
      await db.query(
        "CREATE TRIGGER corrupt_manual_fixture BEFORE UPDATE ON product_prices FOR EACH ROW EXECUTE FUNCTION corrupt_manual_fixture()",
      );
      try {
        await expect(editor.save(p, "native-mismatch")).rejects.toThrow(
          "unavailable",
        );
        expect(await state()).toBe(s);
        await expect(
          editor.request(p.requestId, "native-mismatch"),
        ).rejects.toThrow("not found");
      } finally {
        await db.query("DROP TRIGGER corrupt_manual_fixture ON product_prices");
        await db.query("DROP FUNCTION corrupt_manual_fixture()");
      }
    });
    it("cross-action request IDs conflict and private lookup never exposes an ERP receipt as a manual edit", async () => {
      const p = await packet(),
        item = (await f.approval.itemFor(p.sku)).items[0];
      await f.approval.save(
        {
          requestId: p.requestId,
          decision: "reject",
          changes: [{ sku: item.sku, version: item.version }],
        },
        "cross",
      );
      await expect(editor.save(p, "cross")).rejects.toThrow("different");
      await expect(editor.request(p.requestId, "cross")).rejects.toThrow(
        "not found",
      );
    });
    it("native fail-fast ownership and empty-patch errors precede DB access", async () => {
      const tx = jest.spyOn(db, "transaction");
      process.env.COMMERCE_OWNS_PRICES = "false";
      await expect(f.prices.edit("S", {}, "a")).rejects.toThrow("josh");
      expect(tx).not.toHaveBeenCalled();
      process.env.COMMERCE_OWNS_PRICES = "true";
      await expect(f.prices.edit("S", {}, "a")).rejects.toThrow("ไม่มีราคา");
      expect(tx).not.toHaveBeenCalled();
      tx.mockRestore();
    });
    it("rejects malformed identities and uncontracted price units before accessing SQL", async () => {
      const read = jest.spyOn(db.manager, "query"),
        tx = jest.spyOn(db, "transaction"),
        valid = {
          requestId: randomUUID(),
          sku: "SYNTHETIC-PRICE-1",
          version: "a".repeat(64),
          patch: { moq: 1 },
        };
      try {
        for (const sku of ["", " ", "S\u0000K", "😀".repeat(65)])
          await expect(editor.itemFor(sku)).rejects.toThrow("Invalid SKU");
        for (const actor of ["", " ", "actor\u0000other", "a".repeat(129)]) {
          await expect(editor.save(valid, actor)).rejects.toThrow("identity");
          await expect(editor.request(valid.requestId, actor)).rejects.toThrow(
            "identity",
          );
        }
        for (const extra of [
          { uom: "kg" },
          { currency: "THB" },
          { actor: "other" },
        ])
          await expect(
            editor.save({ ...valid, ...extra }, "actor"),
          ).rejects.toThrow("Invalid price edit");
        expect(read).not.toHaveBeenCalled();
        expect(tx).not.toHaveBeenCalled();
      } finally {
        read.mockRestore();
        tx.mockRestore();
      }
    });
  },
);
