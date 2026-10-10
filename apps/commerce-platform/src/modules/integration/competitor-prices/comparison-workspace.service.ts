import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { createHash, randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { ScrapingService } from "../../platform/scraping/application/scraping.service";
import {
  publicUrl,
  scrapingVersion,
} from "../../platform/scraping/infrastructure/public-web.reader";
import { PackInputsService } from "../pack-price-planning/pack-inputs.service";
import { inspectObservation } from "../pack-price-planning/pack-price";
import {
  CompetitorMatchReview,
  CompetitorPrice,
} from "./competitor-price.entity";
import { itemPackSize } from "./competitor-size";
import {
  catalogFingerprint,
  competitorSource,
  CompetitorPricesService,
} from "./competitor-prices.service";
import {
  comparisonPacketSchema,
  comparisonRows,
  comparisonWorkspaceSchema,
  normalizedComparisonPack,
  verifyComparisonReceipt,
  type ComparisonCommand,
  type ComparisonPacket,
  type ComparisonReceipt,
} from "./comparison-contracts";

type Snapshot = Record<string, unknown>;
const copy = (v: unknown): Snapshot => JSON.parse(JSON.stringify(v));
const relation = (note: string) =>
  note.startsWith("Substitute: ")
    ? "substitute"
    : note.startsWith("Uncertain: ")
      ? "uncertain"
      : "same_product";
const packKey = (raw: unknown) => {
  try {
    const p = raw as { unit: string; min: string; max: string; count: number };
    return JSON.stringify(normalizedComparisonPack(p));
  } catch {
    return null;
  }
};
@Injectable()
export class ComparisonWorkspaceService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly competitors: CompetitorPricesService,
    private readonly inputs: PackInputsService,
    private readonly scraping: ScrapingService,
  ) {}
  private async available<T>(run: () => Promise<T>) {
    try {
      return await run();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException(
        "Comparison storage unavailable. Check the original request before retrying.",
      );
    }
  }
  private async rawObservation(
    pair: CompetitorPrice,
    m: EntityManager = this.db.manager,
  ): Promise<Snapshot | null> {
    const [row] = await m.query(
      `SELECT r->'after'->'observation' AS observation FROM commerce_promotion_drafts d CROSS JOIN LATERAL jsonb_array_elements(d.preview->'results') r
      WHERE d.scenario->>'kind'='competitor_action' AND r->>'pairId'=$1 AND r->>'status'='applied' AND r->'after'->'observation' IS NOT NULL ORDER BY d.created_at DESC,d.id DESC LIMIT 1`,
      [pair.id],
    );
    let value = row?.observation;
    if (!value) {
      const [legacy] = await m.query(
        "SELECT evidence FROM commerce_promotion_drafts WHERE scenario->>'kind'='competitor_legacy_archive' AND scenario->>'pairId'=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
        [pair.id],
      );
      const previous = legacy?.evidence;
      if (
        previous &&
        pair.observedAt &&
        previous.observedAt === pair.observedAt.toISOString()
      )
        value = {
          price:
            previous.priceIncVat == null ? null : String(previous.priceIncVat),
          currency: previous.captureMethod === "manual" ? "THB" : null,
          taxBasis: previous.vatIncluded ? "inclusive" : "unverified",
          priceBasis: "public",
          observedAt: previous.observedAt,
          context: previous.sourceContext,
          capturedBy: null,
          pack: {
            unit: previous.competitorUnit,
            min: String(
              previous.competitorQtyMin ?? previous.competitorWeightKg,
            ),
            max: String(
              previous.competitorQtyMax ??
                previous.competitorQtyMin ??
                previous.competitorWeightKg,
            ),
            count:
              previous.competitorQtyMin == null
                ? 1
                : previous.competitorPackCount,
          },
        };
    }
    // An existing legacy API may have subsequently captured a newer observation. Never overwrite it with an older journal.
    return value &&
      pair.observedAt &&
      value.observedAt === pair.observedAt.toISOString()
      ? value
      : null;
  }
  async workspace(sku: string) {
    return this.available(async () => {
      const [inputs, pairs] = await Promise.all([
        this.inputs.inputs(sku),
        this.competitors.list(sku),
      ]);
      const relevant = pairs.filter(
        (p) => p.ourProduct.id === inputs.product.id,
      );
      const stored = await this.db
        .getRepository(CompetitorPrice)
        .find({ where: { productId: inputs.product.id } });
      const metadata = await Promise.all(
        relevant.map(async (p) => {
          const row = stored.find((x) => x.id === p.id);
          if (
            !row ||
            row.revision !== p.revision ||
            inputs.observations.find((o) => o.id === p.id)?.revision !==
              p.revision
          )
            throw new ConflictException(
              "Comparison changed during read. Refresh.",
            );
          const observation = await this.rawObservation(row);
          const pack = {
            unit: p.planningEvidence.unit,
            min: p.planningEvidence.min,
            max: p.planningEvidence.max,
            count: p.planningEvidence.count,
          };
          return {
            id: p.id,
            sourceId: row.scrapingSourceId,
            sourceName: p.sourceName,
            sourceUrl: p.sourceUrl,
            context: p.sourceContext,
            ourProductVersion: p.ourProductVersion,
            relationship: relation(p.matchNote),
            observation,
            identityChanged:
              !!observation &&
              (observation.sourceChanged === true ||
                (typeof observation.name === "string" &&
                  observation.name !== row.competitorName) ||
                (typeof observation.competitorSku === "string" &&
                  observation.competitorSku !== row.competitorSku) ||
                (typeof observation.url === "string" &&
                  observation.url !== row.sourceUrl) ||
                (typeof observation.context === "string" &&
                  observation.context !== row.sourceContext)),
            packChanged:
              !!observation && packKey(observation.pack) !== packKey(pack),
          };
        }),
      );
      const rows = comparisonRows(inputs, metadata).map((r) => {
        const p = relevant.find((p) => p.id === r.id)!;
        return {
          ...r,
          competitorSku: p.competitorSku,
          collectionAllowed: p.collectionAllowed,
          autoRefresh: p.autoRefresh,
          canRefresh: p.canRefresh,
          refreshReason: p.refreshReason,
        };
      });
      const review = await this.db
        .getRepository(CompetitorMatchReview)
        .findOneBy({ productId: inputs.product.id });
      // Receipt metadata affects eligibility too, so bind action review to it as well as the native source evidence.
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ native: inputs.sourceFingerprint, rows }))
        .digest("hex");
      inputs.sourceFingerprint = fingerprint;
      return comparisonWorkspaceSchema.parse({
        sku: inputs.sku,
        inputs,
        rows,
        sourceFingerprint: fingerprint,
        capturedAt: inputs.capturedAt,
        observationsTruncated: inputs.observationsTruncated,
        upstreamFreshness: "unverified",
        review: review
          ? { at: review.reviewedAt.toISOString(), by: review.reviewedBy }
          : null,
      });
    });
  }
  async sources() {
    return (await this.scraping.listSources()).map((s) => ({
      id: s.id,
      name: s.name,
      origin: s.origin,
      currency: s.config.currency,
      taxIncluded: s.config.vatIncluded,
      sourceVersion: scrapingVersion(s.config),
      enabled: s.enabled,
    }));
  }
  async candidates(sku: string) {
    await this.competitors.product(sku, true);
    const result = await this.competitors.siteCandidates(sku, true);
    return {
      sku,
      sites: result.sites.map((s) => ({
        sourceId: s.sourceId,
        sourceName: s.sourceName,
        candidates: s.candidates.map((c) => ({
          id: c.id,
          name: c.name,
          url: c.url,
          weightKg: c.weightKg,
          priceIncVat: c.priceIncVat,
          image: c.image,
          similarityPercent: c.similarityPercent,
        })),
      })),
    };
  }
  async item(id: string) {
    const item = await this.scraping.item(id);
    return {
      id: item.id,
      sourceId: item.sourceId,
      url: item.url,
      name: item.name,
      sku: item.sku,
      context: item.source.config.priceContext,
      configCurrent: item.configCurrent,
      observedAt: item.observedAt.toISOString(),
      currency: item.currency,
      taxIncluded: item.source.config.vatIncluded,
    };
  }
  async handoff(sku: string) {
    const workspace = await this.workspace(sku),
      packInputs = await this.inputs.inputs(sku);
    const eligibleIds = workspace.rows
      .filter(
        (r) =>
          r.eligible &&
          packInputs.observations.some(
            (o) =>
              o.id === r.id &&
              o.revision === r.revision &&
              inspectObservation(o, packInputs).eligible,
          ),
      )
      .map((r) => r.id);
    return {
      sku,
      sourceFingerprint: workspace.sourceFingerprint,
      packSourceFingerprint: packInputs.sourceFingerprint,
      eligibleIds,
      productName: workspace.inputs.product.name,
      capturedAt: workspace.capturedAt,
      activationAllowed: false,
      sellingPriceWrites: false,
    };
  }
  async history(pairId: string) {
    return this.available(async () => {
      const pair = await this.db
        .getRepository(CompetitorPrice)
        .findOneBy({ id: pairId });
      if (!pair) throw new NotFoundException("Pair unavailable");
      const records = await this.db.query(
        `SELECT d.id,d.actor_id,d.created_at,r FROM commerce_promotion_drafts d CROSS JOIN LATERAL jsonb_array_elements(d.preview->'results') r
      WHERE d.scenario->>'kind'='competitor_action' AND r->>'pairId'=$1 AND (r->>'status'='applied' OR r->'after' IS NOT NULL AND r->'after'<>'null'::jsonb) ORDER BY d.created_at DESC,d.id DESC LIMIT 21`,
        [pairId],
      );
      return {
        pairId,
        items: records.slice(0, 20).map((x) => ({
          id: x.id,
          actorId: x.actor_id,
          at: x.created_at.toISOString(),
          before: x.r.before,
          after: x.r.after,
        })),
        hasMore: records.length > 20,
        legacyHistory: "unavailable",
      };
    });
  }
  async request(requestId: string, actor: string) {
    return this.available(async () => {
      const [row] = await this.db.query(
        "SELECT receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND request_id=$2 AND receipt->>'kind'='competitor_action'",
        [actor, requestId],
      );
      if (!row)
        throw new NotFoundException("Committed comparison request not found");
      return verifyComparisonReceipt(row.receipt);
    });
  }
  async save(raw: unknown, actor: string, email: string) {
    const parsed = comparisonPacketSchema.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException(
        "Invalid comparison action or unsupported pack/price basis",
      );
    const packet = parsed.data;
    if (!actor || actor.length > 128 || !email)
      throw new BadRequestException("Staff identity unavailable");
    const hash = createHash("sha256")
      .update(JSON.stringify(packet))
      .digest("hex");
    return this.available(() =>
      this.db.transaction(async (m) => {
        await m.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `promotion-draft:${actor}:${packet.requestId}`,
        ]);
        const [previous] = await m.query(
          "SELECT request_hash,receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND request_id=$2",
          [actor, packet.requestId],
        );
        if (previous) {
          if (previous.request_hash !== hash)
            throw new ConflictException(
              "Request ID belongs to a different action",
            );
          return {
            ...verifyComparisonReceipt(previous.receipt, packet),
            replayed: true,
          };
        }
        // Fetch before row locks. An immutable receipt replay never fetches the vendor again.
        const fetched = new Map<
          string,
          Awaited<ReturnType<ScrapingService["readProduct"]>> | Error
        >();
        for (const c of packet.commands)
          if (c.operation === "refresh") {
            const state = (await this.competitors.list(packet.sku)).find(
              (p) => p.id === c.pairId,
            );
            if (!state || state.revision !== c.revision || !state.canRefresh) {
              fetched.set(
                c.pairId,
                new Error(
                  state?.refreshReason ||
                    "Current refresh eligibility is unavailable",
                ),
              );
              continue;
            }
            const pair = await this.db.getRepository(CompetitorPrice).findOne({
              where: { id: c.pairId },
              relations: { scrapingSource: true },
            });
            try {
              fetched.set(
                c.pairId,
                await this.scraping.readProduct(
                  pair!.scrapingSource!,
                  state.sourceUrl,
                ),
              );
            } catch {
              fetched.set(
                c.pairId,
                new Error(
                  "Vendor read failed. Original price remains retained.",
                ),
              );
            }
          }
        let product = await this.competitors.product(packet.sku, true);
        await m.query(
          "SELECT id FROM josh_catalog_products WHERE id=$1 FOR SHARE",
          [product.product_inventory_id],
        );
        product = await this.competitors.product(packet.sku, true);
        await m.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `competitor-product:${product.product_inventory_id}`,
        ]);
        await m.query(
          "SELECT id FROM competitor_prices WHERE product_id=$1 ORDER BY id FOR UPDATE",
          [product.product_inventory_id],
        );
        const extraSources = packet.commands.flatMap((c) =>
          (c.operation === "create" || c.operation === "reassign") && c.sourceId
            ? [c.sourceId]
            : [],
        );
        await m.query(
          "SELECT id FROM scraping_sources WHERE id IN (SELECT scraping_source_id FROM competitor_prices WHERE product_id=$1) OR id=ANY($2::uuid[]) ORDER BY id FOR SHARE",
          [product.product_inventory_id, extraSources],
        );
        const current = await this.workspace(packet.sku);
        if (current.sourceFingerprint !== packet.sourceFingerprint)
          throw new ConflictException(
            "Comparison evidence changed. Review current evidence before a new request.",
          );
        const results: ComparisonReceipt["results"] = [];
        for (let index = 0; index < packet.commands.length; index++) {
          const command = packet.commands[index];
          await m.query("SAVEPOINT comparison_item");
          try {
            const result = await this.apply(
              command,
              packet,
              m,
              actor,
              email,
              product,
              current,
              fetched,
            );
            results.push({ index, status: "applied", message: "", ...result });
            await m.query("RELEASE SAVEPOINT comparison_item");
          } catch (e) {
            await m.query("ROLLBACK TO SAVEPOINT comparison_item");
            await m.query("RELEASE SAVEPOINT comparison_item");
            if (
              !(e instanceof HttpException) &&
              !["23505", "23514"].includes(
                String((e as { code?: string }).code),
              )
            )
              throw e;
            results.push({
              index,
              pairId: "pairId" in command ? command.pairId : null,
              status: "failed",
              message:
                e instanceof HttpException
                  ? e.message
                  : "The pair conflicts with an existing record or a supported storage constraint.",
              before: null,
              after: null,
            });
          }
        }
        const applied = results.filter((x) => x.status === "applied").length,
          id = randomUUID();
        const receipt = verifyComparisonReceipt({
          kind: "competitor_action",
          id,
          requestId: packet.requestId,
          packet,
          status:
            applied === results.length
              ? "committed"
              : applied
                ? "partial"
                : "failed",
          persisted: true,
          sellingPriceWrites: false,
          activationAllowed: false,
          savedAt: new Date().toISOString(),
          results,
        });
        await m.query(
          `INSERT INTO commerce_promotion_drafts(id,actor_id,revision,scenario,evidence,preview) VALUES($1,$2,1,$3,$4,$5)`,
          [
            id,
            actor,
            JSON.stringify({
              kind: "competitor_action",
              sku: packet.sku,
              packet,
            }),
            JSON.stringify({
              sourceFingerprint: current.sourceFingerprint,
              capturedAt: current.capturedAt,
            }),
            JSON.stringify(receipt),
          ],
        );
        await m.query(
          "INSERT INTO commerce_promotion_draft_requests(actor_id,request_id,request_hash,draft_id,receipt) VALUES($1,$2,$3,$4,$5)",
          [actor, packet.requestId, hash, id, JSON.stringify(receipt)],
        );
        return { ...receipt, replayed: false };
      }),
    );
  }
  private async apply(
    command: ComparisonCommand,
    packet: ComparisonPacket,
    m: EntityManager,
    actor: string,
    email: string,
    product: Awaited<ReturnType<CompetitorPricesService["product"]>>,
    current: Awaited<ReturnType<ComparisonWorkspaceService["workspace"]>>,
    fetched: Map<
      string,
      Awaited<ReturnType<ScrapingService["readProduct"]>> | Error
    >,
  ) {
    const repository = m.getRepository(CompetitorPrice);
    if (command.operation === "review") {
      const reviews = m.getRepository(CompetitorMatchReview);
      const before = await reviews.findOneBy({
        productId: product.product_inventory_id,
      });
      await reviews.upsert(
        {
          productId: product.product_inventory_id,
          reviewedBy: email,
          reviewedAt: new Date(),
        },
        ["productId"],
      );
      return {
        pairId: null,
        before: before ? copy(before) : null,
        after: copy(
          await reviews.findOneByOrFail({
            productId: product.product_inventory_id,
          }),
        ),
      };
    }
    let row: CompetitorPrice,
      before: Snapshot | null = null,
      observation: Snapshot | null = null;
    if (command.operation === "create") {
      const url = publicUrl(command.sourceUrl).href,
        source = await this.scraping.findOrigin(url);
      if (!source) competitorSource(url);
      if ((source?.id ?? null) !== command.sourceId)
        throw new ConflictException(
          "Source identity changed. Select the current source.",
        );
      if (source)
        await m.query("SELECT id FROM scraping_sources WHERE id=$1 FOR SHARE", [
          source.id,
        ]);
      const size = normalizedComparisonPack(command.pack);
      const item = command.catalogItemId
        ? await this.scraping.item(command.catalogItemId)
        : null;
      if (
        item &&
        (!item.configCurrent ||
          item.url !== url ||
          item.sourceId !== command.sourceId ||
          item.name !== command.name ||
          item.sku !== command.competitorSku ||
          item.source.config.priceContext !== command.context)
      )
        throw new ConflictException(
          "Collected product evidence changed. Select it again.",
        );
      row = repository.create({
        productId: product.product_inventory_id,
        ourWeightKg: 1,
        sourceUrl: url,
        scrapingSourceId: source?.id ?? null,
        competitorName: command.name,
        competitorSku: command.competitorSku,
        competitorWeightKg: Number(size.min) * size.count,
        competitorUnit: size.unit as "kg" | "l" | "piece",
        competitorQtyMin: Number(size.min),
        competitorQtyMax: Number(size.max),
        competitorPackCount: size.count,
        sourceContext: command.context,
        vatIncluded: item?.source.config.vatIncluded ?? false,
        collectionAllowed: source?.config.collectionAllowed ?? false,
        autoRefresh: false,
        verifiedFingerprint: null,
        verifiedAt: null,
        verifiedBy: null,
        matchNote: "Uncertain: Product match needs a separate human review.",
        priceIncVat:
          item?.currency === "THB" && item.source.config.vatIncluded
            ? item.priceIncVat
            : null,
        observedAt: item?.observedAt ?? null,
        captureMethod: item ? "automatic" : null,
        capturedSourceVersion: item?.configVersion ?? null,
        lastError: null,
      });
      if (item) {
        const pack = itemPackSize(item.name, item.weightKg);
        observation = {
          price: item.priceIncVat == null ? null : String(item.priceIncVat),
          currency: item.currency,
          taxBasis: item.source.config.vatIncluded ? "inclusive" : "unverified",
          priceBasis: source?.loginUsername ? "member" : "public",
          observedAt: item.observedAt.toISOString(),
          context: item.source.config.priceContext,
          name: row.competitorName,
          competitorSku: row.competitorSku,
          url: row.sourceUrl,
          capturedBy: actor,
          pack: pack
            ? {
                unit: pack.unit,
                min: String(pack.min),
                max: String(pack.max),
                count: pack.packCount,
              }
            : { unit: null, min: null, max: null, count: 1 },
        };
      }
    } else {
      const found = await repository.findOneBy({ id: command.pairId });
      if (!found || found.productId !== product.product_inventory_id)
        throw new NotFoundException("Pair not found for this product");
      row = found;
      if (row.revision !== command.revision)
        throw new ConflictException(
          "Pair revision changed. Review current data.",
        );
      observation = await this.rawObservation(row, m);
      if (!observation && row.observedAt) {
        const original = current.inputs.observations.find(
          (o) => o.id === row.id,
        );
        if (original)
          observation = {
            price: original.priceIncVat,
            currency: original.currency,
            taxBasis: original.taxBasis,
            priceBasis: original.priceBasis,
            observedAt: row.observedAt.toISOString(),
            context: row.sourceContext,
            name: row.competitorName,
            competitorSku: row.competitorSku,
            url: row.sourceUrl,
            capturedBy: null,
            pack: original.originalPack,
          };
      }
      before = { ...copy(row), observation };
      if (command.operation === "reassign") {
        // Same public URL/source resolution as the retained legacy update API;
        // change only this pair, with its native revision and original quote archived.
        const url = publicUrl(command.sourceUrl).href,
          source = await this.scraping.findOrigin(url);
        if (!source) competitorSource(url);
        if ((source?.id ?? null) !== command.sourceId)
          throw new ConflictException(
            "Source identity changed. Select the current source.",
          );
        if (url === row.sourceUrl && command.sourceId === row.scrapingSourceId)
          throw new BadRequestException(
            "Choose a different product URL or source.",
          );
        row.sourceUrl = url;
        row.scrapingSourceId = command.sourceId;
        row.competitorName = command.name;
        row.competitorSku = command.competitorSku;
        row.sourceContext = command.context;
        row.priceIncVat = null;
        row.capturedSourceVersion = null;
        row.verifiedFingerprint = null;
        row.verifiedAt = null;
        row.verifiedBy = null;
        row.matchNote = "Uncertain: Source changed. " + command.note;
        row.vatIncluded = false;
        row.collectionAllowed = false;
        row.autoRefresh = false;
        row.lastError = null;
        if (observation) observation = { ...observation, sourceChanged: true };
        // Retain original observedAt and immutable raw observation, so it is shown
        // as historical evidence and excluded by identity until a new capture.
      } else if (command.operation === "settings") {
        if (
          command.autoRefresh &&
          (!command.collectionAllowed || !row.vatIncluded)
        )
          throw new BadRequestException(
            "Automatic collection requires permission and a VAT-inclusive price basis",
          );
        if (
          row.competitorName !== command.name ||
          row.competitorSku !== command.competitorSku ||
          row.sourceContext !== command.context
        ) {
          row.priceIncVat = null;
          row.verifiedFingerprint = null;
          row.verifiedAt = null;
          row.verifiedBy = null;
          row.matchNote =
            "Uncertain: Product identity or price context changed. Review separately.";
        }
        row.competitorName = command.name;
        row.competitorSku = command.competitorSku;
        row.sourceContext = command.context;
        row.collectionAllowed = command.collectionAllowed;
        row.autoRefresh = command.autoRefresh;
      } else if (command.operation === "refresh") {
        const state = (await this.competitors.list(packet.sku)).find(
          (p) => p.id === row.id,
        )!;
        const value = fetched.get(row.id);
        if (!state.canRefresh)
          throw new BadRequestException(state.refreshReason);
        let failure =
          value instanceof Error
            ? value.message
            : !value
              ? "Vendor evidence unavailable"
              : "";
        if (value && !(value instanceof Error)) {
          const identity =
            value.name.trim() === row.competitorName &&
            value.url === row.sourceUrl &&
            (!row.competitorSku || value.sku === row.competitorSku) &&
            value.weightKg != null &&
            Math.abs(value.weightKg - Number(row.competitorWeightKg)) <=
              0.00005;
          const available =
            /^(?:https?:\/\/schema.org\/)?(?:InStock|in stock|พร้อมขาย|มีสินค้า)$/i.test(
              value.fields.availability?.trim() || "",
            );
          if (!identity) {
            failure =
              "Vendor product identity changed. Original observation retained; match needs review.";
            row.verifiedFingerprint = null;
            row.verifiedAt = null;
            row.verifiedBy = null;
          } else if (
            value.price == null ||
            !Number.isFinite(value.price) ||
            value.price <= 0 ||
            value.price > 9999999999.99 ||
            value.currency !== "THB" ||
            !available ||
            !Number.isFinite(value.observedAt.getTime()) ||
            value.observedAt.getTime() > Date.now() + 300000 ||
            Date.now() - value.observedAt.getTime() > 86400000 ||
            (row.observedAt && value.observedAt < row.observedAt)
          )
            failure =
              "Vendor price, currency, date or availability is unsupported. Original observation retained.";
          else {
            const source = await this.scraping.findOrigin(row.sourceUrl);
            if (!source || source.id !== row.scrapingSourceId)
              throw new ConflictException("Source identity changed");
            row.priceIncVat = value.price;
            row.observedAt = value.observedAt;
            row.captureMethod = "automatic";
            row.capturedSourceVersion = scrapingVersion(source.config);
            row.lastError = null;
            observation = {
              price: String(value.price),
              currency: value.currency,
              taxBasis: "inclusive",
              priceBasis: current.inputs.observations.find(
                (o) => o.id === row.id,
              )!.priceBasis,
              observedAt: value.observedAt.toISOString(),
              context: row.sourceContext,
              name: row.competitorName,
              competitorSku: row.competitorSku,
              url: row.sourceUrl,
              capturedBy: actor,
              pack: {
                unit: row.competitorUnit,
                min: String(row.competitorQtyMin ?? row.competitorWeightKg),
                max: String(
                  row.competitorQtyMax ??
                    row.competitorQtyMin ??
                    row.competitorWeightKg,
                ),
                count:
                  row.competitorQtyMin == null ? 1 : row.competitorPackCount,
              },
            };
          }
        }
        if (failure) {
          row.lastError = failure;
          const saved = await repository.save(row);
          return {
            pairId: saved.id,
            before,
            after: { ...copy(saved), observation },
            status: "failed" as const,
            message: failure,
          };
        }
      } else if (command.operation === "pack") {
        const size = normalizedComparisonPack(command.pack);
        row.competitorUnit = size.unit as "kg" | "l" | "piece";
        row.competitorQtyMin = Number(size.min);
        row.competitorQtyMax = Number(size.max);
        row.competitorPackCount = size.count;
        row.competitorWeightKg = Number(size.min) * size.count;
        row.priceIncVat = null;
        row.verifiedFingerprint = null;
        row.verifiedBy = null;
        row.verifiedAt = null;
        row.matchNote =
          "Uncertain: Pack changed; review the match and record a price for this pack.";
      } else if (command.operation === "verify") {
        const source = row.scrapingSourceId
          ? await this.scraping
              .listSources()
              .then((s) => s.find((x) => x.id === row.scrapingSourceId))
          : null;
        if (row.scrapingSourceId && !source)
          throw new ConflictException("Retailer source unavailable");
        if (source)
          await m.query(
            "SELECT id FROM scraping_sources WHERE id=$1 FOR SHARE",
            [source.id],
          );
        row.verifiedFingerprint =
          command.relationship === "same_product"
            ? source
              ? createHash("sha256")
                  .update(
                    catalogFingerprint(product) +
                      scrapingVersion(source.config),
                  )
                  .digest("hex")
              : catalogFingerprint(product)
            : null;
        row.verifiedBy = command.relationship === "same_product" ? email : null;
        row.verifiedAt =
          command.relationship === "same_product" ? new Date() : null;
        row.matchNote =
          (command.relationship === "substitute"
            ? "Substitute: "
            : command.relationship === "uncertain"
              ? "Uncertain: "
              : "Same product: ") + command.note;
      } else if (command.operation === "capture") {
        const observed = new Date(command.observedAt);
        if (
          observed.getTime() > Date.now() + 300000 ||
          (row.observedAt && observed < row.observedAt)
        )
          throw new BadRequestException(
            "Observation must not be future dated or older than the recorded price",
          );
        const source = row.scrapingSourceId
          ? await this.scraping
              .listSources()
              .then((s) => s.find((x) => x.id === row.scrapingSourceId))
          : null;
        const nativeBasis = current.inputs.observations.find(
          (o) => o.id === row.id,
        )!.priceBasis;
        observation = {
          price: command.price,
          currency: command.currency,
          taxBasis: command.taxBasis,
          priceBasis: command.priceBasis,
          observedAt: observed.toISOString(),
          context: command.context,
          name: row.competitorName,
          competitorSku: row.competitorSku,
          url: row.sourceUrl,
          capturedBy: actor,
          pack: {
            unit: row.competitorUnit,
            min: String(row.competitorQtyMin ?? row.competitorWeightKg),
            max: String(
              row.competitorQtyMax ??
                row.competitorQtyMin ??
                row.competitorWeightKg,
            ),
            count: row.competitorQtyMin == null ? 1 : row.competitorPackCount,
          },
        };
        const vat = command.taxBasis === "inclusive";
        if (row.vatIncluded !== vat || row.sourceContext !== command.context) {
          row.verifiedFingerprint = null;
          row.verifiedBy = null;
          row.verifiedAt = null;
        }
        row.vatIncluded = vat;
        row.sourceContext = command.context;
        row.priceIncVat =
          command.currency === "THB" &&
          vat &&
          command.priceBasis === nativeBasis
            ? Number(command.price)
            : null;
        row.observedAt = observed;
        row.captureMethod = "manual";
        row.capturedSourceVersion = null;
        row.lastError = null;
      } else if (command.operation === "remove") {
        await repository.delete(row.id);
        return { pairId: row.id, before, after: null };
      }
    }
    const saved = await repository.save(row);
    return { pairId: saved.id, before, after: { ...copy(saved), observation } };
  }
}
