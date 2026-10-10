import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { DataSource } from "typeorm";
import { PostgresQueryRunner } from "typeorm/driver/postgres/PostgresQueryRunner";
import {
  comparisonFixture,
  comparisonFixtureEntities,
} from "./comparison-fixtures";
import { CompetitorPrice } from "./competitor-price.entity";
import { PromotionDraftsService } from "../promotion-planning/promotion-drafts.service";
import { PackDraftsService } from "../pack-price-planning/pack-drafts.service";
import {
  comparisonPacketSchema,
  type ComparisonCommand,
} from "./comparison-contracts";
const raw = process.env.COMPARISON_TEST_DATABASE_URL;
(raw ? describe : describe.skip)(
  "comparison actions against isolated owned PostgreSQL and native readers",
  () => {
    let db: DataSource,
      f: Awaited<ReturnType<typeof comparisonFixture>>,
      schema: string,
      baseline: Record<string, unknown[]>,
      publicBefore: string;
    const snapshotPublic = async () =>
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
      const u = new URL(raw!);
      if (
        u.hostname !== "127.0.0.1" ||
        u.port !== process.env.COMPARISON_FIXTURE_PORT ||
        u.pathname !== "/commerce_preview_test" ||
        process.env.COMPARISON_FIXTURE_OWNED !== "commerce-pack-price-20261009"
      )
        throw Error("Owned localhost fixture required");
      schema = "competitor_workspace_fixture_" + randomUUID().replace(/-/g, "");
      db = await new DataSource({
        type: "postgres",
        url: u.href,
        schema,
        uuidExtension: "pgcrypto",
        installExtensions: false,
        entities: comparisonFixtureEntities,
        synchronize: false,
        extra: { max: 8, options: `-c search_path=${schema}` },
      }).initialize();
      publicBefore = await snapshotPublic();
      f = await comparisonFixture(db, schema);
      baseline = {};
      for (const t of [
        "josh_catalog_products",
        "scraping_sources",
        "scraped_items",
        "competitor_prices",
      ])
        baseline[t] = await db.query(`SELECT * FROM ${t} ORDER BY id`);
    }, 30000);
    beforeEach(async () => {
      for (const t of [
        "commerce_promotion_draft_requests",
        "commerce_promotion_drafts",
        "competitor_match_rejections",
        "competitor_match_reviews",
        "competitor_prices",
        "scraped_items",
        "scraping_sources",
        "josh_catalog_products",
      ])
        await db.query(`DELETE FROM ${t}`);
      for (const t of [
        "josh_catalog_products",
        "scraping_sources",
        "scraped_items",
        "competitor_prices",
      ])
        for (const row of baseline[t])
          await db.query(
            `INSERT INTO ${t} SELECT (json_populate_record(NULL::${t},$1)).*`,
            [JSON.stringify(row)],
          );
    });
    afterAll(async () => {
      if (db) {
        expect(await snapshotPublic()).toBe(publicBefore);
        if (process.env.COMPARISON_DB_RECEIPT)
          writeFileSync(
            process.env.COMPARISON_DB_RECEIPT,
            JSON.stringify(
              {
                schema,
                syntheticOnly: true,
                migrationExecution: false,
                publicSourcesUnchanged: true,
                namespaceRetained: true,
                counts: await db.query(
                  "SELECT scenario->>'kind' kind,count(*)::int records FROM commerce_promotion_drafts GROUP BY 1",
                ),
              },
              null,
              2,
            ) + "\n",
          );
        await db.destroy();
      }
    });
    async function packet(
      commands: ComparisonCommand[],
      sku = f.products[0].sku,
    ) {
      const current = await f.workspace.workspace(sku);
      return comparisonPacketSchema.parse({
        requestId: randomUUID(),
        sku,
        sourceFingerprint: current.sourceFingerprint,
        commands,
      });
    }
    const verify = (
      pairId = f.pairs[0],
      revision = 1,
    ): Extract<ComparisonCommand, { operation: "verify" }> => ({
      operation: "verify",
      pairId,
      revision,
      relationship: "same_product",
      note: "Reviewed source product identity and quantity",
    });
    async function currentVerify(pairId = f.pairs[0]) {
      const w = await f.workspace.workspace(f.products[0].sku);
      return verify(pairId, w.rows.find((r) => r.id === pairId)!.revision);
    }
    it("returns duplicate vendor names as distinct stable identities and excludes member/foreign bases", async () => {
      const w = await f.workspace.workspace(f.products[0].sku);
      expect(w.rows).toHaveLength(4);
      expect(new Set(w.rows.map((r) => r.sourceKey)).size).toBe(4);
      expect(w.rows.filter((r) => r.eligible)).toHaveLength(2);
      expect(w.rows.find((r) => r.id === f.pairs[2])?.reasons).toContain(
        "currency_fx_unsupported",
      );
      expect(w.rows.find((r) => r.id === f.pairs[3])?.reasons).toContain(
        "member_eligibility_unverified",
      );
    });
    it("creates a collected candidate without silently verifying its identity", async () => {
      const c: ComparisonCommand = {
        operation: "create",
        sourceUrl: f.item.url,
        sourceId: f.item.sourceId,
        catalogItemId: f.item.id,
        name: f.item.name,
        competitorSku: f.item.sku,
        context: f.sources[1].config.priceContext,
        pack: { unit: "g", min: "500", max: "500", count: 1 },
      };
      const p = await packet([c]),
        r = await f.workspace.save(p, f.actor, f.email);
      expect(r.status).toBe("committed");
      const w = await f.workspace.workspace(p.sku),
        row = w.rows.find((x) => x.id === r.results[0].pairId)!;
      expect(row.reasons).toContain("mapping_unverified");
      expect(row.relationship).toBe("uncertain");
      expect(row.eligible).toBe(false);
    });
    it("records foreign/tax-excluded manual observations with raw provenance and no canonical THB substitution", async () => {
      const w = await f.workspace.workspace(f.products[0].sku),
        p = await packet([
          {
            operation: "capture",
            pairId: f.pairs[0],
            revision: w.rows.find((r) => r.id === f.pairs[0])!.revision,
            price: "25.00",
            currency: "USD",
            taxBasis: "exclusive",
            priceBasis: "public",
            observedAt: new Date().toISOString(),
            context: "Synthetic full-pack USD excluding VAT",
          },
        ]);
      const r = await f.workspace.save(p, f.actor, f.email);
      expect(r.status).toBe("committed");
      const [native] = await db.query(
        "SELECT price_inc_vat,verified_fingerprint FROM competitor_prices WHERE id=$1",
        [f.pairs[0]],
      );
      expect(native.price_inc_vat).toBeNull();
      expect(native.verified_fingerprint).toBeNull();
      const after = await f.workspace.workspace(p.sku),
        row = after.rows.find((x) => x.id === f.pairs[0])!;
      expect(row.observation.priceIncVat).toBe("25.00");
      expect(row.observation.currency).toBe("USD");
      expect(row.reasons).toEqual(
        expect.arrayContaining(["currency_fx_unsupported", "tax_unverified"]),
      );
      const history = await f.workspace.history(f.pairs[0]);
      expect(history.items[0].before.priceIncVat).toBe("100.00");
      expect(history.items[0].after.observation.capturedBy).toBe(f.actor);
    });
    it("same immutable request replays its committed receipt after sources change; changed body conflicts", async () => {
      const p = await packet([await currentVerify()]),
        first = await f.workspace.save(p, f.actor, f.email);
      const replay = await f.workspace.save(p, f.actor, f.email);
      expect(replay.savedAt).toBe(first.savedAt);
      expect(replay.results).toEqual(first.results);
      expect(replay.replayed).toBe(true);
      await expect(
        f.workspace.save(
          {
            ...p,
            commands: [
              { ...p.commands[0], note: "Different source review intent" },
            ],
          },
          f.actor,
          f.email,
        ),
      ).rejects.toThrow("different action");
      expect(
        await db.query(
          "SELECT count(*)::int n FROM commerce_promotion_draft_requests",
        ),
      ).toEqual([{ n: 1 }]);
    });
    it("two concurrent requests for the same pair/source revision cannot both mutate it", async () => {
      const p = await packet([await currentVerify()]),
        other = { ...p, requestId: randomUUID() };
      const results = await Promise.allSettled([
        f.workspace.save(p, f.actor, f.email),
        f.workspace.save(other, f.actor, f.email),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    });
    it("partial batch failure commits only valid items and reports exact persisted count", async () => {
      const p = await packet([await currentVerify(), verify(randomUUID(), 1)]),
        r = await f.workspace.save(p, f.actor, f.email);
      expect(r.status).toBe("partial");
      expect(r.results.map((x) => x.status)).toEqual(["applied", "failed"]);
      expect((await f.workspace.request(p.requestId, f.actor)).status).toBe(
        "partial",
      );
      expect(
        await db.query("SELECT count(*)::int n FROM competitor_match_reviews"),
      ).toEqual([{ n: 0 }]);
    });
    it("an all-failed request is retained as failed, never successful completion", async () => {
      const p = await packet([verify(randomUUID(), 1)]),
        r = await f.workspace.save(p, f.actor, f.email);
      expect(r.status).toBe("failed");
      expect(r.results[0].status).toBe("failed");
    });
    it("receipt storage failure rolls back native mutations and the action archive atomically", async () => {
      const p = await packet([await currentVerify()]),
        before = await db.query("SELECT * FROM competitor_prices WHERE id=$1", [
          f.pairs[0],
        ]),
        original = PostgresQueryRunner.prototype.query;
      const spy = jest
        .spyOn(PostgresQueryRunner.prototype, "query")
        .mockImplementation(async function (
          this: PostgresQueryRunner,
          sql: string,
          args?: unknown[],
          structured?: boolean,
        ) {
          if (sql.startsWith("INSERT INTO commerce_promotion_draft_requests"))
            throw Error("Synthetic receipt outage");
          return original.call(this, sql, args, structured);
        });
      try {
        await expect(f.workspace.save(p, f.actor, f.email)).rejects.toThrow(
          "storage unavailable",
        );
      } finally {
        spy.mockRestore();
      }
      expect(
        await db.query("SELECT * FROM competitor_prices WHERE id=$1", [
          f.pairs[0],
        ]),
      ).toEqual(before);
      expect(
        await db.query("SELECT count(*)::int n FROM commerce_promotion_drafts"),
      ).toEqual([{ n: 0 }]);
    });
    it("pack replacement preserves pair ID and original observation, and later verification cannot reinterpret its price", async () => {
      const w = await f.workspace.workspace(f.products[0].sku),
        p = await packet([
          {
            operation: "pack",
            pairId: f.pairs[0],
            revision: w.rows.find((r) => r.id === f.pairs[0])!.revision,
            pack: { unit: "kg", min: "2", max: "2", count: 1 },
          },
        ]);
      const r = await f.workspace.save(p, f.actor, f.email);
      expect(r.results[0].after.id).toBe(f.pairs[0]);
      expect(r.results[0].before.competitorWeightKg).toBe("1.0000");
      await f.workspace.save(
        await packet([await currentVerify()]),
        f.actor,
        f.email,
      );
      const after = await f.workspace.workspace(p.sku),
        row = after.rows.find((x) => x.id === f.pairs[0])!;
      expect(row.reasons).toContain("observation_pack_changed");
      expect(row.differencePercent).toBeNull();
      expect((row.observation.originalPack as { min: string }).min).toBe(
        "1.0000",
      );
    });
    it("legacy pack compatibility path replaces in-place with original dimensions archived atomically", async () => {
      const row = await db
        .getRepository(CompetitorPrice)
        .findOneByOrFail({ id: f.pairs[0] });
      await f.prices.replacePack(
        row.id,
        row.productId,
        { unit: "kg", min: 2, max: 2, packCount: 1 },
        row.revision,
        f.email,
      );
      expect(
        (
          await db
            .getRepository(CompetitorPrice)
            .findOneByOrFail({ id: row.id })
        ).priceIncVat,
      ).toBeNull();
      expect(
        (await f.workspace.workspace(f.products[0].sku)).rows.find(
          (r) => r.id === row.id,
        )?.reasons,
      ).toContain("observation_pack_changed");
      expect(
        await db.query(
          "SELECT count(*)::int n FROM commerce_promotion_drafts WHERE scenario->>'kind'='competitor_legacy_archive'",
        ),
      ).toEqual([{ n: 1 }]);
    });
    it.each(["uncertain", "substitute"] as const)(
      "persists %s matching decisions separately from price capture",
      async (relationship) => {
        const command = await currentVerify();
        await f.workspace.save(
          await packet([{ ...command, operation: "verify", relationship }]),
          f.actor,
          f.email,
        );
        const row = (await f.workspace.workspace(f.products[0].sku)).rows.find(
          (r) => r.id === f.pairs[0],
        )!;
        expect(row.eligible).toBe(false);
        expect(row.relationship).toBe(relationship);
      },
    );
    it.each([-7200000, 7200000])(
      "rejects older/future manual dates without changing the original observation (%d ms)",
      async (delta) => {
        const w = await f.workspace.workspace(f.products[0].sku),
          p = await packet([
            {
              operation: "capture",
              pairId: f.pairs[0],
              revision: w.rows.find((r) => r.id === f.pairs[0])!.revision,
              price: "100.00",
              currency: "THB",
              taxBasis: "inclusive",
              priceBasis: "public",
              observedAt: new Date(Date.now() + delta).toISOString(),
              context: "Synthetic observed date validation",
            },
          ]);
        expect((await f.workspace.save(p, f.actor, f.email)).status).toBe(
          "failed",
        );
        expect(
          (
            await db.query(
              "SELECT price_inc_vat::text price FROM competitor_prices WHERE id=$1",
              [f.pairs[0]],
            )
          )[0].price,
        ).toBe("100.00");
      },
    );
    it("source changes invalidate an already reviewed action fingerprint before any mutation", async () => {
      const p = await packet([await currentVerify()]);
      await db.query(
        "UPDATE scraping_sources SET config=jsonb_set(config,'{priceContext}','\"Changed synthetic terms\"') WHERE id=$1",
        [f.sources[0].id],
      );
      await expect(f.workspace.save(p, f.actor, f.email)).rejects.toThrow(
        "evidence changed",
      );
      expect(
        await db.query("SELECT count(*)::int n FROM commerce_promotion_drafts"),
      ).toEqual([{ n: 0 }]);
    });
    it("history and receipt ownership preserve provenance without exposing another account private request", async () => {
      const p = await packet([await currentVerify()]);
      await f.workspace.save(p, f.actor, f.email);
      expect((await f.workspace.history(f.pairs[0])).items[0].actorId).toBe(
        f.actor,
      );
      await expect(
        f.workspace.request(p.requestId, randomUUID()),
      ).rejects.toThrow("not found");
    });
    it("handoff returns current compatible identities and excludes member/foreign observations", async () => {
      const h = await f.workspace.handoff(f.products[0].sku);
      expect(h.eligibleIds.sort()).toEqual(f.pairs.slice(0, 2).sort());
      expect(h.activationAllowed).toBe(false);
      expect(h.sellingPriceWrites).toBe(false);
    });
    it("removed pair retains its original evidence in the immutable owner request", async () => {
      const w = await f.workspace.workspace(f.products[0].sku),
        p = await packet([
          {
            operation: "remove",
            pairId: f.pairs[0],
            revision: w.rows.find((r) => r.id === f.pairs[0])!.revision,
            note: "Duplicate URL deliberately removed after review",
          },
        ]);
      const r = await f.workspace.save(p, f.actor, f.email);
      expect(r.results[0].before.priceIncVat).toBe("100.00");
      expect(r.results[0].after).toBeNull();
      expect(
        await db.getRepository(CompetitorPrice).findOneBy({ id: f.pairs[0] }),
      ).toBeNull();
      expect(
        (await f.workspace.request(p.requestId, f.actor)).results[0].before.id,
      ).toBe(f.pairs[0]);
    });
    it("shared private storage keeps comparison requests out of promotion and pack receipt readers", async () => {
      const p = await packet([await currentVerify()]);
      await f.workspace.save(p, f.actor, f.email);
      const promotions = new PromotionDraftsService(db, {} as never),
        packs = new PackDraftsService(db, f.inputs);
      await expect(promotions.request(p.requestId, f.actor)).rejects.toThrow(
        "not found",
      );
      await expect(packs.request(p.requestId, f.actor)).rejects.toThrow(
        "not found",
      );
      expect((await promotions.list(f.actor)).items).toEqual([]);
      expect((await packs.list(f.actor)).items).toEqual([]);
    });
    it("new manual pairs without an observation or archive remain readable and excluded", async () => {
      const p = await packet([
        {
          operation: "create",
          sourceUrl: f.sources[0].origin + "/manual-no-price",
          sourceId: f.sources[0].id,
          catalogItemId: null,
          name: "Manual product without price",
          competitorSku: "",
          context: "Synthetic unknown public shelf price",
          pack: { unit: "kg", min: "1", max: "1", count: 1 },
        },
      ]);
      const result = await f.workspace.save(p, f.actor, f.email),
        w = await f.workspace.workspace(p.sku),
        row = w.rows.find((r) => r.id === result.results[0].pairId)!;
      expect(row.eligible).toBe(false);
      expect(row.observation.observedAt).toBeNull();
      expect(row.observation.priceIncVat).toBeNull();
      expect(row.relationship).toBe("uncertain");
    });
    it("strict extra fields and duplicate pair intents fail before any native mutation", async () => {
      const p = await packet([await currentVerify()]);
      await expect(
        f.workspace.save({ ...p, actor: "different" }, f.actor, f.email),
      ).rejects.toThrow("Invalid comparison");
      await expect(
        f.workspace.save(
          { ...p, commands: [p.commands[0], p.commands[0]] },
          f.actor,
          f.email,
        ),
      ).rejects.toThrow("Invalid comparison");
      expect(
        await db.query(
          "SELECT count(*)::int n FROM commerce_promotion_draft_requests",
        ),
      ).toEqual([{ n: 0 }]);
    });
    it("review markers persist independently of match verification and replay preserves their timestamp", async () => {
      const p = await packet([
        {
          operation: "review",
          note: "Reviewed available evidence and limitations",
        },
      ]);
      const first = await f.workspace.save(p, f.actor, f.email),
        again = await f.workspace.save(p, f.actor, f.email);
      expect(first.status).toBe("committed");
      expect(first.results[0].pairId).toBeNull();
      expect(again.results).toEqual(first.results);
      expect((await f.workspace.workspace(p.sku)).review?.by).toBe(f.email);
      expect(
        (await db.query("SELECT count(*)::int n FROM competitor_prices"))[0].n,
      ).toBe(4);
    });
    it("collection settings reject unsafe automatic collection and retain observation when edited identity is reverified", async () => {
      const w = await f.workspace.workspace(f.products[0].sku),
        r = w.rows[0];
      const first = await f.workspace.save(
        await packet([
          {
            operation: "settings",
            pairId: r.id,
            revision: r.revision,
            name: String(r.observation.productName) + " revised",
            competitorSku: r.competitorSku,
            context: r.context,
            collectionAllowed: true,
            autoRefresh: false,
          },
        ]),
        f.actor,
        f.email,
      );
      expect(first.results[0].after.priceIncVat).toBeNull();
      const changed = await f.workspace.workspace(w.sku);
      await f.workspace.save(
        await packet([
          {
            operation: "verify",
            pairId: r.id,
            revision: changed.rows.find((x) => x.id === r.id)!.revision,
            relationship: "same_product",
            note: "Reviewed synthetic edited identity",
          },
        ]),
        f.actor,
        f.email,
      );
      expect(
        (await f.workspace.workspace(w.sku)).rows.find((x) => x.id === r.id)
          ?.reasons,
      ).toContain("observation_identity_changed");
      const current = await f.workspace.workspace(w.sku),
        row = current.rows.find((x) => x.id === r.id)!;
      expect(
        (
          await f.workspace.save(
            await packet([
              {
                operation: "settings",
                pairId: row.id,
                revision: row.revision,
                name: String(row.observation.productName),
                competitorSku: row.competitorSku,
                context: row.context,
                collectionAllowed: false,
                autoRefresh: true,
              },
            ]),
            f.actor,
            f.email,
          )
        ).status,
      ).toBe("failed");
    });
    it.each(["success", "read-failure", "identity-failure"] as const)(
      "native collection archives actual %s, with original request replay fetching at most once",
      async (mode) => {
        const w = await f.workspace.workspace(f.products[0].sku),
          row = w.rows.find((x) => x.id === f.pairs[0])!;
        const spy = jest.spyOn(f.scraping, "readProduct");
        if (mode === "read-failure")
          spy.mockRejectedValue(Error("Synthetic vendor outage"));
        else
          spy.mockResolvedValue({
            name:
              mode === "identity-failure"
                ? "Different product"
                : String(row.observation.productName),
            sku: row.competitorSku,
            url: row.url,
            pageUrl: row.url,
            weightKg: 1,
            price: 99,
            currency: "THB",
            observedAt: new Date(),
            fields: { availability: "InStock" },
          } as Awaited<ReturnType<typeof f.scraping.readProduct>>);
        try {
          const p = await packet([
              { operation: "refresh", pairId: row.id, revision: row.revision },
            ]),
            saved = await f.workspace.save(p, f.actor, f.email),
            replayed = await f.workspace.save(p, f.actor, f.email);
          expect(spy).toHaveBeenCalledTimes(1);
          expect(replayed.results).toEqual(saved.results);
          expect(saved.status).toBe(
            mode === "success" ? "committed" : "failed",
          );
          expect(
            (
              await db.query(
                "SELECT price_inc_vat::text p FROM competitor_prices WHERE id=$1",
                [row.id],
              )
            )[0].p,
          ).toBe(mode === "success" ? "99.00" : "100.00");
          expect((await f.workspace.history(row.id)).items).toHaveLength(1);
          if (mode !== "success")
            expect(
              (await f.workspace.workspace(w.sku)).rows.find(
                (x) => x.id === row.id,
              )?.eligible,
            ).toBe(false);
        } finally {
          spy.mockRestore();
        }
      },
    );

    const reassignment = (
      w: Awaited<ReturnType<typeof f.workspace.workspace>>,
    ): Extract<ComparisonCommand, { operation: "reassign" }> => ({
      operation: "reassign",
      pairId: f.pairs[0],
      revision: w.rows.find((r) => r.id === f.pairs[0])!.revision,
      sourceUrl: f.sources[1].origin + "/p/reassigned-chicken",
      sourceId: f.sources[1].id,
      name: "Reviewed alternate chicken",
      competitorSku: "ALT-CHICKEN",
      context: "Reviewed public terms from alternate source",
      note: "Reviewed source change and original historical quotation",
    });
    it("reassigns only this pair, retaining raw quote while clearing price/match and collection", async () => {
      const w = await f.workspace.workspace(f.products[0].sku),
        c = reassignment(w),
        reader = jest.spyOn(f.scraping, "readProduct");
      const result = await f.workspace.save(
        await packet([c]),
        f.actor,
        f.email,
      );
      expect(result.status).toBe("committed");
      expect(reader).not.toHaveBeenCalled();
      reader.mockRestore();
      const row = await db
        .getRepository(CompetitorPrice)
        .findOneByOrFail({ id: c.pairId });
      expect(row).toMatchObject({
        productId: f.products[0].id,
        sourceUrl: c.sourceUrl,
        scrapingSourceId: c.sourceId,
        priceIncVat: null,
        verifiedFingerprint: null,
        vatIncluded: false,
        collectionAllowed: false,
        autoRefresh: false,
      });
      expect(row.revision).toBe(c.revision + 1);
      expect(row.observedAt).not.toBeNull();
      expect(result.results[0].before?.observation).toMatchObject({
        url: w.rows.find((r) => r.id === c.pairId)!.url,
        price: "100.00",
      });
      expect(result.results[0].after?.observation).toMatchObject(
        result.results[0].before?.observation as object,
      );
      expect(result.results[0].after?.observation).toMatchObject({
        sourceChanged: true,
      });
      const next = await f.workspace.workspace(w.sku),
        changed = next.rows.find((r) => r.id === c.pairId)!;
      expect(changed.rawEvidence?.url).toBe(
        w.rows.find((r) => r.id === c.pairId)!.url,
      );
      expect(changed.reasons).toContain("observation_identity_changed");
      expect(changed.eligible).toBe(false);
      expect(next.review).toBeNull();
      expect((await f.workspace.history(c.pairId)).items).toHaveLength(1);
    });
    it("cannot reinterpret an old quote after verifying the new source identity", async () => {
      const w = await f.workspace.workspace(f.products[0].sku);
      await f.workspace.save(await packet([reassignment(w)]), f.actor, f.email);
      await f.workspace.save(
        await packet([await currentVerify()]),
        f.actor,
        f.email,
      );
      const row = (await f.workspace.workspace(w.sku)).rows.find(
        (r) => r.id === f.pairs[0],
      )!;
      expect(row.reasons).toContain("observation_identity_changed");
      expect(row.eligible).toBe(false);
      expect(
        (
          await db
            .getRepository(CompetitorPrice)
            .findOneByOrFail({ id: row.id })
        ).priceIncVat,
      ).toBeNull();
      await f.workspace.save(
        await packet([
          {
            operation: "capture",
            pairId: row.id,
            revision: row.revision,
            price: "120.00",
            currency: "THB",
            taxBasis: "inclusive",
            priceBasis: "public",
            observedAt: new Date().toISOString(),
            context: "Reviewed public terms from alternate source",
          },
        ]),
        f.actor,
        f.email,
      );
      await f.workspace.save(
        await packet([await currentVerify()]),
        f.actor,
        f.email,
      );
      expect(
        (await f.workspace.workspace(w.sku)).rows.find((r) => r.id === row.id),
      ).toMatchObject({
        eligible: true,
        rawEvidence: {
          url: f.sources[1].origin + "/p/reassigned-chicken",
          price: "120.00",
        },
      });
    });
    it("replays concurrent source change requests once without another revision or source read", async () => {
      const w = await f.workspace.workspace(f.products[0].sku),
        p = await packet([reassignment(w)]);
      const results = await Promise.all([
        f.workspace.save(p, f.actor, f.email),
        f.workspace.save(p, f.actor, f.email),
      ]);
      expect(results[0].requestId).toBe(results[1].requestId);
      expect(results.filter((r) => r.replayed)).toHaveLength(1);
      expect(
        (
          await db
            .getRepository(CompetitorPrice)
            .findOneByOrFail({ id: f.pairs[0] })
        ).revision,
      ).toBe(
        p.commands[0].operation === "reassign" ? p.commands[0].revision + 1 : 0,
      );
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM commerce_promotion_draft_requests",
          )
        )[0].n,
      ).toBe(1);
    });
    it("blocks a stale source-change review without native changes or a success receipt", async () => {
      const w = await f.workspace.workspace(f.products[0].sku),
        p = await packet([reassignment(w)]);
      await db
        .getRepository(CompetitorPrice)
        .update(f.pairs[0], { competitorName: "Concurrent edit" });
      await expect(f.workspace.save(p, f.actor, f.email)).rejects.toThrow(
        "changed",
      );
      expect(
        (
          await db
            .getRepository(CompetitorPrice)
            .findOneByOrFail({ id: f.pairs[0] })
        ).sourceUrl,
      ).toBe(w.rows.find((r) => r.id === f.pairs[0])!.url);
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM commerce_promotion_draft_requests",
          )
        )[0].n,
      ).toBe(0);
    });
    it("records failed outcomes for unsafe, unchanged, wrong-source or already-paired URLs without modifying native pair", async () => {
      const w = await f.workspace.workspace(f.products[0].sku),
        c = reassignment(w),
        before = await db
          .getRepository(CompetitorPrice)
          .findOneByOrFail({ id: f.pairs[0] });
      for (const values of [
        { sourceUrl: "http://vendor-2.example.invalid/p/other" },
        { sourceUrl: "https://127.0.0.1/p/other", sourceId: null },
        { sourceId: f.sources[0].id },
        { sourceUrl: before.sourceUrl, sourceId: before.scrapingSourceId },
        { sourceUrl: f.sources[1].origin + "/p/chicken" },
      ]) {
        const result = await f.workspace.save(
          await packet([{ ...c, ...values }]),
          f.actor,
          f.email,
        );
        expect(result.status).toBe("failed");
        expect(result.results[0].status).toBe("failed");
        expect(
          await db
            .getRepository(CompetitorPrice)
            .findOneByOrFail({ id: f.pairs[0] }),
        ).toEqual(before);
      }
    });
    it("persists mixed batch outcomes and never counts a failed pair or marks the SKU reviewed", async () => {
      const p = await packet([
        await currentVerify(),
        {
          operation: "remove",
          pairId: randomUUID(),
          revision: 1,
          note: "Explicitly reviewed synthetic missing pair",
        },
      ]);
      const receipt = await f.workspace.save(p, f.actor, f.email);
      expect(receipt.status).toBe("partial");
      expect(receipt.results.map((r) => r.status)).toEqual([
        "applied",
        "failed",
      ]);
      expect((await f.workspace.workspace(p.sku)).review).toBeNull();
      expect(await f.workspace.save(p, f.actor, f.email)).toMatchObject({
        requestId: p.requestId,
        replayed: true,
        status: "partial",
      });
      expect(await f.workspace.request(p.requestId, f.actor)).toMatchObject({
        status: "partial",
        persisted: true,
      });
      await expect(
        f.workspace.request(p.requestId, "other-owner"),
      ).rejects.toThrow("not found");
      expect((await f.workspace.history(f.pairs[0])).items).toHaveLength(1);
    });

    it("keeps a quotation historical after a URL roundtrip until an actual new capture", async () => {
      const w = await f.workspace.workspace(f.products[0].sku),
        original = w.rows.find((r) => r.id === f.pairs[0])!;
      await f.workspace.save(await packet([reassignment(w)]), f.actor, f.email);
      const current = await f.workspace.workspace(w.sku);
      await f.workspace.save(
        await packet([
          {
            ...reassignment(current),
            sourceUrl: original.url,
            sourceId: original.sourceId,
            name: String(original.observation.productName),
            competitorSku: original.competitorSku,
            context: original.context,
          },
        ]),
        f.actor,
        f.email,
      );
      await f.workspace.save(
        await packet([await currentVerify()]),
        f.actor,
        f.email,
      );
      const returned = (await f.workspace.workspace(w.sku)).rows.find(
        (r) => r.id === original.id,
      )!;
      expect(returned.url).toBe(original.url);
      expect(returned.rawEvidence?.url).toBe(original.url);
      expect(returned.reasons).toContain("observation_identity_changed");
      expect(returned.eligible).toBe(false);
      expect(returned.rawEvidence).toMatchObject({ sourceChanged: true });
    });
  },
);
