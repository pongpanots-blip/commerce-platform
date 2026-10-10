import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CommercialDraftsService } from "./commercial-drafts.service";
import {
  sourceFixture,
  companyId,
  planStaff,
  planScenario,
} from "./plan-fixtures";
const url = process.env.COMMERCIAL_PLANNING_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "commercial plans on owned synthetic existing PostgreSQL tables",
  () => {
    let db: DataSource,
      drafts: CommercialDraftsService,
      id: string,
      key: string;
    const f = sourceFixture();
    const staff = { ...planStaff, userId: "commercial-db-fixture-actor" },
      marketing = { ...staff, role: "marketing" as const };
    const scenario = async () =>
      planScenario(
        await f.service.inputs("sales_work", companyId, null, staff),
      );
    beforeAll(async () => {
      const u = new URL(url!);
      if (
        u.hostname !== "127.0.0.1" ||
        u.pathname !== "/commerce_preview_test" ||
        u.port !== process.env.COMMERCIAL_FIXTURE_PORT ||
        process.env.COMMERCIAL_FIXTURE_OWNED !== "commerce-pack-price-20261009"
      )
        throw Error("Explicit owned localhost synthetic fixture only");
      const schema = `commercial_work_fixture_${randomUUID().replace(/-/g, "")}`;
      db = await new DataSource({
        type: "postgres",
        url,
        synchronize: false,
        extra: { max: 3, options: `-c search_path=${schema}` },
      }).initialize();
      await db.query(`CREATE SCHEMA "${schema}"`);
      for (const table of [
        "commerce_promotion_drafts",
        "commerce_promotion_draft_requests",
      ])
        await db.query(
          `CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`,
        );
      await db.query(
        "ALTER TABLE commerce_promotion_draft_requests ADD CONSTRAINT commercial_fixture_reference FOREIGN KEY(draft_id) REFERENCES commerce_promotion_drafts(id)",
      );
      drafts = new CommercialDraftsService(db, f.service);
    });
    afterAll(async () => {
      if (db?.isInitialized) await db.destroy();
    });
    it("duplicate requests commit once, with immutable recovery and no actual/completed-action claims", async () => {
      key = randomUUID();
      const body = { requestId: key, scenario: await scenario() };
      const r = await Promise.all([
        drafts.create("sales_work", body, staff),
        drafts.create("sales_work", body, staff),
      ]);
      id = r[0].id;
      expect(r.map((x) => x.replayed).sort()).toEqual([false, true]);
      expect(r[0]).toMatchObject({
        revision: 1,
        persisted: true,
        operationalWrites: false,
        activationAllowed: false,
      });
      expect((await drafts.list("sales_work", staff)).items).toHaveLength(1);
      await expect(
        drafts.create(
          "sales_work",
          { ...body, scenario: { ...body.scenario, name: "Different" } },
          staff,
        ),
      ).rejects.toThrow("different planning operation");
    });
    it("isolates actor and kind, including cross-kind request keys", async () => {
      await expect(
        drafts.get("sales_work", id, { ...staff, userId: "other" }),
      ).rejects.toThrow("not found");
      await expect(
        drafts.get("marketing_readiness", id, staff),
      ).rejects.toThrow("not found");
      expect(await drafts.list("marketing_readiness", staff)).toEqual({
        items: [],
        next: null,
      });
      const s = planScenario(
        await f.service.inputs(
          "marketing_readiness",
          "SYNTHETIC-SKU",
          null,
          marketing,
        ),
      );
      await expect(
        drafts.create(
          "marketing_readiness",
          { requestId: key, scenario: s },
          marketing,
        ),
      ).rejects.toThrow("different planning operation");
      expect(
        await drafts.create(
          "marketing_readiness",
          { requestId: randomUUID(), scenario: s },
          marketing,
        ),
      ).toMatchObject({
        preview: { readiness: "needs_confirmation", roas: null },
      });
    });
    it("CAS allows one concurrent editor; original committed receipt survives later revisions and source changes", async () => {
      const s = await scenario();
      const r = await Promise.allSettled(
        ["A", "B"].map((name) =>
          drafts.update(
            "sales_work",
            id,
            { requestId: randomUUID(), revision: 1, scenario: { ...s, name } },
            staff,
          ),
        ),
      );
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
      expect((await drafts.get("sales_work", id, staff)).revision).toBe(2);
      const old = await drafts.request("sales_work", key, staff);
      f.company.name = "Changed";
      expect(
        await drafts.create(
          "sales_work",
          { requestId: key, scenario: old.scenario },
          staff,
        ),
      ).toMatchObject({ revision: 1, replayed: true });
      f.company.name = "Synthetic assigned company";
    });
    it("stale source blocks a fresh intent without writing either record", async () => {
      const s = await scenario(),
        requestId = randomUUID(),
        before = (await drafts.list("sales_work", staff)).items.length;
      f.company.name = "Changed";
      await expect(
        drafts.create("sales_work", { requestId, scenario: s }, staff),
      ).rejects.toThrow("evidence changed");
      expect((await drafts.list("sales_work", staff)).items).toHaveLength(
        before,
      );
      await expect(
        drafts.request("sales_work", requestId, staff),
      ).rejects.toThrow("not found");
      f.company.name = "Synthetic assigned company";
    });
    it("revoked authorization blocks get/list/request/committed replay and never disguises a committed receipt as absent", async () => {
      const previous = f.customer.planningSubject,
        old = await drafts.request("sales_work", key, staff);
      f.customer.planningSubject = async () => {
        throw new NotFoundException("Source assignment unavailable");
      };
      try {
        for (const action of [
          () => drafts.get("sales_work", id, staff),
          () => drafts.list("sales_work", staff),
          () => drafts.request("sales_work", key, staff),
          () =>
            drafts.create(
              "sales_work",
              { requestId: key, scenario: old.scenario },
              staff,
            ),
        ])
          await expect(action()).rejects.toThrow(
            "Source assignment unavailable",
          );
      } finally {
        f.customer.planningSubject = previous;
      }
    });
    it("receipt insertion failure rolls back; confirmed absence can retry the immutable intent", async () => {
      await db.query(
        "CREATE FUNCTION fail_commercial_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$",
      );
      await db.query(
        "CREATE TRIGGER fail_commercial_receipt BEFORE INSERT ON commerce_promotion_draft_requests FOR EACH ROW EXECUTE FUNCTION fail_commercial_receipt()",
      );
      const body = { requestId: randomUUID(), scenario: await scenario() },
        before = (await drafts.list("sales_work", staff)).items.length;
      try {
        await expect(drafts.create("sales_work", body, staff)).rejects.toThrow(
          "Check the original request",
        );
        expect((await drafts.list("sales_work", staff)).items).toHaveLength(
          before,
        );
        await expect(
          drafts.request("sales_work", body.requestId, staff),
        ).rejects.toThrow("not found");
      } finally {
        await db.query(
          "DROP TRIGGER fail_commercial_receipt ON commerce_promotion_draft_requests",
        );
        await db.query("DROP FUNCTION fail_commercial_receipt()");
      }
      expect(await drafts.create("sales_work", body, staff)).toMatchObject({
        persisted: true,
        revision: 1,
      });
    });
    it("paginates twenty returned private drafts while excluding other kinds and owners", async () => {
      const pageStaff = { ...staff, userId: "commercial-paging-fixture" },
        s = await scenario();
      for (let n = 0; n < 21; n++)
        await drafts.create(
          "sales_work",
          { requestId: randomUUID(), scenario: s },
          pageStaff,
        );
      const p = await drafts.list("sales_work", pageStaff);
      expect(p.items).toHaveLength(20);
      expect(p.next).not.toBeNull();
      expect(
        (await drafts.list("sales_work", pageStaff, p.next!)).items,
      ).toHaveLength(1);
      expect(
        (await drafts.list("marketing_readiness", pageStaff)).items,
      ).toHaveLength(0);
    });
  },
);
