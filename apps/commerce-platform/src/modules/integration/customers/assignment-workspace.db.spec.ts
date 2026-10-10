import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { OutboxMessage } from "../../../shared-kernel/infrastructure/outbox.entity";
import { assignmentFixture } from "./assignment-fixtures";
import { PackDraftsService } from "../pack-price-planning/pack-drafts.service";
import { PromotionDraftsService } from "../promotion-planning/promotion-drafts.service";
import {
  fixtureInputs,
  fixtureScenario,
} from "../pack-price-planning/pack-fixtures";
import { comparePacks } from "../pack-price-planning/pack-price";
import { AssignmentPacket } from "./assignment-contracts";
const url = process.env.ASSIGNMENT_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "customer assignment native persistence in owned isolated SQL",
  () => {
    let db: DataSource,
      f: Awaited<ReturnType<typeof assignmentFixture>>,
      schema: string,
      publicBefore: string;
    const publicSnapshot = async () =>
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
    beforeAll(async () => {
      const parsed = new URL(url!);
      if (
        parsed.hostname !== "127.0.0.1" ||
        parsed.port !== process.env.ASSIGNMENT_FIXTURE_PORT ||
        parsed.pathname !== "/commerce_preview_test" ||
        process.env.ASSIGNMENT_FIXTURE_OWNED !== "commerce-pack-price-20261009"
      )
        throw Error("Explicit owned localhost fixture required");
      schema = "customer_assignment_fixture_" + randomUUID().replace(/-/g, "");
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
      publicBefore = await publicSnapshot();
      f = await assignmentFixture(db, schema);
    });
    beforeEach(async () => {
      process.env.COMMERCE_OWNS_SALES_REPS = "true";
      process.env.WINBACK_ACCEPT_JOSH_JWT = "true";
      await db.query("UPDATE users SET status=$1", ["active"]);
      await db.query("DELETE FROM winback_staff_links");
      await db.query(
        "UPDATE company_sales_reps SET assigned_sales_user_id=$1,updated_at=clock_timestamp()",
        [f.ids.old],
      );
    });
    afterAll(async () => {
      expect(await publicSnapshot()).toBe(publicBefore);
      await db.destroy();
      delete process.env.COMMERCE_OWNS_SALES_REPS;
      delete process.env.WINBACK_ACCEPT_JOSH_JWT;
    });
    const packet = async (
      ids = [f.ids.company],
      salesUserId: string | null = f.ids.rep,
    ): Promise<AssignmentPacket> => {
      const r = await f.workspace.review({ companyIds: ids, salesUserId });
      return {
        requestId: randomUUID(),
        salesUserId,
        changes: r.items.map((i) => ({
          companyId: i.companyId,
          version: i.version,
        })),
      };
    };
    const snapshot = async () =>
      JSON.stringify({
        assignments: await db.query(
          "SELECT * FROM company_sales_reps ORDER BY id",
        ),
        events: await db.query("SELECT * FROM outbox_messages ORDER BY id"),
        requests: await db.query(
          "SELECT * FROM commerce_promotion_draft_requests ORDER BY request_id",
        ),
      });
    it("reviews native owners and imported account counts, returning no contact or credit fields", async () => {
      const r = await f.workspace.review({
        companyIds: [f.ids.company, f.ids.second],
        salesUserId: f.ids.rep,
      });
      expect(
        r.items.map((i) => [i.previousOwner?.id, i.importedCustomerCount]),
      ).toEqual([
        [f.ids.old, 1],
        [f.ids.old, 1],
      ]);
      expect(JSON.stringify(r)).not.toMatch(/email|phone|credit/);
      expect(r.sourceFreshness).toBe("unverified");
    });
    it("saves a whole batch, real outbox events and owner-private matching receipt atomically", async () => {
      const p = await packet([f.ids.company, f.ids.second]);
      const r = await f.workspace.save(p, "actor");
      expect(r).toMatchObject({
        appliedCount: 2,
        persisted: true,
        outboxEnqueued: true,
        downstreamDelivery: "unverified",
      });
      expect(
        (
          await db.query(
            "SELECT assigned_sales_user_id FROM company_sales_reps ORDER BY id",
          )
        ).map(
          (i: { assigned_sales_user_id: string }) => i.assigned_sales_user_id,
        ),
      ).toEqual([f.ids.rep, f.ids.rep]);
      expect(
        (
          await db.query(
            "SELECT payload FROM outbox_messages WHERE aggregate_id=ANY($1::uuid[]) ORDER BY aggregate_id",
            [[f.ids.company, f.ids.second]],
          )
        ).map(
          (i: { payload: { salesUserId: string } }) => i.payload.salesUserId,
        ),
      ).toEqual([f.ids.rep, f.ids.rep]);
      expect(await f.workspace.request(p.requestId, "actor")).toMatchObject({
        id: r.id,
        packet: p,
      });
    });
    it("serializes duplicate clicks into one assignment/event/receipt", async () => {
      const p = await packet(),
        before = (
          await db.query("SELECT count(*)::int n FROM outbox_messages")
        )[0].n;
      const [a, b] = await Promise.all([
        f.workspace.save(p, "duplicate"),
        f.workspace.save(p, "duplicate"),
      ]);
      expect(a.id).toBe(b.id);
      expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
      expect(
        (await db.query("SELECT count(*)::int n FROM outbox_messages"))[0].n -
          before,
      ).toBe(1);
    });
    it("recovers a committed request without rerunning writes after sources/ownership change", async () => {
      const p = await packet();
      const r = await f.workspace.save(p, "recover"),
        before = await snapshot();
      process.env.COMMERCE_OWNS_SALES_REPS = "false";
      expect(await f.workspace.save(p, "recover")).toMatchObject({
        id: r.id,
        replayed: true,
      });
      expect(await snapshot()).toBe(before);
    });
    it("rejects a stale member without changing any company in the batch", async () => {
      const p = await packet([f.ids.company, f.ids.second]);
      await f.legacy.assign(f.ids.second, f.ids.manager);
      const before = await snapshot();
      await expect(f.workspace.save(p, "stale")).rejects.toThrow("changed");
      expect(await snapshot()).toBe(before);
      await expect(f.workspace.request(p.requestId, "stale")).rejects.toThrow(
        "not found",
      );
    });
    it("rejects same-owner no-ops instead of manufacturing completed assignments", async () => {
      const review = await f.workspace.review({
        companyIds: [f.ids.company],
        salesUserId: f.ids.old,
      });
      expect(review.items[0].previousOwner?.id).toBe(f.ids.old);
      const before = await snapshot();
      await expect(
        f.workspace.save(
          {
            requestId: randomUUID(),
            salesUserId: f.ids.old,
            changes: review.items.map((i) => ({
              companyId: i.companyId,
              version: i.version,
            })),
          },
          "no-op",
        ),
      ).rejects.toThrow("already");
      expect(await snapshot()).toBe(before);
    });
    it("clears an owner with null and preserves the real previous owner in the receipt", async () => {
      const r = await f.workspace.save(
        await packet([f.ids.company], null),
        "clear",
      );
      expect(r.items[0]).toMatchObject({
        previousOwner: { id: f.ids.old },
        newOwner: null,
      });
      expect(
        (
          await db.query(
            "SELECT assigned_sales_user_id FROM company_sales_reps WHERE id=$1",
            [f.ids.company],
          )
        )[0].assigned_sales_user_id,
      ).toBeNull();
    });
    it("accepts imported companies without invented previous assignment evidence", async () => {
      await db.query("DELETE FROM company_sales_reps WHERE id=$1", [
        f.ids.imported,
      ]);
      const r = await f.workspace.save(
        await packet([f.ids.imported]),
        "new-import",
      );
      expect(r.items[0]).toMatchObject({
        recorded: false,
        previousOwner: null,
        importedCustomerCount: 1,
      });
    });
    it("preserves the original roster: eligible commerce manager and unlinked Josh sales", async () => {
      expect(
        (
          await f.workspace.review({
            companyIds: [f.ids.company],
            salesUserId: f.ids.manager,
          })
        ).newOwner?.id,
      ).toBe(f.ids.manager);
      expect(
        (
          await f.workspace.review({
            companyIds: [f.ids.company],
            salesUserId: f.ids.josh,
          })
        ).newOwner?.id,
      ).toBe(f.ids.josh);
    });
    it("rejects inactive reps at commit after successful review", async () => {
      const p = await packet();
      await db.query("UPDATE users SET status=$1 WHERE id=$2", [
        "disabled",
        f.ids.rep,
      ]);
      const before = await snapshot();
      await expect(f.workspace.save(p, "inactive")).rejects.toThrow(
        "active eligible",
      );
      expect(await snapshot()).toBe(before);
    });
    it("rejects customer and unsupported-role owners without any writes", async () => {
      const id = randomUUID();
      await db.query("INSERT INTO users VALUES($1,$2,$3,$4)", [
        id,
        "Synthetic BA",
        "business_analyst",
        "active",
      ]);
      const before = await snapshot();
      await expect(
        f.workspace.review({ companyIds: [f.ids.company], salesUserId: id }),
      ).rejects.toThrow("eligible");
      expect(await snapshot()).toBe(before);
    });
    it("rejects linked Josh reps when native roster eligibility changes", async () => {
      const p = await packet([f.ids.company], f.ids.josh);
      await db.query("INSERT INTO winback_staff_links VALUES($1)", [
        f.ids.josh,
      ]);
      await expect(f.workspace.save(p, "linked")).rejects.toThrow("eligible");
    });
    it("refuses new review and save when Josh owns the feature", async () => {
      const p = await packet(),
        before = await snapshot();
      process.env.COMMERCE_OWNS_SALES_REPS = "false";
      await expect(
        f.workspace.review({
          companyIds: [f.ids.company],
          salesUserId: f.ids.rep,
        }),
      ).rejects.toThrow("owned by Josh");
      await expect(f.workspace.save(p, "josh-owned")).rejects.toThrow(
        "owned by Josh",
      );
      expect(await snapshot()).toBe(before);
    });
    it("rolls the first assignment back when a later outbox insert fails", async () => {
      const p = await packet([f.ids.company, f.ids.second]),
        before = await snapshot();
      await db.query(
        `CREATE FUNCTION assignment_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.aggregate_id='${f.ids.second}' THEN RAISE EXCEPTION 'synthetic outbox failure'; END IF; RETURN NEW; END $$`,
      );
      await db.query(
        "CREATE TRIGGER assignment_fixture_fail BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION assignment_fixture_fail()",
      );
      try {
        await expect(f.workspace.save(p, "outbox-fail")).rejects.toThrow(
          "Check the original request",
        );
        expect(await snapshot()).toBe(before);
      } finally {
        await db.query(
          "DROP TRIGGER assignment_fixture_fail ON outbox_messages",
        );
        await db.query("DROP FUNCTION assignment_fixture_fail()");
      }
      expect(await f.workspace.save(p, "outbox-fail")).toMatchObject({
        appliedCount: 2,
      });
    });
    it("rolls all assignments and events back if receipt persistence fails", async () => {
      const p = await packet([f.ids.company, f.ids.second]),
        before = await snapshot();
      await db.query(
        "CREATE FUNCTION assignment_receipt_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$",
      );
      await db.query(
        "CREATE TRIGGER assignment_receipt_fail BEFORE INSERT ON commerce_promotion_draft_requests FOR EACH ROW EXECUTE FUNCTION assignment_receipt_fail()",
      );
      try {
        await expect(f.workspace.save(p, "receipt-fail")).rejects.toThrow(
          "Check the original request",
        );
        expect(await snapshot()).toBe(before);
        await expect(
          f.workspace.request(p.requestId, "receipt-fail"),
        ).rejects.toThrow("not found");
      } finally {
        await db.query(
          "DROP TRIGGER assignment_receipt_fail ON commerce_promotion_draft_requests",
        );
        await db.query("DROP FUNCTION assignment_receipt_fail()");
      }
      expect(await f.workspace.save(p, "receipt-fail")).toMatchObject({
        appliedCount: 2,
      });
    });
    it("invalidates review when imported customer scope changes", async () => {
      const p = await packet();
      await db.query("INSERT INTO josh_customers VALUES($1,$2,NULL)", [
        randomUUID(),
        { company_id: f.ids.company },
      ]);
      const before = await snapshot();
      await expect(f.workspace.save(p, "changed-scope")).rejects.toThrow(
        "scope changed",
      );
      expect(await snapshot()).toBe(before);
    });
    it("allows only one concurrent different request against the same reviewed owner", async () => {
      const a = await packet(),
        b = { ...a, requestId: randomUUID(), salesUserId: f.ids.manager };
      const result = await Promise.allSettled([
        f.workspace.save(a, "concurrent"),
        f.workspace.save(b, "concurrent"),
      ]);
      expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
    it("rejects altered replay and cannot expose another actor receipt", async () => {
      const p = await packet();
      await f.workspace.save(p, "private");
      await expect(
        f.workspace.save({ ...p, salesUserId: f.ids.manager }, "private"),
      ).rejects.toThrow("different assignments");
      await expect(f.workspace.request(p.requestId, "other")).rejects.toThrow(
        "not found",
      );
    });
    it.each([0, 21])(
      "rejects invalid batch size %s before source access",
      async (n) => {
        const ids = Array.from({ length: n }, () => randomUUID());
        await expect(
          f.workspace.review({ companyIds: ids, salesUserId: f.ids.rep }),
        ).rejects.toThrow("1–20");
      },
    );
    it("rejects duplicates, spoofed actors and unknown companies without partial writes", async () => {
      const before = await snapshot();
      await expect(
        f.workspace.review({
          companyIds: [f.ids.company, f.ids.company],
          salesUserId: f.ids.rep,
        }),
      ).rejects.toThrow("unique");
      await expect(
        f.workspace.save({ ...(await packet()), actor: "admin" }, "actor"),
      ).rejects.toThrow("Invalid assignment");
      await expect(
        f.workspace.review({
          companyIds: [f.ids.company, randomUUID()],
          salesUserId: f.ids.rep,
        }),
      ).rejects.toThrow("unavailable");
      expect(await snapshot()).toBe(before);
    });
    it("preserves existing private draft readers and prevents cross-kind request-key reuse", async () => {
      const packs = new PackDraftsService(db, {
        preview: async (s: ReturnType<typeof fixtureScenario>) => ({
          scenario: s,
          inputs: fixtureInputs(),
          preview: comparePacks(s, fixtureInputs()),
        }),
      } as never);
      const promotions = new PromotionDraftsService(db, {} as never);
      const p = await packet();
      const saved = await packs.create(
        { requestId: p.requestId, scenario: fixtureScenario() },
        "cross-kind",
      );
      const before = await snapshot();
      await expect(f.workspace.save(p, "cross-kind")).rejects.toThrow(
        "different assignments",
      );
      expect(await snapshot()).toBe(before);
      expect(await packs.request(p.requestId, "cross-kind")).toMatchObject({
        id: saved.id,
      });
      await f.workspace.save(await packet(), "cross-kind");
      expect((await packs.list("cross-kind")).items).toHaveLength(1);
      expect((await promotions.list("cross-kind")).items).toHaveLength(0);
    });
  },
);
