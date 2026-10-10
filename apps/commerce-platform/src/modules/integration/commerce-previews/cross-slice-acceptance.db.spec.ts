import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { OutboxMessage } from "../../../shared-kernel/infrastructure/outbox.entity";
import { EventEmitterBus } from "../../../shared-kernel/infrastructure/event-emitter.bus";
import { JoshCustomers } from "../connector/josh/josh-customers";
import { JoshReplica } from "../connector/josh/josh-replica";
import {
  comparisonFixture,
  comparisonFixtureEntities,
} from "../competitor-prices/comparison-fixtures";
import { AssignmentWorkspaceService } from "../customers/assignment-workspace.service";
import { GoalInputsService } from "../financial-goals/goal-inputs.service";
import { GoalDraftsService } from "../financial-goals/goal-drafts.service";
import { fixtureGoalScenario } from "../financial-goals/goal-fixtures";
import { PackDraftsService } from "../pack-price-planning/pack-drafts.service";
import { fixtureScenario } from "../pack-price-planning/pack-fixtures";
import { PromotionDraftsService } from "../promotion-planning/promotion-drafts.service";
import { PromotionInputsService } from "../promotion-planning/promotion-inputs.service";
import { CommercialDraftsService } from "../commercial-work/commercial-drafts.service";
import {
  sourceFixture,
  companyId,
  repId,
  planStaff,
  planScenario,
} from "../commercial-work/plan-fixtures";
const url = process.env.ACCEPTANCE_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "cross-slice private receipts and operational boundaries in owned SQL",
  () => {
    let db: DataSource,
      f: Awaited<ReturnType<typeof comparisonFixture>>,
      packs: PackDraftsService,
      goals: GoalDraftsService,
      promotions: PromotionDraftsService,
      commercial: CommercialDraftsService,
      assignment: AssignmentWorkspaceService,
      goalInputs: GoalInputsService,
      protectedPublic: string;
    const actor = "acceptance-integration-" + randomUUID(),
      staff = { ...planStaff, userId: actor, role: "admin" as const },
      marketing = { ...staff, role: "marketing" as const },
      sources = sourceFixture();
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
      const u = new URL(url!);
      if (
        u.hostname !== "127.0.0.1" ||
        u.port !== process.env.ACCEPTANCE_FIXTURE_PORT ||
        u.pathname !== "/commerce_preview_test" ||
        process.env.ACCEPTANCE_FIXTURE_OWNED !== "commerce-pack-price-20261009"
      )
        throw Error("Explicit owned local acceptance fixture required");
      const schema =
        "competitor_workspace_fixture_" + randomUUID().replace(/-/g, "");
      db = await new DataSource({
        type: "postgres",
        url,
        schema,
        entities: [...comparisonFixtureEntities, OutboxMessage],
        uuidExtension: "pgcrypto",
        installExtensions: false,
        synchronize: false,
        extra: { max: 6, options: `-c search_path=${schema}` },
      }).initialize();
      protectedPublic = await publicSnapshot();
      f = await comparisonFixture(db, schema);
      await db.query(
        `INSERT INTO josh_catalog_products(id,sku,status,selling_unit_price,selling_unit,vat_type,packaging_type,pack_size,translations,josh_updated_at)
         VALUES($1,'SYNTHETIC-SKU','active',107,'PK','7%','fixed','1 KG','[]',now())`,
        [randomUUID()],
      );
      await db.query(
        "CREATE TABLE product_promotion_rules(LIKE public.product_promotion_rules INCLUDING ALL)",
      );
      await db.query(
        "INSERT INTO product_promotion_rules SELECT * FROM public.product_promotion_rules",
      );
      for (const sql of [
        "CREATE TABLE company_sales_reps(id uuid PRIMARY KEY,assigned_sales_user_id uuid,updated_at timestamptz NOT NULL DEFAULT now())",
        "CREATE TABLE josh_customers(id uuid PRIMARY KEY,data jsonb NOT NULL,deleted_at timestamptz)",
        "CREATE TABLE users(id uuid PRIMARY KEY,name text,role text,status text)",
        "CREATE TABLE josh_staff(id uuid PRIMARY KEY,first_name text,last_name text,is_active boolean,user_type text,role text)",
        "CREATE TABLE winback_staff_links(josh_user_id uuid PRIMARY KEY)",
        "CREATE TABLE company(id uuid PRIMARY KEY,name text,erp_customer_code text,assigned_sales_user_id uuid)",
      ])
        await db.query(sql);
      await db.query("INSERT INTO company VALUES($1,$2,$3,$4)", [
        companyId,
        "Synthetic integrated company",
        "SYNTHETIC",
        repId,
      ]);
      await db.query(
        "INSERT INTO company_sales_reps(id,assigned_sales_user_id) VALUES($1,$2)",
        [companyId, repId],
      );
      await db.query("INSERT INTO josh_customers VALUES($1,$2,NULL)", [
        randomUUID(),
        { company_id: companyId, role: "customer" },
      ]);
      await db.query("INSERT INTO users VALUES($1,$2,$3,$4)", [
        repId,
        "Synthetic Old Owner",
        "sale",
        "active",
      ]);
      await db.query("INSERT INTO users VALUES($1,$2,$3,$4)", [
        "00000000-0000-4000-8000-000000000204",
        "Synthetic New Owner",
        "sale",
        "active",
      ]);
      const companies = new JoshCustomers({
        configured: true,
        query: (sql: string, params: unknown[]) => db.query(sql, params),
      } as unknown as JoshReplica);
      assignment = new AssignmentWorkspaceService(
        db,
        companies,
        new EventEmitterBus(db.getRepository(OutboxMessage)),
      );
      packs = new PackDraftsService(db, f.inputs);
      goalInputs = new GoalInputsService({
        available: true,
        source: "copies",
        dashboard: async () => ({
          gmv: 10700,
          target: { set: true, baht: 20000 },
        }),
      } as never);
      goals = new GoalDraftsService(db, goalInputs);
      promotions = new PromotionDraftsService(
        db,
        new PromotionInputsService(db),
      );
      commercial = new CommercialDraftsService(db, sources.service);
    });
    beforeEach(() => {
      process.env.COMMERCE_OWNS_SALES_REPS = "true";
      process.env.WINBACK_ACCEPT_JOSH_JWT = "false";
    });
    afterAll(async () => {
      expect(await publicSnapshot()).toBe(protectedPublic);
      await db.destroy();
      delete process.env.COMMERCE_OWNS_SALES_REPS;
      delete process.env.WINBACK_ACCEPT_JOSH_JWT;
    });
    const packBody = async () => ({
      requestId: randomUUID(),
      scenario: fixtureScenario(await f.inputs.inputs("SYNTHETIC-SKU")),
    });
    const goalBody = async () => ({
      requestId: randomUUID(),
      scenario: fixtureGoalScenario(await goalInputs.inputs("2026-10")),
    });
    const promoBody = () => ({
      requestId: randomUUID(),
      scenario: {
        name: "Synthetic cross-slice rehearsal",
        line: {
          sku: "SYNTHETIC-SKU",
          quantity: 2,
          unit: "PK",
          quantityKind: "count",
        },
        proposedValue: { type: "percentage", percent: 10 },
        minimumGrossMarginPercent: null,
      },
    });
    const commercialBody = async (
      kind: "sales_work" | "marketing_readiness",
    ) => ({
      requestId: randomUUID(),
      scenario: planScenario(
        await sources.service.inputs(
          kind,
          kind === "sales_work" ? companyId : "SYNTHETIC-SKU",
          null,
          kind === "sales_work" ? staff : marketing,
        ),
      ),
    });
    it("partitions five native proposal kinds without counting action receipts as Today promotion drafts", async () => {
      await promotions.create(promoBody(), actor);
      await packs.create(await packBody(), actor);
      await goals.create(await goalBody(), actor);
      await commercial.create(
        "sales_work",
        await commercialBody("sales_work"),
        staff,
      );
      await commercial.create(
        "marketing_readiness",
        await commercialBody("marketing_readiness"),
        marketing,
      );
      expect((await promotions.list(actor)).items).toHaveLength(1);
      expect((await packs.list(actor)).items).toHaveLength(1);
      expect((await goals.list(actor)).items).toHaveLength(1);
      expect((await commercial.list("sales_work", staff)).items).toHaveLength(
        1,
      );
      expect(
        (await commercial.list("marketing_readiness", marketing)).items,
      ).toHaveLength(1);
      const w = await f.workspace.workspace("COMPARE-CHICKEN");
      await f.workspace.save(
        {
          requestId: randomUUID(),
          sku: w.sku,
          sourceFingerprint: w.sourceFingerprint,
          commands: [
            {
              operation: "verify",
              pairId: f.pairs[0],
              revision: 1,
              relationship: "same_product",
              note: "Reviewed synthetic product identity.",
            },
          ],
        },
        actor,
        "acceptance-fixture@example.invalid",
      );
      const review = await assignment.review({
        companyIds: [companyId],
        salesUserId: "00000000-0000-4000-8000-000000000204",
      });
      await assignment.save(
        {
          requestId: randomUUID(),
          salesUserId: review.newOwner!.id,
          changes: review.items.map((i) => ({
            companyId: i.companyId,
            version: i.version,
          })),
        },
        actor,
      );
      expect((await promotions.list(actor)).items).toHaveLength(1);
      expect((await packs.list(actor)).items).toHaveLength(1);
      expect((await goals.list(actor)).items).toHaveLength(1);
      expect((await commercial.list("sales_work", staff)).items).toHaveLength(
        1,
      );
      expect(
        (await commercial.list("marketing_readiness", marketing)).items,
      ).toHaveLength(1);
    });
    it("recovers only the feature and actor that committed the original request", async () => {
      const body = await goalBody(),
        r = await goals.create(body, actor);
      expect(await goals.request(body.requestId, actor)).toMatchObject({
        id: r.id,
        persisted: true,
      });
      for (const read of [
        () => packs.request(body.requestId, actor),
        () => promotions.request(body.requestId, actor),
        () => commercial.request("sales_work", body.requestId, staff),
        () => assignment.request(body.requestId, actor),
        () => goals.request(body.requestId, "other-actor"),
      ])
        await expect(read()).rejects.toThrow();
      const before = (
        await db.query("SELECT count(*)::int n FROM commerce_promotion_drafts")
      )[0].n;
      await expect(
        packs.create(
          { ...(await packBody()), requestId: body.requestId },
          actor,
        ),
      ).rejects.toThrow("different");
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM commerce_promotion_drafts",
          )
        )[0].n,
      ).toBe(before);
    });
    it("serializes concurrent cross-kind requests so exactly one private operation can own a key", async () => {
      const p = await packBody(),
        g = { ...(await goalBody()), requestId: p.requestId };
      const before = (
        await db.query("SELECT count(*)::int n FROM commerce_promotion_drafts")
      )[0].n;
      const result = await Promise.allSettled([
        packs.create(p, actor),
        goals.create(g, actor),
      ]);
      expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM commerce_promotion_drafts",
          )
        )[0].n - before,
      ).toBe(1);
    });
    it("keeps private proposal writes separate from operational rules/prices and actual profit", async () => {
      const saved = await goals.create(await goalBody(), actor);
      expect(saved.preview.actual).toBeNull();
      expect(saved.operationalWrites).toBe(false);
      expect(saved.activationAllowed).toBe(false);
      const p = await packs.create(await packBody(), actor);
      expect(p.inputs.cost).toBeNull();
      expect(p.activationAllowed).toBe(false);
      expect(
        (
          await db.query(
            "SELECT selling_unit_price::text price FROM josh_catalog_products WHERE sku=$1",
            ["SYNTHETIC-SKU"],
          )
        )[0].price,
      ).toBe("107.00");
      expect(
        (
          await db.query(
            "SELECT rules,shadow_rules FROM product_promotion_rules WHERE sku=$1",
            ["SYNTHETIC-SKU"],
          )
        )[0],
      ).toMatchObject({ rules: [], shadow_rules: [] });
    });
    it("does not treat native assignment commit/outbox as delivered replica ownership", async () => {
      const [native] = await db.query(
        "SELECT assigned_sales_user_id FROM company_sales_reps WHERE id=$1",
        [companyId],
      );
      const [replica] = await db.query(
        "SELECT assigned_sales_user_id FROM company WHERE id=$1",
        [companyId],
      );
      expect(native.assigned_sales_user_id).toBe(
        "00000000-0000-4000-8000-000000000204",
      );
      expect(replica.assigned_sales_user_id).toBe(repId);
      const [row] = await db.query(
        "SELECT receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND receipt->'scenario'->>'kind'='customer_assignment'",
        [actor],
      );
      expect(row.receipt.downstreamDelivery).toBe("unverified");
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM outbox_messages WHERE type='company.sales_rep'",
          )
        )[0].n,
      ).toBe(1);
    });
    it("replays an unchanged goal request without refreshing its context or inventing actuals", async () => {
      const body = await goalBody(),
        a = await goals.create(body, actor),
        b = await goals.create(body, actor);
      expect(b).toMatchObject({ id: a.id, replayed: true });
      expect(b.inputs.actuals).toMatchObject({
        netSalesExVat: null,
        internalCostExVat: null,
        operatingExpensesExVat: null,
        grossProfitExVat: null,
        achievementPercent: null,
      });
    });
  },
);
